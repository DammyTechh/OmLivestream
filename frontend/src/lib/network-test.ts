/**
 * Real network measurement for the pre-flight check.
 * ─────────────────────────────────────────────────────────────────
 * This replaces `navigator.connection.downlink`, which was never a
 * measurement: it is a coarse, rounded, *download* estimate derived from
 * recently observed traffic, it is rounded to the nearest 25 kbps, and it
 * does not exist at all in Safari or Firefox. Streaming is bound by
 * *upload*, so the old reading could be off by an order of magnitude in
 * either direction.
 *
 * What we actually measure:
 *
 *   latency  — median RTT over a burst of small requests. Median, not
 *              mean, so one scheduler hiccup does not move the number.
 *   jitter   — mean absolute difference between consecutive RTTs
 *              (the RFC 3550 interarrival-variation idea, simplified).
 *   loss     — share of ping requests that failed or timed out.
 *   upload   — server-measured throughput. The server times from its own
 *              first received byte to its last, so DNS, TLS and TCP
 *              handshake are excluded. Timing this in the browser around
 *              fetch() would include all three, which on a cold
 *              connection is easily 200ms and makes a short upload look
 *              several times slower than it is.
 */

import { api } from './api';

export interface RawMeasurement {
  uploadMbps:        number;
  latencyMs:         number;
  jitterMs:          number;
  packetLossPercent: number;
}

export type Phase = 'idle' | 'latency' | 'upload' | 'analysing' | 'done' | 'error';

export interface Progress {
  phase:   Phase;
  /** 0-100 across the whole run, for a progress bar. */
  percent: number;
  /** Short human-readable line, safe to show directly. */
  note:    string;
}

/** Server limit is 24 MB; stay under it. */
const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;
const MIN_PAYLOAD_BYTES = 256 * 1024;
/** Aim for this much transfer time per sample — long enough to clear
 *  TCP slow-start, short enough that nobody waits around. */
const TARGET_SAMPLE_MS  = 2500;
const PING_COUNT        = 12;
const PING_TIMEOUT_MS   = 5000;

/**
 * Builds a payload of the requested size.
 *
 * One 64 KB block of crypto-random bytes is generated and repeated.
 * getRandomValues caps at 65536 bytes per call, and filling 20 MB with it
 * would cost more time than the upload itself. Repetition is fine because
 * nothing compresses the request body.
 */
