import OpenAI from 'openai';
import { z } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';

/**
 * The one OpenAI client, plus the retry, timeout and accounting every call
 * needs.
 *
 * Three call sites previously each constructed their own client and awaited it
 * bare. That meant: no timeout beyond the SDK default, so a hung request held
 * a Fastify worker until the socket died; no retry, so a single 429 or 503
 * surfaced to the user as a failure; and no record of what any of it cost.
 * Worst of the three is the video-edit worker, where an unvalidated model
 * response was interpolated straight into ffmpeg arguments.
 */

/**
 * Hard ceiling on a single completion.
 *
 * Chosen against the routes' own budgets: the chat route asks for at most 800
 * tokens, which streams well inside 30s. Longer than this and the user has
 * already given up and hit send again.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** Total attempts, not retries after the first. */
const MAX_ATTEMPTS = 3;

/** First backoff step; doubles each attempt. */
const BASE_BACKOFF_MS = 500;

export const openai = new OpenAI({
  apiKey:  env.OPENAI_API_KEY,
  timeout: REQUEST_TIMEOUT_MS,
  // The SDK's own retry is disabled: it does not distinguish a 429 that will
  // clear from a 429 that means the account is out of credit, and retrying
  // the latter three times just triples the latency before the same error.
  maxRetries: 0,
});

/** What the user sees when the model is unreachable after every attempt. */
const UNAVAILABLE_MESSAGE =
  'AI is temporarily unavailable. Please try again in a moment.';

/** What they see when the platform's own OpenAI quota is spent. */
const QUOTA_MESSAGE =
  'AI is temporarily unavailable — our usage quota has been reached. This is a platform-level limit and resets shortly.';

interface OpenAIErrorish {
  status?: number;
  code?: string;
  type?: string;
  message?: string;
}

/**
 * Is retrying this error worth the wait?
 *
 * A 400 means the request itself is wrong and will be just as wrong next
 * time. `insufficient_quota` is a billing state, not a transient blip —
 * retrying it burns 1.5 seconds to produce the identical error.
 */
function isRetryable(err: unknown): boolean {
  const e = err as OpenAIErrorish;
  if (e?.code === 'insufficient_quota') return false;
  if (e?.status === 429) return true;                       // rate limit — backs off
  if (typeof e?.status === 'number' && e.status >= 500) return true;
  // Network-level failures carry no HTTP status at all.
  return e?.status === undefined;
}

function isQuotaError(err: unknown): boolean {
  const e = err as OpenAIErrorish;
  return e?.code === 'insufficient_quota' || e?.type === 'insufficient_quota';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Per-1M-token prices, USD, for the two models in use.
 *
 * Recorded in the usage table so cost can be attributed per user without
 * re-deriving it from a price list that will have moved by then. If a model
 * is missing here the cost lands as 0 rather than blocking the call — a
 * wrong-looking zero in a report is cheaper than a failed AI request.
 */
const PRICING: Record<string, { in: number; out: number }> = {
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-4o':      { in: 2.50, out: 10.00 },
};

export interface CompletionOptions {
  userId: string;
  /** Names the call in the usage table: 'chat', 'title', 'video-edit'. */
  feature: string;
  model: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  maxTokens: number;
  temperature?: number;
  /** Ask the model for a JSON object rather than hoping the prompt holds. */
  json?: boolean;
}

/**
 * Run a completion with retry, timeout and usage accounting.
 *
 * Returns the raw text. Callers that expect JSON should use
 * `completeJson` below rather than parsing this themselves.
 */
export async function complete(opts: CompletionOptions): Promise<string> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await openai.chat.completions.create({
        model:       opts.model,
        messages:    opts.messages,
        max_tokens:  opts.maxTokens,
        temperature: opts.temperature ?? 0.7,
        ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
      });

      // Not awaited: accounting must never delay the user's answer, and a
      // failed insert must never fail a completion the user already paid for.
      void recordUsage({
        userId:  opts.userId,
        feature: opts.feature,
        model:   opts.model,
        promptTokens:     res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
      });

      const text = res.choices[0]?.message?.content;
      if (!text) throw new AppError('The model returned an empty response', 502, 'AI_EMPTY_RESPONSE');
      return text;
    } catch (err) {
      lastErr = err;

      if (isQuotaError(err)) {
        logger.error({ feature: opts.feature }, 'OpenAI quota exhausted');
        throw new AppError(QUOTA_MESSAGE, 503, 'AI_QUOTA_EXHAUSTED');
      }
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) break;

      const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      logger.warn(
        { feature: opts.feature, attempt, backoff, err: (err as OpenAIErrorish)?.message },
        'OpenAI call failed — retrying',
      );
      await sleep(backoff);
    }
  }

  logger.error({ feature: opts.feature, err: lastErr }, 'OpenAI call failed after all attempts');
  throw new AppError(UNAVAILABLE_MESSAGE, 503, 'AI_UNAVAILABLE');
}

/**
 * A completion whose result must match a schema.
 *
 * The model is asked for JSON and the answer is then validated, because
 * `response_format: json_object` guarantees only that the output parses —
 * not that it has the fields the caller is about to use. Everything
 * downstream of these calls (ffmpeg arguments, rendered titles) assumes a
 * shape, and this is where that assumption is actually checked.
 */
export async function completeJson<T>(
  opts: CompletionOptions,
  // The input type is deliberately `any` rather than `T`. A schema using
  // .catch() or .default() has an input type that differs from its output,
  // and the narrower z.ZodType<T> fails to infer against those — silently
  // widening the caller's result to `unknown`, which is precisely the
  // untyped model output this function exists to eliminate.
  schema: z.ZodType<T, z.ZodTypeDef, any>,
): Promise<T> {
  const raw = await complete({ ...opts, json: true });

  let parsed: unknown;
  try {
    // Strip a markdown fence anyway. json_object mode makes it unlikely, but
    // the failure it prevents is a total loss of the response.
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    logger.warn({ feature: opts.feature, raw: raw.slice(0, 300) }, 'Model returned unparseable JSON');
    throw new AppError('The AI returned a malformed response. Please try again.', 502, 'AI_BAD_RESPONSE');
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    logger.warn(
      { feature: opts.feature, issues: result.error.issues.slice(0, 5) },
      'Model response failed schema validation',
    );
    throw new AppError('The AI returned an unexpected response. Please try again.', 502, 'AI_BAD_RESPONSE');
  }
  return result.data;
}

interface UsageInput {
  userId: string;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/** Cost in USD for a given token split. Exported for the usage report. */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out;
}

async function recordUsage(u: UsageInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('ai_usage').insert({
      user_id:           u.userId,
      feature:           u.feature,
      model:             u.model,
      prompt_tokens:     u.promptTokens,
      completion_tokens: u.completionTokens,
      total_tokens:      u.promptTokens + u.completionTokens,
      cost_usd:          estimateCostUsd(u.model, u.promptTokens, u.completionTokens),
    });
    if (error) throw error;
  } catch (err) {
    logger.warn({ err, feature: u.feature }, 'AI usage not recorded');
  }
}
