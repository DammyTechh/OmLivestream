import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import { tokens } from './tokens';

/**
 * The single HTTP client, pointed at the same backend the website uses.
 *
 * Nothing about the API is mobile-specific — same routes, same envelope, same
 * accounts — which is the whole point: a creator's phone and laptop are two
 * windows onto one account, and no data lives only in the app.
 */

export const API_URL: string =
  (Constants.expoConfig?.extra?.apiUrl as string) ?? 'https://api.omlivestream.com/api/v1';

export const SOCKET_URL: string =
  (Constants.expoConfig?.extra?.socketUrl as string) ?? 'https://api.omlivestream.com';

export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  // Generous but finite. Mobile networks stall in ways wifi does not, and a
  // request with no timeout becomes a spinner that never resolves — the single
  // most common "the app is broken" report there is.
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

/** Standard success envelope from the backend. */
export interface ApiEnvelope<T> { success: boolean; data: T; meta?: unknown }

/** Unwrap `{ success, data }` to just `data`. */
export function unwrap<T>(res: { data: ApiEnvelope<T> }): T {
  return res.data.data;
}

// ── Request: attach the access token ────────────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokens.getAccessSync();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Response: refresh once, and only once, on a 401 ─────────────────
/**
 * A single-flight refresh.
 *
 * A dashboard screen fires several requests at once, so an expired token
 * produces a burst of 401s together. Without co-ordination each one starts its
 * own refresh; the first rotates the refresh token and the rest then fail
 * against a token that is no longer valid, signing the user out for no reason.
 *
 * So the first 401 performs the refresh and every other waits on that same
 * promise, then retries with the new token.
 */
let refreshing: Promise<string | null> | null = null;

/** Set by the auth store so a failed refresh can end the session cleanly. */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: () => void) { onSessionExpired = fn; }

async function refreshAccessToken(): Promise<string | null> {
  const refresh = await tokens.getRefresh();
  if (!refresh) return null;
  try {
    // Bare axios, not `api`: going through the instance would re-enter this
    // interceptor and, on a 401 from the refresh endpoint itself, recurse.
    const res = await axios.post<ApiEnvelope<{ accessToken: string; refreshToken: string }>>(
      `${API_URL}/auth/refresh`,
      { refreshToken: refresh },
      { timeout: 20_000 },
    );
    const pair = res.data.data;
    await tokens.save(pair.accessToken, pair.refreshToken);
    return pair.accessToken;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    const isAuthCall = original?.url?.includes('/auth/');
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;

      refreshing ??= refreshAccessToken().finally(() => { refreshing = null; });
      const fresh = await refreshing;

      if (fresh) {
        original.headers.Authorization = `Bearer ${fresh}`;
        return api(original);
      }

      await tokens.clear();
      onSessionExpired?.();
    }
    return Promise.reject(error);
  },
);

/**
 * Turn any thrown value into a sentence worth showing someone.
 *
 * Mobile needs one case the web client does not: a request that never reached
 * the server. On a phone that is routine — a lift, a tunnel, a dead spot — and
 * "Network Error" tells the user nothing about whether to retry or give up.
 */
export function getApiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED') {
      return 'That took too long to respond. Check your connection and try again.';
    }
    if (!err.response) {
      return 'No connection. Check your network and try again.';
    }

    // Validation errors carry the useful part in `details` — which field, and
    // why. The headline alone ("Validation failed") tells someone their form
    // was rejected but not what to change.
    const details = (err.response.data as any)?.error?.details;
    if (Array.isArray(details) && details.length > 0 && details[0]?.message) {
      const field = Array.isArray(details[0].path)
        ? details[0].path.filter((p: unknown) => typeof p === 'string' && p !== 'body').slice(-1)[0]
        : undefined;
      const label = typeof field === 'string'
        ? field.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
        : null;
      return label ? `${label}: ${details[0].message}` : String(details[0].message);
    }

    const msg = (err.response.data as any)?.error?.message
             ?? (err.response.data as any)?.message;
    if (msg) return String(msg);
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
