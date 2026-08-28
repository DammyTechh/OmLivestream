import { api, unwrap } from '@/api/client';

/**
 * Publishing a live broadcast from the phone.
 *
 * The path a stream actually takes:
 *
 *   camera + mic  →  react-native-webrtc tracks
 *                 →  mediasoup-client producers over a WebRTC transport
 *                 →  the server's mediasoup router
 *                 →  ffmpeg  →  RTMP  →  every platform at once
 *
 * Everything up to the router is this file's job. From there the pipeline is
 * the one the website already uses, so a broadcast from a phone and one from a
 * laptop arrive at YouTube identically.
 *
 * ── Why the imports are dynamic ──────────────────────────────────
 * `react-native-webrtc` and `mediasoup-client` ship native code, so a static
 * import would make the whole app fail to load inside Expo Go — including the
 * screens that have nothing to do with streaming. Loading them at the moment
 * someone goes live means the rest of the product stays testable by scanning a
 * QR code, and only this one feature reports that it needs a dev build.
 *
 * `isPublishingAvailable()` is how the UI asks, before offering the button.
 */

type Track = { kind: string; stop: () => void; enabled: boolean };
type MediaStreamLike = { getVideoTracks: () => Track[]; getAudioTracks: () => Track[]; getTracks: () => Track[] };

export interface PublishHandle {
  stop: () => Promise<void>;
  setMicEnabled: (on: boolean) => void;
  setCameraEnabled: (on: boolean) => void;
  /** Swap the camera without renegotiating — see switchCamera below. */
  flipCamera: () => Promise<void>;
  stream: MediaStreamLike;
}

/** Cached so the check does not repeatedly pay for a failed module resolve. */
let available: boolean | null = null;