function makePayload(bytes: number): Blob {
  const BLOCK = 64 * 1024;
  // Typed as Uint8Array<ArrayBuffer>, not the default Uint8Array: since
  // TS 5.7 the element type is generic over ArrayBufferLike, which admits
  // SharedArrayBuffer — and BlobPart does not accept a shared-backed view.
  const block = new Uint8Array(new ArrayBuffer(BLOCK));
  crypto.getRandomValues(block);

  const parts: Uint8Array<ArrayBuffer>[] = [];
  let remaining = bytes;
  while (remaining > 0) {
    parts.push(remaining >= BLOCK ? block : block.subarray(0, remaining));
    remaining -= BLOCK;
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Mean absolute difference between consecutive samples. */
function jitterOf(rtts: number[]): number {
  if (rtts.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < rtts.length; i++) total += Math.abs(rtts[i] - rtts[i - 1]);
  return total / (rtts.length - 1);
}

async function measureLatency(
  onProgress: (p: Progress) => void
): Promise<{ latencyMs: number; jitterMs: number; packetLossPercent: number }> {
  const rtts: number[] = [];
  let failures = 0;

  for (let i = 0; i < PING_COUNT; i++) {
    const started = performance.now();
    try {
      // Cache-buster: a 304 or a service-worker hit would measure nothing.
      await api.get('/streams/ping', {
        params:  { t: Date.now(), n: i },
        timeout: PING_TIMEOUT_MS,
      });
      rtts.push(performance.now() - started);
    } catch {
      failures++;
    }
    onProgress({
      phase:   'latency',
      percent: Math.round(((i + 1) / PING_COUNT) * 30),
      note:    `Measuring latency (${i + 1}/${PING_COUNT})`,
    });
  }

  if (rtts.length === 0) {
    throw new Error('Could not reach the OmliveStream servers to measure your connection.');
  }

  // Discard the first sample: it pays for connection setup and is not
  // representative of steady-state RTT.
  const steady = rtts.length > 2 ? rtts.slice(1) : rtts;

  return {
    latencyMs:         Math.round(median(steady)),
    jitterMs:          Math.round(jitterOf(steady)),
    packetLossPercent: +((failures / PING_COUNT) * 100).toFixed(2),
  };
}

interface UploadSample { mbps: number; bytes: number; transferMs: number }

async function uploadOnce(bytes: number): Promise<UploadSample> {
  const { data } = await api.post('/streams/network-upload-test', makePayload(bytes), {
    headers: { 'Content-Type': 'application/octet-stream' },
    // A slow uplink moving 20 MB legitimately takes a while; the default
    // 30s instance timeout would abort a valid sample on a 6 Mbps line.
    timeout: 90_000,
    // Axios would otherwise try to JSON-serialise the Blob.
    transformRequest: [(d) => d],
  });

  return {
    mbps:       Number(data?.mbps) || 0,
    bytes:      Number(data?.bytesReceived) || bytes,
    transferMs: Number(data?.transferMs) || 0,
  };
}

/**
 * Measures upload throughput with a ramp.
 *
 * A single fixed-size upload cannot work for everyone: 20 MB punishes a
 * 1 Mbps uplink with a three-minute wait, while 256 KB finishes inside TCP
 * slow-start on a gigabit line and reports a fraction of the real
 * capacity. So we send a small probe, use its result to size a payload
 * that should take about TARGET_SAMPLE_MS, and send two of those.
 *
 * The reported figure is the *highest* sample, not the average. Slow-start
 * and any competing traffic can only drag a sample down, never inflate it,
 * so the peak is the closest estimate of available capacity.
 */
async function measureUpload(onProgress: (p: Progress) => void): Promise<number> {
  onProgress({ phase: 'upload', percent: 35, note: 'Testing upload speed' });

  const probe = await uploadOnce(MIN_PAYLOAD_BYTES);
  const samples: UploadSample[] = [probe];

  // Size the real samples from the probe. Guard against a zero/absurd
  // probe result so we never ask for a 0-byte or oversized body.
  const probeMbps = probe.mbps > 0.05 ? probe.mbps : 1;
  const sized = Math.round((probeMbps * 1e6 * (TARGET_SAMPLE_MS / 1000)) / 8);
  const payload = Math.min(MAX_PAYLOAD_BYTES, Math.max(MIN_PAYLOAD_BYTES, sized));

  for (let i = 0; i < 2; i++) {
    onProgress({
      phase:   'upload',
      percent: 45 + i * 20,
      note:    `Testing upload speed (${i + 2}/3)`,
    });
    try {
      samples.push(await uploadOnce(payload));
    } catch {
      // One failed sample is not fatal — the probe still gives us a floor.
      break;
    }
  }

  // Ignore samples too short to be meaningful; a 40ms transfer is noise.
  const usable = samples.filter((s) => s.transferMs >= 150);
  const pool   = usable.length > 0 ? usable : samples;

  return +Math.max(...pool.map((s) => s.mbps)).toFixed(2);
}

/**
 * Runs the complete network pre-flight check: latency, upload, and analysis.
 *
 * Call this once before the user creates a stream. Results are passed to
 * POST /streams/network-check for the backend's quality recommendation.
 */
export async function measureNetwork(
  selectedPlatforms: string[],
  onProgress: (p: Progress) => void
): Promise<RawMeasurement> {
  try {
    onProgress({ phase: 'latency', percent: 5, note: 'Starting network check' });

    const { latencyMs, jitterMs, packetLossPercent } = await measureLatency(onProgress);

    onProgress({ phase: 'upload', percent: 35, note: 'Testing upload speed' });
    const uploadMbps = await measureUpload(onProgress);

    onProgress({ phase: 'analysing', percent: 85, note: 'Analyzing results' });

    // Brief pause so the user sees the analysing step rather than a flash.
    await new Promise((r) => setTimeout(r, 400));

    onProgress({ phase: 'done', percent: 100, note: 'Check complete' });

    return { uploadMbps, latencyMs, jitterMs, packetLossPercent };
  } catch (err) {
    onProgress({
      phase:   'error',
      percent: 0,
      note:    err instanceof Error ? err.message : 'Network check failed',
    });
    throw err;
  }
}
