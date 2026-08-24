import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';

/**
 * The icon set.
 *
 * Drawn here rather than pulled from a pack, for one reason: consistency of
 * weight. Icon libraries mix 1.5px and 2px strokes, filled and outline forms,
 * and different corner treatments, and once a few of those sit together in a
 * tab bar the interface starts to look assembled rather than designed. These
 * share one grid, one stroke width and one cap style.
 *
 * All of them take `currentColor` semantics via the `color` prop and default
 * to the muted text colour, so an icon can never end up invisible against a
 * surface the way a hard-coded white one can.
 */

export type IconName =
  | 'home' | 'broadcast' | 'video' | 'link' | 'chart' | 'settings'
  | 'camera' | 'cameraOff' | 'mic' | 'micOff' | 'switchCamera' | 'screenShare'
  | 'chevronRight' | 'chevronLeft' | 'close' | 'plus' | 'check' | 'lock'
  | 'user' | 'logout' | 'star' | 'alert' | 'eye' | 'heart' | 'clock' | 'sparkle';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 22, color, strokeWidth = 1.75 }: Props) {
  const { t } = useTheme();
  const c = color ?? t.textMuted;
  const p = { stroke: c, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {(() => {
        switch (name) {
          case 'home':
            return <><Path d="M3 10.5 12 3l9 7.5" {...p} /><Path d="M5.5 9.5V20h13V9.5" {...p} /></>;
          case 'broadcast':
            return <><Circle cx="12" cy="12" r="2.5" {...p} />
                     <Path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4" {...p} />
                     <Path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2" {...p} /></>;
          case 'video':
            return <><Rect x="3" y="6" width="12.5" height="12" rx="2.5" {...p} />
                     <Path d="m15.5 10.5 5.5-3v9l-5.5-3" {...p} /></>;
          case 'link':
            return <><Path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.5 6.3" {...p} />
                     <Path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.3-1.3" {...p} /></>;
          case 'chart':
            return <><Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" {...p} /></>;
          case 'settings':
            return <><Circle cx="12" cy="12" r="3" {...p} />
                     <Path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" {...p} /></>;
          case 'camera':
            return <><Path d="M3 8.5h3.5L8 6h8l1.5 2.5H21V19H3z" {...p} /><Circle cx="12" cy="13" r="3.5" {...p} /></>;
          case 'cameraOff':
            return <><Path d="M3 8.5h3.5L8 6h5" {...p} /><Path d="M21 8.5V19H6" {...p} /><Path d="M3.5 3.5 20.5 20.5" {...p} /></>;
          case 'mic':
            return <><Rect x="9" y="3" width="6" height="11" rx="3" {...p} />
                     <Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" {...p} /></>;
          case 'micOff':
            return <><Path d="M9 6a3 3 0 0 1 6 0v5" {...p} />
                     <Path d="M5.5 11.5a6.5 6.5 0 0 0 9.5 5.8M12 18v3" {...p} />
                     <Path d="M3.5 3.5 20.5 20.5" {...p} /></>;
          case 'switchCamera':
            return <><Path d="M3 8.5h3.5L8 6h8l1.5 2.5H21V19H3z" {...p} />
                     <Path d="M10 13h4l-1.4-1.6M14 15h-4l1.4 1.6" {...p} /></>;
          case 'screenShare':
            return <><Rect x="2.5" y="4" width="19" height="12.5" rx="2" {...p} />
                     <Path d="M8.5 20.5h7M12 16.5v4" {...p} />
                     <Path d="M12 12.5V7M9.5 9.5 12 7l2.5 2.5" {...p} /></>;
          case 'chevronRight': return <Path d="m9 5 7 7-7 7" {...p} />;
          case 'chevronLeft':  return <Path d="m15 5-7 7 7 7" {...p} />;
          case 'close':        return <Path d="M6 6l12 12M18 6 6 18" {...p} />;
          case 'plus':         return <Path d="M12 5v14M5 12h14" {...p} />;
          case 'check':        return <Path d="m4.5 12.5 5 5 10-11" {...p} />;
          case 'lock':
            return <><Rect x="4.5" y="10.5" width="15" height="10" rx="2.5" {...p} />
                     <Path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" {...p} /></>;
          case 'user':
            return <><Circle cx="12" cy="8" r="3.75" {...p} /><Path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" {...p} /></>;
          case 'logout':
            return <><Path d="M15 4.5H19a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 19.5h-4" {...p} />
                     <Path d="M11 8.5 15 12l-4 3.5M15 12H3.5" {...p} /></>;
          case 'star':
            return <Path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9z" {...p} />;
          case 'alert':
            return <><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 7.5v5.5M12 16.2v.3" {...p} /></>;
          case 'eye':
            return <><Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12" {...p} />
                     <Circle cx="12" cy="12" r="3" {...p} /></>;
          case 'heart':
            return <Path d="M12 20s-7.5-4.7-7.5-9.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8C19.5 15.3 12 20 12 20" {...p} />;
          case 'clock':
            return <><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 7v5.2l3.2 2" {...p} /></>;
          case 'sparkle':
            return <Path d="M12 3.5 13.6 9 19 10.6 13.6 12.2 12 17.7 10.4 12.2 5 10.6 10.4 9z" {...p} />;
          default:
            return null;
        }
      })()}
    </Svg>
  );
}
