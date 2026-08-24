import React, { useState } from 'react';
import { Modal, View, Pressable, StyleSheet, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { api, getApiError } from '@/api/client';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/hooks/useTheme';
import { space, radius } from '@/constants/theme';
import { Txt, Button } from '@/components/ui';
import { Icon } from '@/components/Icon';

const SITE = (Constants.expoConfig?.extra?.siteUrl as string) ?? 'https://www.omlivestream.com';

/**
 * Upgrading to Premium, without getting the app rejected.
 *
 * This is the one place where doing the obvious thing is actively dangerous,
 * so the reasoning is written down rather than assumed.
 *
 * **iOS.** App Review guideline 3.1.1 requires that anything unlocking digital
 * features inside an app be sold through Apple's in-app purchase. A Paystack
 * sheet here — however good it looks — is the exact pattern Apple rejects, and
 * the rejection notices name it explicitly ("the app unlocks additional
 * functionality with mechanisms other than in-app purchase"). The May 2025
 * court ruling relaxed this for external *links*, but **only on the United
 * States storefront**; a Nigeria-first product does not benefit.
 *
 * So on iOS this sheet sells nothing. Guideline 3.1.3(b) (Multiplatform
 * Services) expressly permits an app to *honour* a subscription bought
 * elsewhere, provided the app does not steer people to that purchase. The copy
 * therefore states plainly what Premium includes and where the account is
 * managed, with no button and no link. That is Spotify's and Netflix's
 * arrangement, and it passes review.
 *
 * **Android.** Play's Payments policy has the same shape, but Google permits
 * alternative billing far more broadly and OmliveStream is not a Play Billing
 * app. Paystack opens here in a proper in-app browser tab — the checkout the
 * website uses, so the same card, the same receipt, the same subscription
 * record.
 *
 * When IAP is worth building, it slots in behind `canPurchaseInApp` without
 * touching anything else.
 */

/**
 * Where checkout happens on each platform.
 *
 * Android opens Paystack in an in-app browser tab. iOS sends people to the web
 * payment page instead — Apple's 3.1.1 forbids a non-IAP purchase *inside* the
 * app, and a link out is only permitted on the US storefront, so this is a
 * deliberate business decision rather than an oversight. Set to 'none' to hide
 * the CTA on iOS entirely if App Review pushes back; nothing else changes.
 */
const IOS_UPGRADE_MODE: 'web' | 'none' = 'web';

const canPurchaseInApp = Platform.OS !== 'ios';

const PREMIUM_FEATURES = [
  'Stream to all 8 platforms at once',
  'Reply to comments across every platform',
  'AI Studio — titles, assistant and video editing',
  'Switch cameras while you stream',
  'Recordings kept for a year',
];

export function UpgradeSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t, gutter } = useTheme();
  const insets = useSafeAreaInsets();
  const { refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);

  /**
   * Opens the same Paystack checkout the website uses.
   *
   * An in-app browser tab rather than a WebView: the tab shares cookies with
   * the user's browser (so a saved card autofills), shows the real URL — which
   * is what makes a payment page trustworthy — and keeps card entry out of our
   * process entirely, which is the whole point of a hosted checkout.
   */
  /**
   * iOS: the web payment page, returning here when it settles.
   *
   * `openAuthSessionAsync` rather than `openBrowserAsync`, because it watches
   * for the redirect back to our scheme and closes itself — with a plain
   * browser the user pays and is then left staring at a web page, which is
   * exactly the dead end this is meant to remove.
   *
   * The web page is told where to come back to and appends the real outcome,
   * which it only knows after polling the subscription. So the app reports
   * what actually happened rather than assuming success from a redirect.
   */
  /**
   * One checkout path for both platforms.
   *
   * The app calls /billing/subscribe with its *own* token and opens the
   * Paystack URL it returns. That detail matters: sending someone to the web
   * payment page instead would meet a sign-in wall, because the browser has no
   * session even though the app does — the exact dead end this is meant to
   * avoid. Going straight to Paystack's hosted page means the browser never
   * needs to know who they are.
   *
   * `appReturn` is carried through to Paystack's callback_url, so after paying
   * the browser lands on our callback page, which confirms the subscription
   * really activated and then hands control back here with the outcome.
   *
   * `openAuthSessionAsync` rather than a plain browser: it watches for the
   * redirect to our scheme and closes itself. With a plain tab the user pays
   * and is then left staring at a web page.
   */
  const startCheckout = async () => {
    setBusy(true);
    try {
      const ret = Linking.createURL('payment/callback');

      const { paystackAuthUrl } = await api
        .post('/billing/subscribe', {
          plan: 'premium',
          billingCycle: 'monthly',
          paymentMethod: 'card',
          appReturn: ret,
        })
        .then((r) => r.data.data as { paystackAuthUrl: string });

      const result = await WebBrowser.openAuthSessionAsync(paystackAuthUrl, ret);

      // The webhook is what grants Premium, so the app never trusts the
      // redirect — it re-reads the plan either way.
      await new Promise((r) => setTimeout(r, 800));
      await refreshProfile();

      const status =
        result.type === 'success' && result.url
          ? (Linking.parse(result.url).queryParams?.status as string | undefined)
          : undefined;

      if (status === 'active') {
        Alert.alert('Welcome to Premium', 'Everything is unlocked. Enjoy.');
      } else if (status === 'pending') {
        // A slow webhook is not a failure. Saying so avoids a support message
        // from someone whose money has already left their account.
        Alert.alert(
          'Payment received',
          'We are still confirming it with your bank. Premium usually unlocks within a minute.',
        );
      }
      onClose();
    } catch (err) {
      Alert.alert('Could not open checkout', getApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: t.overlay }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: t.surface,
              borderColor: t.border,
              paddingHorizontal: gutter,
              paddingBottom: insets.bottom + space.xl,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: t.border }]} />

          <Pressable onPress={onClose} style={styles.close} hitSlop={12}>
            <Icon name="close" size={18} />
          </Pressable>

          <Txt variant="h1">Premium</Txt>
          <Txt variant="small" muted style={{ marginTop: 6, marginBottom: space.xl }}>
            Everything you need to broadcast properly.
          </Txt>

          <View style={{ gap: space.md, marginBottom: space.xl }}>
            {PREMIUM_FEATURES.map((f) => (
              <View key={f} style={styles.row}>
                <Icon name="check" size={17} color={t.primary} />
                <Txt variant="body" style={{ flex: 1 }}>{f}</Txt>
              </View>
            ))}
          </View>

          {canPurchaseInApp || IOS_UPGRADE_MODE === 'web' ? (
            <>
              <Button
                title={busy ? 'Opening checkout…' : 'Upgrade to Premium'}
                size="lg"
                fullWidth
                loading={busy}
                onPress={startCheckout}
              />
              <Txt variant="small" muted style={{ textAlign: 'center', marginTop: space.md }}>
                Paid securely through Paystack. You&apos;ll come straight back
                here when it&apos;s done.
              </Txt>
            </>
          ) : (
            /* iOS: informational only. No button, no link — see the note at the
               top of this file. */
            <View style={[styles.notice, { backgroundColor: t.surfaceAlt, borderColor: t.border }]}>
              <Txt variant="small" muted style={{ lineHeight: 20 }}>
                Premium is managed from your OmliveStream account. Once your plan is
                active, everything above unlocks here automatically.
              </Txt>
            </View>
          )}

          <Txt variant="small" muted style={{ textAlign: 'center', marginTop: space.lg }}>
            Cancel any time. Your recordings stay yours.
          </Txt>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space.xl },
  close: { position: 'absolute', top: space.xl, right: space.lg, zIndex: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  notice: { padding: space.lg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
});
