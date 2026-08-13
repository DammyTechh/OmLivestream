/**
 * What is the creator streaming from, and what can that device actually do?
 *
 * Two different questions get answered here:
 *
 *  1. Desktop or mobile. A phone has a front and a back camera and no way to
 *     plug in a third; a computer has whatever is plugged into it and a whole
 *     ecosystem of virtual-camera software for mixing several angles. The
 *     advice worth giving is completely different, so we detect and branch.
 *
 *  2. Whether two cameras can genuinely run at the same time. This is the part
 *     that matters most, because the honest answer is "it depends on the
 *     device" and getting it wrong strands a creator mid-setup:
 *
 *       • Desktop — generally yes. Two separate devices (built-in webcam plus a
 *         USB camera, or a virtual camera) open independently.
 *       • Android — sometimes. Multi-camera capture is permitted by the
 *         platform but is hardware and driver dependent; plenty of devices
 *         fail with NotReadableError when the second camera opens.
 *       • iPhone / iPad — no. iOS supports multi-camera natively through
 *         AVCaptureMultiCamSession, but Safari does not expose it to the web,
 *         and opening a second camera stops the first. Every browser on iOS is
 *         WebKit, so Chrome and Firefox on iPhone inherit this too.
 *
 *     We cannot reliably prove the answer without trying, so `dualCamera` here
 *     is a *prediction* used to set expectations in the UI. The real check is
 *     the attempt itself, which falls back cleanly — see useMultiCam.
 */

export type DeviceKind = 'desktop' | 'mobile' | 'tablet';
export type DualCameraSupport = 'likely' | 'unlikely' | 'unsupported' | 'unknown';

export interface DeviceProfile {
  kind: DeviceKind;
  isIOS: boolean;
  isAndroid: boolean;
  isDesktop: boolean;
  /** Whether two cameras can plausibly run simultaneously on this device. */
  dualCamera: DualCameraSupport;
  /** Plain-language reason, shown to the creator when dual camera isn't available. */
  dualCameraNote: string;
}

/**
 * Our own multi-camera tool, in progress. Kept as a constant so switching the
 * desktop suggestion from third-party software to our own is a one-line change
 * once it ships — nothing else in the app needs to know the URL.
 */
export const OMLIVE_MULTICAM_URL = 'https://multicam.omlivestream.com';

/** Flip to true when multicam.omlivestream.com is live, and it takes over the suggestion. */
export const OMLIVE_MULTICAM_READY = false;

export interface CameraTool {
  name: string;
  url: string;
  blurb: string;
  platforms: string;
  free: boolean;
}

/**
 * Virtual-camera software worth suggesting on desktop.
 *
 * These all do the same essential job: take several real cameras (plus screen
 * shares, slides, images), mix them into one composed picture, and publish that
 * as a single virtual webcam the browser can pick like any other camera. That
 * is exactly what a venue needs to put a multi-angle feed on a big screen, and
 * it lifts the ceiling well past the two cameras a browser can open by itself.
 */
export const DESKTOP_CAMERA_TOOLS: CameraTool[] = [
  {
    name: 'OBS Studio',
    url: 'https://obsproject.com',
    blurb: 'Free and open source. Unlimited camera angles, scenes and overlays, published as a virtual camera.',
    platforms: 'Windows, macOS, Linux',
    free: true,
  },
  {
    name: 'ManyCam',
    url: 'https://manycam.com',
    blurb: 'Multi-camera switching with picture-in-picture layouts and effects, built for live presenters.',
    platforms: 'Windows, macOS',
    free: false,
  },
  {
    name: 'mmhmm',
    url: 'https://www.mmhmm.app',
    blurb: 'Presenter-focused layouts that put you and your slides in one frame.',
    platforms: 'Windows, macOS',
    free: false,
  },
];

const hasWindow = () => typeof window !== 'undefined' && typeof navigator !== 'undefined';

/**
 * iPadOS reports itself as a Mac. The reliable tell is a "Macintosh" UA that
 * also reports touch points, which no real desktop Mac does.
 */
function detectIOS(ua: string): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return ua.includes('Macintosh') && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
}

export function getDeviceProfile(): DeviceProfile {
  // Server render / no DOM: assume desktop and claim nothing about cameras.
  if (!hasWindow()) {
    return {
      kind: 'desktop', isIOS: false, isAndroid: false, isDesktop: true,
      dualCamera: 'unknown', dualCameraNote: '',
    };
  }

  const ua        = navigator.userAgent || '';
  const isIOS     = detectIOS(ua);
  const isAndroid = /Android/i.test(ua);
  const isTablet  = /iPad/i.test(ua) || (isIOS && navigator.maxTouchPoints > 1) || (isAndroid && !/Mobile/i.test(ua));
  const isPhone   = !isTablet && (isIOS || isAndroid || /Mobile|webOS|BlackBerry|Windows Phone/i.test(ua));
  const isDesktop = !isTablet && !isPhone;

  const kind: DeviceKind = isDesktop ? 'desktop' : isTablet ? 'tablet' : 'mobile';

  let dualCamera: DualCameraSupport;
  let dualCameraNote: string;

  if (isIOS) {
    dualCamera = 'unsupported';
    dualCameraNote =
      'iPhone and iPad can only run one camera at a time in the browser — opening the second one stops the first. ' +
      'You can still switch between front and back instantly.';
  } else if (isAndroid) {
    dualCamera = 'unlikely';
    dualCameraNote =
      'Some Android phones can run both cameras at once and some can\'t — it depends on the hardware. ' +
      'We\'ll try, and fall back to a single camera if yours can\'t.';
  } else if (isDesktop) {
    dualCamera = 'likely';
    dualCameraNote =
      'Your computer can usually run two cameras at once — for example the built-in webcam plus a USB camera.';
  } else {
    dualCamera = 'unknown';
    dualCameraNote = 'We\'ll try both cameras and fall back to one if your device can\'t manage it.';
  }

  return { kind, isIOS, isAndroid, isDesktop, dualCamera, dualCameraNote };
}
