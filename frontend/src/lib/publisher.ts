import { api, unwrap } from '@/lib/api';

/**
 * Sending the camera to the server.
 *
 * This is the piece that makes a broadcast real. Everything else — creating the
 * stream, telling platforms to expect it, spawning ffmpeg — was already in
 * place, but nothing ever published video, so the pipeline sat waiting for
 * input that never arrived and every platform reported "Pending" forever.
 *
 * The path:
 *
 *   getUserMedia → mediasoup-client producers over a WebRTC transport
 *                → the server's router → ffmpeg → RTMP → every platform
 *
 * `mediasoup-client` is imported dynamically. It is ~200KB and only needed by
 * someone actually going live, so a static import would put it in the bundle
 * for every visitor to the marketing site.
 */

export interface PublishHandle {
  stop: () => Promise<void>;
  setMicEnabled: (on: boolean) => void;
  setCameraEnabled: (on: boolean) => void;
  /** The local stream, for showing the creator their own picture. */
  stream: MediaStream;
}

interface TransportParams {
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown;
  dtlsParameters: unknown;
  routerRtpCapabilities?: unknown;
}

export interface PublishOptions {
  streamId: string;
  /** An existing camera stream to publish. If absent, one is opened. */
  existingStream?: MediaStream | null;
  onFailed?: (reason: string) => void;
}

/**
 * Open the transport and start sending.
 *
 * Order matters:
 *
 *  1. Ask the server for a transport. It returns the router's capabilities
 *     alongside it — mediasoup-client cannot negotiate anything without them.
 *  2. Load the device.
 *  3. Create the send transport and wire `connect` and `produce`. Those fire
 *     during negotiation, and the promise they hand us must not resolve until
 *     the server has actually done its half.
 *  4. Produce video, then audio.
 *
 * Video first, deliberately: it is the slower and more failure-prone half, and
 * discovering it failed while audio is already flowing gives a stream with
 * sound over a black picture — worse than a clean failure.
 */
