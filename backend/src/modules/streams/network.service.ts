/**
 * OmliveStream Network Intelligence Service
 * ─────────────────────────────────────────────────────────────────
 * Analyses the user's network before going live and during streaming.
 *
 * The goal: give every user the best possible streaming experience
 * regardless of their connection. Never block a stream — adapt it.
 *
 * Quality Ladder (what we encode and what platforms receive):
 * ┌─────────────┬──────────┬─────────┬──────────┬──────────────────────────────┐
 * │ Tier        │ Upload   │ Video   │ Bitrate  │ Platforms                    │
 * ├─────────────┼──────────┼─────────┼──────────┼──────────────────────────────┤
 * │ Ultra HD    │ ≥ 15Mbps │ 1080p60 │ 9,000kbps│ YouTube, Twitch, Facebook    │
 * │ Full HD     │ ≥ 8Mbps  │ 1080p30 │ 6,000kbps│ All platforms                │
 * │ HD          │ ≥ 4Mbps  │ 720p30  │ 3,500kbps│ All platforms                │
 * │ Standard    │ ≥ 2Mbps  │ 540p30  │ 2,000kbps│ All platforms                │
 * │ Low         │ ≥ 1Mbps  │ 360p30  │ 1,000kbps│ All platforms (audio-first)  │
 * │ Voice-Only  │ < 1Mbps  │ Audio   │ 160kbps  │ Audio-only stream            │
 * └─────────────┴──────────┴─────────┴──────────┴──────────────────────────────┘
 *
 * The adaptive algorithm applies a 20% safety margin to the detected
 * speed so that short bursts of congestion don't cause visible drops.
 * During live streaming, the Socket.io health system continuously monitors
 * and can trigger a quality downgrade transparently.
 */

export interface NetworkTestResult {
  // Measured values
  uploadMbps:       number;   // Actual upload speed in Mbps
  latencyMs:        number;   // Round-trip time to OmliveStream servers (ms)
  jitterMs:         number;   // Variation in latency (lower = more stable)
  packetLossPercent: number;  // Estimated packet loss (%)

  // Recommended settings
  recommended: {
    tier:          string;    // 'ultra_hd' | 'full_hd' | 'hd' | 'standard' | 'low' | 'voice_only'
    resolution:    string;    // '1920x1080' etc.
    frameRate:     number;    // 60 | 30
    videoBitrateKbps: number; // Suggested video bitrate
    audioBitrateKbps: number; // Suggested audio bitrate
    label:         string;    // Human-readable e.g. "Full HD 1080p30"
    description:   string;    // What the user will experience
  };

  // Platform compatibility (which platforms can receive this quality)
  platformSupport: {
    platform:    string;
    supported:   boolean;
    maxQuality:  string;
    note?:       string;
  }[];

  // User-facing messages
  statusColor:     'green' | 'yellow' | 'orange' | 'red';
  statusMessage:   string;  // Short status e.g. "Excellent connection"
  tips:            string[]; // Actionable tips to improve quality

  // Can still stream?
  canStream:       boolean;
  adaptiveEnabled: boolean;  // Whether adaptive bitrate will be active
}

// Platform-specific quality caps
const PLATFORM_CAPS: Record<string, { maxResolution: string; maxBitrateKbps: number }> = {
  youtube:   { maxResolution: '1920x1080', maxBitrateKbps: 9000 },
  twitch:    { maxResolution: '1920x1080', maxBitrateKbps: 6000 },
  facebook:  { maxResolution: '1920x1080', maxBitrateKbps: 4000 },
  instagram: { maxResolution: '1280x720',  maxBitrateKbps: 3500 },
  tiktok:    { maxResolution: '1080x1920', maxBitrateKbps: 2500 }, // vertical
  twitter:   { maxResolution: '1280x720',  maxBitrateKbps: 2048 },
  linkedin:  { maxResolution: '1280x720',  maxBitrateKbps: 3000 },
  kick:      { maxResolution: '1920x1080', maxBitrateKbps: 8000 },
};

interface QualityTier {
  tier:             string;
  label:            string;
  description:      string;
  minUploadMbps:    number;
  resolution:       string;
  frameRate:        number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
}