export function isPublishingAvailable(): boolean {
  if (available !== null) return available;
  try {
    require('react-native-webrtc');
    require('mediasoup-client');
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export const PUBLISHING_UNAVAILABLE_MESSAGE =
  'Live publishing needs the full app build. Expo Go cannot load the streaming ' +
  'engine, so this is available in the TestFlight or Play build.';

/**
 * Open the camera and start sending to the server.
 *
 * The order matters and is not arbitrary:
 *
 *  1. Ask the server for a transport. It returns the router's capabilities
 *     alongside it, which mediasoup-client must have before it can negotiate
 *     anything.
 *  2. Load the device with those capabilities.
 *  3. Create a *send* transport locally and wire its callbacks. The `connect`
 *     and `produce` events fire during negotiation, not before — mediasoup
 *     calls them when it needs the server to do something, and the promise it
 *     hands us must not resolve until the server has actually done it.
 *  4. Get the tracks and produce them.
 *
 * Video is produced before audio deliberately: video negotiation is the slower
 * and more failure-prone half, and finding out it failed while audio is
 * already flowing produces a stream with sound and a black picture — worse
 * than a clean failure.
 */
export async function startPublishing(opts: {
  streamId: string;
  facing?: 'front' | 'environment';
  audio?: boolean;
  onFailed?: (reason: string) => void;
}): Promise<PublishHandle> {
  if (!isPublishingAvailable()) throw new Error(PUBLISHING_UNAVAILABLE_MESSAGE);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mediaDevices } = require('react-native-webrtc');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mediasoupClient = require('mediasoup-client');

  const { streamId, facing = 'front', audio = true, onFailed } = opts;

  // ── 1. Transport + router capabilities ───────────────────────────
  const params = await api
    .post('/webrtc/create-transport', { streamId })
    .then(unwrap<{
      id: string;
      iceParameters: unknown;
      iceCandidates: unknown;
      dtlsParameters: unknown;
      routerRtpCapabilities: unknown;
    }>);

  if (!params.routerRtpCapabilities) {
    // A server too old to send these cannot be published to. Saying so beats
    // an opaque failure deep inside mediasoup's negotiation.
    throw new Error('This server does not support mobile publishing yet. Update the backend.');
  }

  // ── 2. Device ────────────────────────────────────────────────────
  const device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: params.routerRtpCapabilities });

  if (!device.canProduce('video')) {
    throw new Error('This device cannot send video in a format the server accepts.');
  }

  // ── 3. Send transport ────────────────────────────────────────────
  const transport = device.createSendTransport({
    id: params.id,
    iceParameters: params.iceParameters,
    iceCandidates: params.iceCandidates,
    dtlsParameters: params.dtlsParameters,
  });

  transport.on(
    'connect',
    async ({ dtlsParameters }: { dtlsParameters: unknown }, callback: () => void, errback: (e: Error) => void) => {
      try {
        await api.post('/webrtc/connect-transport', { transportId: transport.id, dtlsParameters });
        callback();
      } catch (err) {
        // errback, not throw: mediasoup is awaiting this callback, and throwing
        // here leaves the transport wedged in "connecting" for ever.
        errback(err as Error);
      }
    },
  );

  transport.on(
    'produce',
    async (
      { kind, rtpParameters }: { kind: string; rtpParameters: unknown },
      callback: (arg: { id: string }) => void,
      errback: (e: Error) => void,
    ) => {
      try {
        const res = await api
          .post('/webrtc/produce', { transportId: transport.id, kind, rtpParameters })
          .then(unwrap<{ id: string }>);
        callback({ id: res.id });
      } catch (err) {
        errback(err as Error);
      }
    },
  );

  transport.on('connectionstatechange', (state: string) => {
    if (state === 'failed' || state === 'disconnected') {
      onFailed?.(
        state === 'failed'
          ? 'The connection to the server failed. Check your network and start again.'
          : 'Connection lost. Trying to recover…',
      );
    }
  });

  // ── 4. Tracks ────────────────────────────────────────────────────
  const stream: MediaStreamLike = await mediaDevices.getUserMedia({
    audio,
    video: {
      facingMode: facing === 'front' ? 'user' : 'environment',
      width:  { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  });

  const videoTrack = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0];
  if (!videoTrack) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No camera track was produced.');
  }

  const producers: { close: () => void }[] = [];

  try {
    /**
     * Three spatial layers — simulcast.
     *
     * A phone on 4G in a car park and a phone on office wifi cannot sustain
     * the same bitrate, and the network changes mid-broadcast. Sending three
     * resolutions lets the server forward whichever the uplink can currently
     * carry, so a weak signal degrades to a smaller picture instead of
     * freezing.
     *
     * VP8/H.264 both honour this; the bitrates are the ones that survive a
     * congested mobile network rather than theoretical maxima.
     */
    producers.push(
      await transport.produce({
        track: videoTrack,
        encodings: [
          { rid: 'low',  maxBitrate: 200_000,   scaleResolutionDownBy: 4 },
          { rid: 'mid',  maxBitrate: 700_000,   scaleResolutionDownBy: 2 },
          { rid: 'high', maxBitrate: 2_500_000, scaleResolutionDownBy: 1 },
        ],
        codecOptions: { videoGoogleStartBitrate: 1000 },
      }),
    );

    if (audioTrack) {
      producers.push(
        await transport.produce({
          track: audioTrack,
          codecOptions: { opusStereo: true, opusDtx: true },
        }),
      );
    }
  } catch (err) {
    // Anything half-created is torn down, so a failed start cannot leave the
    // camera light on or a producer stranded on the server.
    producers.forEach((p) => p.close());
    transport.close();
    stream.getTracks().forEach((t) => t.stop());
    throw err;
  }

  return {
    stream,

    stop: async () => {
      producers.forEach((p) => p.close());
      transport.close();
      stream.getTracks().forEach((t) => t.stop());
    },

    setMicEnabled: (on) => { if (audioTrack) audioTrack.enabled = on; },
    setCameraEnabled: (on) => { videoTrack.enabled = on; },

    /**
     * Flip the camera without renegotiating.
     *
     * `_switchCamera` swaps the capture device behind the *same* track, so the
     * producer never notices. Replacing the track instead would tear down and
     * rebuild the video producer mid-broadcast — a visible freeze on every
     * platform, for what should be instant.
     */
    flipCamera: async () => {
      const t = videoTrack as unknown as { _switchCamera?: () => void };
      t._switchCamera?.();
    },
  };
}