export async function startPublishing(opts: PublishOptions): Promise<PublishHandle> {
  const { streamId, existingStream, onFailed } = opts;

  const mediasoupClient = await import('mediasoup-client');

  // ── 1. Transport + router capabilities ───────────────────────────
  /**
   * Read the transport params out of whatever shape comes back.
   *
   * The API wraps responses as `{ success, data }` and `unwrap()` reaches into
   * `res.data.data` — but relying on that exact nesting made this fail with
   * "server did not return connection details" on a response that was a
   * perfectly good 200. Rather than guess which layer holds the payload, find
   * the object that actually carries the fields mediasoup needs.
   *
   * This is deliberately tolerant: getting a broadcast on air matters more
   * than insisting on one envelope shape.
   */
  const res = await api.post('/webrtc/create-transport', { streamId });

  const findTransport = (v: unknown, depth = 0): TransportParams | null => {
    if (!v || typeof v !== 'object' || depth > 4) return null;
    const o = v as Record<string, unknown>;
    if (o.id && o.iceParameters && o.dtlsParameters) return o as unknown as TransportParams;
    for (const key of ['data', 'result', 'payload']) {
      const found = findTransport(o[key], depth + 1);
      if (found) return found;
    }
    return null;
  };

  const params = findTransport(res);

  if (!params) {
    // Log the actual body once, so a mismatch is diagnosable from the console
    // instead of guessing. Only on failure, and only in the browser.
    // Log everything needed to identify the shape without another round trip.
    // The previous version logged only `res.data`, which printed nothing when
    // the body was empty — true but unhelpful.
    console.error('[publisher] create-transport did not yield transport params', {
      status: (res as { status?: number })?.status,
      hasData: Boolean((res as { data?: unknown })?.data),
      dataType: typeof (res as { data?: unknown })?.data,
      dataKeys: (res as { data?: object })?.data && typeof (res as { data?: object }).data === 'object'
        ? Object.keys((res as { data: object }).data)
        : null,
      bodyPreview: JSON.stringify((res as { data?: unknown })?.data ?? null).slice(0, 400),
    });
    throw new Error(
      'The server did not return connection details for this stream. ' +
      'It may need updating, or the stream may have already ended.',
    );
  }

  if (!params.routerRtpCapabilities) {
    throw new Error(
      'This server does not support browser publishing yet. The backend needs updating ' +
      '— /webrtc/create-transport must return routerRtpCapabilities.',
    );
  }

  // ── 2. Device ────────────────────────────────────────────────────
  const device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: params.routerRtpCapabilities as never });

  if (!device.canProduce('video')) {
    throw new Error('This browser cannot send video in a format the server accepts.');
  }

  // ── 3. Send transport ────────────────────────────────────────────
  const transport = device.createSendTransport({
    id: params.id,
    iceParameters: params.iceParameters as never,
    iceCandidates: params.iceCandidates as never,
    dtlsParameters: params.dtlsParameters as never,
  });

  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    api.post('/webrtc/connect-transport', { transportId: transport.id, dtlsParameters })
      .then(() => callback())
      // errback, not throw: mediasoup is awaiting this callback, and throwing
      // leaves the transport stuck in "connecting" for ever.
      .catch((err) => errback(err as Error));
  });

  transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
    api.post('/webrtc/produce', { transportId: transport.id, kind, rtpParameters })
      .then((res) => callback({ id: unwrap<{ id: string }>(res).id }))
      .catch((err) => errback(err as Error));
  });

  transport.on('connectionstatechange', (state) => {
    if (state === 'failed') {
      onFailed?.('The connection to the server failed. Check your network and start again.');
    } else if (state === 'disconnected') {
      onFailed?.('Connection lost — trying to recover…');
    }
  });

  // ── 4. Tracks ────────────────────────────────────────────────────
  // Reuse the preview stream when there is one. Calling getUserMedia twice
  // produces a second camera handle, and some machines refuse it outright.
  const stream = existingStream?.getVideoTracks().length
    ? existingStream
    : await navigator.mediaDevices.getUserMedia({
        /**
         * Ask for 1080p, accept whatever the camera can give.
         *
         * This is the single biggest lever on output quality, because when the
         * browser sends H.264 the server copies the stream through to RTMP
         * untouched — `-c:v copy`, no re-encode. Whatever the browser produces
         * is exactly what Facebook and YouTube receive, so capturing at 720p
         * put a hard ceiling on the whole pipeline.
         *
         * `ideal` rather than `exact`: a webcam that cannot do 1080p returns
         * its best instead of failing outright, which is what `exact` would do.
         */
        video: {
          width:     { ideal: 1920, max: 1920 },
          height:    { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          // On by default in most browsers and it pumps the level up and down,
          // which is audible and unpleasant on anything musical. The encoder
          // handles range better than the browser's AGC does.
          autoGainControl: false,
          sampleRate: 48000,
          channelCount: 2,
        },
      });

  const videoTrack = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0];
  if (!videoTrack) {
    throw new Error('No camera track is available. Turn the camera on and try again.');
  }

  const producers: { close: () => void }[] = [];

  try {
    /**
     * Three spatial layers — simulcast.
     *
     * A creator on hotel wifi and one on fibre cannot sustain the same
     * bitrate, and it changes mid-broadcast. Sending three resolutions lets
     * the server forward whichever the uplink can currently carry, so a weak
     * connection degrades to a smaller picture rather than freezing.
     */
    /**
     * Tell the encoder this is camera footage, not a static screen share.
     *
     * With 'motion' it spends bits on temporal smoothness; with 'detail' it
     * preserves sharp edges at the cost of fluidity. A person talking wants
     * the former — the default guess is often wrong for webcam input.
     */
    try { (videoTrack as MediaStreamTrack & { contentHint?: string }).contentHint = 'motion'; } catch { /* older browsers */ }

    producers.push(
      await transport.produce({
        track: videoTrack,
        encodings: [
          // Three layers sized for 1080p. Raising the top layer is safe on a
          // weak connection: simulcast means the server forwards whichever
          // layer the uplink can actually sustain, so a poor network drops to
          // 'mid' rather than stuttering at 'high'. The old 3 Mbps ceiling was
          // limiting good connections for no benefit to bad ones.
          { rid: 'low',  maxBitrate:   400_000, scaleResolutionDownBy: 4 },   // 480p
          { rid: 'mid',  maxBitrate: 1_500_000, scaleResolutionDownBy: 2 },   // 720p
          { rid: 'high', maxBitrate: 5_000_000, scaleResolutionDownBy: 1 },   // 1080p
        ],
        codecOptions: { videoGoogleStartBitrate: 2000 },
      }),
    );

    /**
     * Keep resolution, sacrifice frame rate under pressure.
     *
     * The browser's default drops resolution first, which on a talking-head
     * broadcast makes a face soft and keeps it that way, and turns text on a
     * shared slide unreadable. A brief dip to 24fps is far less noticeable
     * than a permanent drop to 540p.
     *
     * Set on the RTP sender because mediasoup does not expose it as a producer
     * option, and wrapped because Safari has not always supported it — a
     * browser that ignores this still streams perfectly well.
     */
    try {
      const videoProducer = producers[0] as unknown as { rtpSender?: RTCRtpSender };
      const sender = videoProducer?.rtpSender;
      if (sender) {
        const params = sender.getParameters();
        (params as RTCRtpSendParameters & { degradationPreference?: string })
          .degradationPreference = 'maintain-resolution';
        await sender.setParameters(params);
      }
    } catch { /* unsupported in this browser; the stream is unaffected */ }

    if (audioTrack) {
      producers.push(
        await transport.produce({
          track: audioTrack,
          codecOptions: { opusStereo: true, opusDtx: true },
        }),
      );
    }
  } catch (err) {
    // Tear down anything half-created, so a failed start cannot leave the
    // camera light on or a producer stranded on the server.
    producers.forEach((p) => p.close());
    transport.close();
    throw err;
  }

  return {
    stream,
    stop: async () => {
      producers.forEach((p) => p.close());
      transport.close();
      // Only stop tracks we opened. Stopping a caller's preview stream would
      // black out their own picture before they meant to end.
      if (!existingStream) stream.getTracks().forEach((t) => t.stop());
    },
    setMicEnabled: (on) => { if (audioTrack) audioTrack.enabled = on; },
    setCameraEnabled: (on) => { videoTrack.enabled = on; },
  };
}

/**
 * Why this browser cannot publish, or null if it can.
 *
 * Checked before offering the button rather than after a failure. Safari on
 * iOS is the case that matters: it only exposes getUserMedia on a secure
 * origin, so a page served over plain HTTP reports "not supported" rather than
 * a permissions error, which is what makes it so confusing to diagnose.
 */
export function publishingUnsupportedReason(): string | null {
  if (typeof window === 'undefined') return null;

  if (!window.isSecureContext) {
    return 'Live streaming needs a secure connection (https). Open this page over https and try again.';
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser cannot access the camera. Try Chrome, Edge, or Safari 14 or newer.';
  }
  if (typeof RTCPeerConnection === 'undefined') {
    return 'This browser does not support WebRTC, which live streaming needs.';
  }
  return null;
}