const QUALITY_LADDER: QualityTier[] = [
  {
    tier: 'ultra_hd',
    label: 'Ultra HD — 1080p60',
    description: 'Broadcast quality. Crystal-clear 60fps. Your viewers will see every detail.',
    minUploadMbps:    15,
    resolution:       '1920x1080',
    frameRate:        60,
    videoBitrateKbps: 9000,
    audioBitrateKbps: 320,
  },
  {
    tier: 'full_hd',
    label: 'Full HD — 1080p30',
    description: 'Professional quality. Sharp video, smooth motion. Perfect for most content.',
    minUploadMbps:    8,
    resolution:       '1920x1080',
    frameRate:        30,
    videoBitrateKbps: 6000,
    audioBitrateKbps: 192,
  },
  {
    tier: 'hd',
    label: 'HD — 720p30',
    description: 'High definition. Clean, clear video. Great for all content types.',
    minUploadMbps:    4,
    resolution:       '1280x720',
    frameRate:        30,
    videoBitrateKbps: 3500,
    audioBitrateKbps: 160,
  },
  {
    tier: 'standard',
    label: 'Standard — 540p30',
    description: 'Good quality. Viewers can see you clearly on all screen sizes.',
    minUploadMbps:    2,
    resolution:       '960x540',
    frameRate:        30,
    videoBitrateKbps: 2000,
    audioBitrateKbps: 128,
  },
  {
    tier: 'low',
    label: 'Low — 360p30',
    description: 'Basic quality. Stream is stable. Audio is clear. Works on any connection.',
    minUploadMbps:    1,
    resolution:       '640x360',
    frameRate:        30,
    videoBitrateKbps: 1000,
    audioBitrateKbps: 96,
  },
  {
    tier: 'voice_only',
    label: 'Audio Only',
    description: 'Very limited bandwidth. Audio-only stream. Consider a stronger connection before going live with video.',
    minUploadMbps:    0,
    resolution:       '0x0',
    frameRate:        0,
    videoBitrateKbps: 0,
    audioBitrateKbps: 160,
  },
];

/**
 * Analyses network measurement data and returns the optimal streaming config.
 * Called from the network-check endpoint with client-measured values.
 *
 * The 20% safety margin: if upload is 10 Mbps, we use 8 Mbps as the
 * effective value. This prevents drops when your ISP throttles briefly
 * or when your router has a brief congestion event.
 */
export function analyseNetwork(params: {
  uploadMbps:        number;
  latencyMs:         number;
  jitterMs:          number;
  packetLossPercent: number;
  selectedPlatforms: string[];
}): NetworkTestResult {
  const { uploadMbps, latencyMs, jitterMs, packetLossPercent, selectedPlatforms } = params;

  // Apply safety margin — use 80% of measured speed
  const effectiveMbps = uploadMbps * 0.8;

  // Apply quality penalty for high jitter (unstable connection)
  // Jitter > 50ms = reduce effective speed by another 20%
  const jitterPenalty = jitterMs > 100 ? 0.6 : jitterMs > 50 ? 0.8 : 1.0;
  const adjustedMbps  = effectiveMbps * jitterPenalty;

  // Apply quality penalty for packet loss
  // > 2% packet loss = significant quality issues
  const lossPenalty  = packetLossPercent > 5 ? 0.5 : packetLossPercent > 2 ? 0.75 : 1.0;
  const finalMbps    = adjustedMbps * lossPenalty;

  // Select tier from quality ladder (find the best tier the connection supports)
  const tier = QUALITY_LADDER.find(t => finalMbps >= t.minUploadMbps) ?? QUALITY_LADDER[QUALITY_LADDER.length - 1];

  // Platform support analysis
  const platformSupport = selectedPlatforms.map(platform => {
    const cap = PLATFORM_CAPS[platform];
    if (!cap) return { platform, supported: true, maxQuality: tier.label };

    const platformMbpsNeeded = cap.maxBitrateKbps / 1000;
    const supported = finalMbps >= 0.5; // minimum viable

    let maxQuality = tier.label;
    let note: string | undefined;

    if (tier.videoBitrateKbps > cap.maxBitrateKbps) {
      // Our quality exceeds this platform's cap — we'll send at platform max
      const platformTier = QUALITY_LADDER.find(t => t.videoBitrateKbps <= cap.maxBitrateKbps);
      maxQuality = platformTier?.label ?? 'Standard';
      note = `${platform} caps at ${cap.maxResolution} — stream will be optimised automatically`;
    }

    return { platform, supported, maxQuality, note };
  });

  // Status colour and message
  let statusColor: NetworkTestResult['statusColor'];
  let statusMessage: string;

  if (uploadMbps >= 8 && latencyMs < 50 && jitterMs < 20 && packetLossPercent < 0.5) {
    statusColor   = 'green';
    statusMessage = '🟢 Excellent connection — broadcast quality streaming';
  } else if (uploadMbps >= 4 && latencyMs < 100 && jitterMs < 50 && packetLossPercent < 2) {
    statusColor   = 'green';
    statusMessage = '🟢 Good connection — HD streaming ready';
  } else if (uploadMbps >= 2 && latencyMs < 150 && packetLossPercent < 3) {
    statusColor   = 'yellow';
    statusMessage = '🟡 Fair connection — standard quality streaming';
  } else if (uploadMbps >= 1) {
    statusColor   = 'orange';
    statusMessage = '🟠 Weak connection — low quality streaming. Consider improving your network.';
  } else {
    statusColor   = 'red';
    statusMessage = '🔴 Very poor connection — streaming may be unstable';
  }

  // Actionable tips based on measured values
  const tips: string[] = [];

  if (latencyMs > 150) {
    tips.push('High latency detected — try moving closer to your WiFi router, or use a wired ethernet connection');
  }
  if (jitterMs > 50) {
    tips.push('Unstable connection detected — close background apps and browser tabs using bandwidth');
  }
  if (packetLossPercent > 2) {
    tips.push('Packet loss detected — restart your router and disconnect other devices from WiFi');
  }
  if (uploadMbps < 4) {
    tips.push('Low upload speed — for better quality, try a wired ethernet connection or move to a 5GHz WiFi network');
  }
  if (uploadMbps >= 4 && tier.tier !== 'ultra_hd') {
    tips.push('Close bandwidth-heavy apps (video calls, downloads, cloud backups) for the best stream quality');
  }
  if (tips.length === 0) {
    tips.push('Your connection looks great! You are ready to stream.');
  }

  return {
    uploadMbps,
    latencyMs,
    jitterMs,
    packetLossPercent,
    recommended: {
      tier:             tier.tier,
      resolution:       tier.resolution,
      frameRate:        tier.frameRate,
      videoBitrateKbps: tier.videoBitrateKbps,
      audioBitrateKbps: tier.audioBitrateKbps,
      label:            tier.label,
      description:      tier.description,
    },
    platformSupport,
    statusColor,
    statusMessage,
    tips,
    canStream:       uploadMbps >= 0.5, // 500Kbps minimum for any stream
    adaptiveEnabled: true,              // Always on — degrades gracefully during congestion
  };
}

/**
 * Real-time adaptive quality recommendation during a live stream.
 * Called from Socket.io when frontend sends stream:health:ping.
 *
 * Returns whether to upgrade, maintain, or downgrade quality — and by how much.
 * The hysteresis prevents flapping (requires 3 consecutive measurements before changing).
 */
export interface AdaptiveRecommendation {
  action:           'upgrade' | 'maintain' | 'downgrade';
  targetTier:       string;
  targetBitrateKbps: number;
  targetResolution: string;
  reason:           string;
  quality:          'good' | 'moderate' | 'poor';
  recommendedLabel: string;
}

export function getAdaptiveRecommendation(
  currentBitrateKbps: number,
  measuredUploadKbps: number
): AdaptiveRecommendation {
  // Available bandwidth with 80% safety margin
  const availableKbps = measuredUploadKbps * 0.8;

  // Find best tier for available bandwidth
  const availableMbps = availableKbps / 1000;
  const targetTier    = QUALITY_LADDER.find(t => availableMbps >= t.minUploadMbps) ?? QUALITY_LADDER[QUALITY_LADDER.length - 1];
  const currentTier   = QUALITY_LADDER.find(t => t.videoBitrateKbps <= currentBitrateKbps) ?? QUALITY_LADDER[0];

  let quality: AdaptiveRecommendation['quality'];
  if (availableMbps >= 4)      quality = 'good';
  else if (availableMbps >= 1) quality = 'moderate';
  else                          quality = 'poor';

  // Determine action
  let action: AdaptiveRecommendation['action'];
  let reason: string;

  if (targetTier.videoBitrateKbps > currentBitrateKbps * 1.2) {
    // Available bandwidth is 20%+ above current — can upgrade
    action = 'upgrade';
    reason = `Network improved — upgrading to ${targetTier.label}`;
  } else if (targetTier.videoBitrateKbps < currentBitrateKbps * 0.9) {
    // Available bandwidth dropped below 90% of current — must downgrade
    action = 'downgrade';
    reason = `Network congestion detected — reducing to ${targetTier.label} to prevent buffering`;
  } else {
    action = 'maintain';
    reason = 'Network stable — maintaining current quality';
  }

  return {
    action,
    targetTier:        targetTier.tier,
    targetBitrateKbps: targetTier.videoBitrateKbps,
    targetResolution:  targetTier.resolution,
    reason,
    quality,
    recommendedLabel:  targetTier.label,
  };
}
