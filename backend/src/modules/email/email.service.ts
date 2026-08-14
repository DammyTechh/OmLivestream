import { Resend } from 'resend';
import { env, urls } from '../../config/env';
import { logger } from '../../config/logger';
import { WAITLIST_DISCOUNT_PCT, WAITLIST_DISCOUNT_MONTHS } from '../../config/pricing';

const resend = new Resend(env.RESEND_API_KEY);

// ── Design tokens ─────────────────────────────────────────────────
// Email clients need an absolute URL — they have no origin to resolve a
// relative path against — so the logo is served from the marketing site,
// which hosts it at public/logo.png. Previously an imgur hot-link, which
// meant every transactional email we sent depended on a third-party image
// host staying up and not rate-limiting us.
const bg      = '#07050F';
const surface = '#0F0C1E';
const text    = '#F8F5FF';
const muted   = '#6B6880';
const brand   = '#6D28D9';
const line    = 'rgba(255,255,255,0.08)';

/** Absolute — an email has no origin to resolve a relative path against. */
const logoMark = `${urls.site.replace(/\/+$/, '')}/logo-mark.png`;

// ── Template helpers ──────────────────────────────────────────────
const wrap = (body: string) => `<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:${bg};font-family:'DM Sans',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${bg};padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:${surface};border-radius:16px;border:1px solid ${line};overflow:hidden;max-width:560px;width:100%;">

<!-- A hairline of brand colour instead of a solid block of it.

     The header used to be a 26px-tall slab of #6D28D9 across the full width,
     which is a lot of saturated purple to open an email into and made every
     message read as an advert before it read as a receipt or a login code. A
     4px rule carries the brand just as clearly and lets the content lead. -->
<tr><td style="background:${brand};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>

<tr><td style="padding:24px 40px 20px;text-align:center;border-bottom:1px solid ${line};">
  <!-- Mark + wordmark. The mark is a PNG, not the WebP the site uses: Outlook
       and several older clients cannot decode WebP and would show a broken
       image box. It is served absolutely from the marketing site because an
       email has no origin to resolve a relative path against.

       The wordmark stays as text beside it rather than being baked into the
       image, so the brand is still legible in the many clients that block
       remote images by default. -->
  <img src="${logoMark}" width="26" height="26" alt=""
       style="display:inline-block;vertical-align:middle;border:0;outline:none;margin-right:8px;">
  <span style="font-size:19px;font-weight:700;letter-spacing:-0.02em;color:${text};vertical-align:middle;">Omlive<span style="color:#A855F7;">Stream</span></span>
</td></tr>
${body}
<tr><td style="padding:20px 40px;border-top:1px solid ${line};text-align:center;">
  <p style="color:${muted};font-size:12px;margin:0 0 8px;">
    Need help? <a href="mailto:${env.SUPPORT_EMAIL}" style="color:#A855F7;text-decoration:none;">${env.SUPPORT_EMAIL}</a>
    &nbsp;•&nbsp; Sales: <a href="mailto:${env.SALES_EMAIL}" style="color:#A855F7;text-decoration:none;">${env.SALES_EMAIL}</a>
  </p>
  <p style="color:${muted};font-size:12px;margin:0;">© ${new Date().getFullYear()} OmliveStream. All rights reserved.</p>
</td></tr>
</table></td></tr></table></body></html>`;

const row = (label: string, value: string) =>
  `<tr><td style="color:${muted};font-size:14px;padding:6px 0;">${label}</td><td style="color:${text};font-size:14px;text-align:right;padding:6px 0;">${value}</td></tr>`;

const btn = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:${brand};color:#FFFFFF;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:600;font-size:15px;">${label}</a>`;

// ── Email Service ─────────────────────────────────────────────────
export class EmailService {
  private readonly from = env.EMAIL_FROM;

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      // reply_to so a user replying to an automated email reaches a human
      // inbox instead of the unmonitored no-reply sender.
      await resend.emails.send({ from: this.from, reply_to: env.SUPPORT_EMAIL, to, subject, html });
      logger.info({ to, subject }, 'Email sent');
    } catch (err) {
      logger.error({ err, to, subject }, 'Email failed — non-fatal, continuing');
    }
  }

  // ── 1. OTP verification ────────────────────────────────────────
  async sendOtpEmail(to: string, otp: string, isNewUser: boolean): Promise<void> {
    const subject = isNewUser
      ? `Your OmliveStream verification code: ${otp}`
      : `OmliveStream login code: ${otp}`;
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">${isNewUser ? 'Verify your email' : 'Your login code'}</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 28px;">${isNewUser ? 'Use this code to activate your account.' : 'Enter this code to sign in. Expires in 10 minutes.'}</p>
      <div style="background:#14102A;border:1px solid rgba(124,58,237,0.3);border-radius:12px;padding:24px;text-align:center;margin:0 0 28px;">
        <span style="font-family:'Courier New',monospace;font-size:44px;font-weight:700;letter-spacing:14px;color:#A855F7;">${otp}</span>
      </div>
      <p style="color:${muted};font-size:13px;line-height:1.6;margin:0;">Expires in <strong style="color:${text};">10 minutes</strong> &nbsp;•&nbsp; Never share this code.</p>
    </td></tr>`);
    await this.send(to, subject, html);
  }

  // ── 2. Welcome ─────────────────────────────────────────────────
  async sendWelcomeEmail(to: string): Promise<void> {
    /**
     * The steps were an <ol> whose items each ran "Title — description" on one
     * wrapped line at line-height 2. At email width that broke mid-phrase and
     * the em dashes read as stray punctuation once a line turned over, which
     * is what made it look scattered. Each step is now its own row: a numbered
     * marker, the action in the product's own words, and the detail on the
     * line beneath it. No dashes doing structural work.
     */
    const step = (n: number, title: string, detail: string) => `
      <tr>
        <td width="30" valign="top" style="padding:0 0 16px;">
          <div style="width:22px;height:22px;border-radius:11px;background:rgba(168,85,247,0.15);color:#A855F7;font-size:12px;font-weight:700;text-align:center;line-height:22px;">${n}</div>
        </td>
        <td valign="top" style="padding:0 0 16px;">
          <div style="color:${text};font-size:15px;font-weight:600;line-height:1.4;">${title}</div>
          <div style="color:${muted};font-size:13px;line-height:1.6;margin-top:2px;">${detail}</div>
        </td>
      </tr>`;

    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 10px;">Your account is ready</h2>
      <p style="color:${muted};font-size:15px;line-height:1.65;margin:0 0 26px;">
        Welcome to OmliveStream. Go live once and reach every platform at the same time.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
        ${step(1, 'Connect your platforms', 'YouTube, TikTok, Twitch, Instagram and more.')}
        ${step(2, 'Create a stream', 'Add a title and thumbnail, then choose where it goes.')}
        ${step(3, 'Go live', 'One broadcast, your whole audience, all at once.')}
      </table>

      <div style="text-align:center;">${btn(`${urls.dashboard}/dashboard`, 'Go to dashboard')}</div>
    </td></tr>`);
    await this.send(to, 'Welcome to OmliveStream — your account is ready', html);
  }

  // ── 3. Payment receipt ─────────────────────────────────────────
  /**
   * The receipt a customer keeps.
   *
   * Paystack sends its own receipt as well, from noreply@paystack.com. That
   * one is theirs — its layout lives in the Paystack dashboard, not in this
   * codebase, and nothing here can restyle it. This is the receipt we control,
   * so it carries the things a customer actually needs later: what they bought,
   * for which period, what card it went on, and when the next charge lands.
   *
   * Every enriched field is optional. The webhook may not carry card details
   * for every channel (bank transfer, USSD), and a receipt is not the place to
   * print "undefined" — absent fields are simply omitted.
   */
  async sendReceiptEmail(to: string, d: {
    amount: number;
    reference: string;
    plan: string;
    billingCycle: string;
    cardBrand?: string | null;
    cardLast4?: string | null;
    channel?: string | null;
    paidAt?: string | null;
    nextBillingDate?: string | null;
  }): Promise<void> {
    const amount = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(d.amount / 100);
    const paid = d.paidAt ? new Date(d.paidAt) : new Date();
    const paidStr = paid.toLocaleDateString('en-NG', { dateStyle: 'long' });

    // "Visa ending 4081" where we know it, otherwise the channel ("bank
    // transfer"), otherwise nothing at all rather than a blank row.
    const method = d.cardLast4
      ? `${(d.cardBrand ?? 'Card').replace(/^\w/, (c) => c.toUpperCase())} ending ${d.cardLast4}`
      : d.channel
        ? d.channel.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
        : null;

    const cycleLabel = d.billingCycle === 'annual' ? 'Annual' : 'Monthly';
    const nextStr = d.nextBillingDate
      ? new Date(d.nextBillingDate).toLocaleDateString('en-NG', { dateStyle: 'long' })
      : null;

    const html = wrap(`<tr><td style="padding:36px 40px;">
      <div style="text-align:center;margin-bottom:26px;">
        <div style="color:#10B981;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:10px;">Payment received</div>
        <div style="color:${text};font-size:32px;font-weight:700;letter-spacing:-0.02em;">${amount}</div>
        <div style="color:${muted};font-size:13px;margin-top:6px;">Paid on ${paidStr}</div>
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#14102A;border-radius:12px;padding:20px;margin-bottom:20px;">
        ${row('Plan', `OmliveStream ${d.plan}`)}
        ${row('Billing', cycleLabel)}
        ${method ? row('Paid with', method) : ''}
        ${nextStr ? row('Next charge', nextStr) : ''}
        <tr><td colspan="2" style="border-top:1px solid ${line};padding-top:12px;"></td></tr>
        ${row('Total paid', `<span style="color:#10B981;font-weight:700;">${amount}</span>`)}
      </table>

      <p style="color:${muted};font-size:12px;line-height:1.7;margin:0 0 22px;">
        Reference <span style="font-family:monospace;color:${text};">${d.reference}</span><br>
        Keep this email for your records. You can also view every invoice under
        Billing in your dashboard.
      </p>

      <div style="text-align:center;">${btn(`${urls.dashboard}/dashboard/billing`, 'View billing')}</div>
    </td></tr>`);

    await this.send(to, `Your OmliveStream receipt — ${amount}`, html);
  }

  // ── 4. Subscription cancelled ──────────────────────────────────
  async sendCancellationEmail(to: string, periodEnd: string): Promise<void> {
    const endDate = new Date(periodEnd).toLocaleDateString('en-NG', { dateStyle: 'long' });
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">Subscription Cancelled</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 12px;">Your subscription has been cancelled. Premium access continues until <strong style="color:${text};">${endDate}</strong>.</p>
      <p style="color:${muted};font-size:14px;line-height:1.6;margin:0 0 28px;">You can resubscribe any time from your billing settings.</p>
      ${btn(`${urls.payment}/billing`, 'Resubscribe')}
    </td></tr>`);
    await this.send(to, 'OmliveStream — Subscription cancelled', html);
  }

  // ── 5. Recording ready ─────────────────────────────────────────
  async sendRecordingReadyEmail(to: string, streamTitle: string): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">Your recording is ready</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 8px;">Your stream <strong style="color:${text};">"${streamTitle}"</strong> has been saved successfully.</p>
      <p style="color:${muted};font-size:14px;line-height:1.6;margin:0 0 28px;">Download, AI-edit, or publish directly to your platforms.</p>
      ${btn(`${urls.dashboard}/recordings`, 'View recording')}
    </td></tr>`);
    await this.send(to, `Recording ready: "${streamTitle}"`, html);
  }

  // ── 6. Birthday ────────────────────────────────────────────────
  async sendBirthdayEmail(to: string, name: string): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;text-align:center;">
      <h2 style="color:${text};font-size:24px;font-weight:800;margin:0 0 12px;">Happy birthday, ${name || 'Creator'}</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 28px;">Wishing you a great day from everyone at OmliveStream. If you are celebrating on camera, we would love to see it.</p>
      ${btn(`${urls.dashboard}/dashboard`, 'Start a Birthday Stream')}
    </td></tr>`);
    await this.send(to, 'Happy birthday from OmliveStream', html);
  }

  // ── 7. Re-engagement ───────────────────────────────────────────
  async sendReEngagementEmail(to: string, name: string): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">Your audience is waiting, ${name || 'Creator'}</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 12px;">You haven't streamed in 5 days. Your followers across all your connected platforms are waiting.</p>
      <p style="color:${muted};font-size:14px;line-height:1.6;margin:0 0 28px;">Consistency is what builds an audience. Even a short stream keeps the momentum going.</p>
      ${btn(`${urls.dashboard}/dashboard`, 'Go live')}
    </td></tr>`);
    await this.send(to, `${name || 'Creator'}, your audience is waiting`, html);
  }

  // ── 8. Feedback confirmation ───────────────────────────────────
  async sendFeedbackConfirmation(to: string): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">Thank you for your feedback</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0;">We read every message. Your input shapes how OmliveStream grows.</p>
    </td></tr>`);
    await this.send(to, 'OmliveStream — we received your feedback', html);
  }

  // ── 9. Subscription renewal ────────────────────────────────────
  async sendRenewalEmail(to: string, nextBillingDate: string, plan: string): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">Subscription renewed</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 8px;">Your <strong style="color:${text};">${plan}</strong> plan has been renewed successfully.</p>
      <p style="color:${muted};font-size:14px;margin:0 0 28px;">Next billing date: <strong style="color:${text};">${new Date(nextBillingDate).toLocaleDateString('en-NG', { dateStyle: 'long' })}</strong></p>
      ${btn(`${urls.payment}/billing`, 'View billing')}
    </td></tr>`);
    await this.send(to, 'OmliveStream — Subscription renewed', html);
  }

  // ── 10. Feature update ─────────────────────────────────────────
  async sendFeatureUpdateEmail(to: string, title: string, description: string): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <span style="display:inline-block;background:rgba(124,58,237,0.15);color:#A855F7;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:4px 12px;border-radius:99px;margin-bottom:16px;">New Feature</span>
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">${title}</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 28px;">${description}</p>
      ${btn(`${urls.dashboard}/dashboard`, 'Try it now')}
    </td></tr>`);
    await this.send(to, `New on OmliveStream: ${title}`, html);
  }

  // ── 11. New device login alert ─────────────────────────────────
  async sendNewDeviceLoginEmail(to: string, d: { ip: string; userAgent: string; time: string }): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <div style="margin-bottom:20px;">
        <span style="display:inline-block;background:rgba(239,68,68,0.15);color:#EF4444;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:5px 12px;border-radius:99px;">Security alert</span>
      </div>
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">New device sign-in detected</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 20px;">Someone signed into your OmliveStream account from an unrecognised device.</p>
      <table width="100%" style="background:#14102A;border-radius:12px;padding:20px;margin-bottom:24px;">
        ${row('Time', d.time)}
        ${row('IP Address', d.ip)}
        ${row('Device', d.userAgent.slice(0, 60) + (d.userAgent.length > 60 ? '…' : ''))}
      </table>
      <p style="color:${muted};font-size:14px;line-height:1.6;margin:0 0 24px;">If this was you, no action needed. If not, secure your account immediately.</p>
      ${btn(`${urls.dashboard}/settings/security`, 'Secure my account')}
    </td></tr>`);
    await this.send(to, 'New device sign-in to your OmliveStream account', html);
  }

  // ── 12. Admin manually granted premium ────────────────────────
  async sendAdminGrantedPremiumEmail(to: string, name: string, billingCycle: string, periodEnd: string): Promise<void> {
    const endDate = new Date(periodEnd).toLocaleDateString('en-NG', { dateStyle: 'long' });
    const html = wrap(`<tr><td style="padding:36px 40px;text-align:center;">
      <h2 style="color:${text};font-size:24px;font-weight:800;margin:0 0 12px;">You're now on Premium, ${name || 'Creator'}</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 16px;">Your OmliveStream Premium subscription has been activated by our team.</p>
      <table width="100%" style="background:#14102A;border-radius:12px;padding:20px;margin-bottom:24px;text-align:left;">
        ${row('Plan', 'Premium')}
        ${row('Billing Cycle', billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1))}
        ${row('Access Until', endDate)}
      </table>
      <p style="color:${muted};font-size:14px;margin:0 0 28px;">Full access — comment replies, AI editing, 8 platforms, analytics.</p>
      ${btn(`${urls.dashboard}/dashboard`, 'Start streaming')}
    </td></tr>`);
    await this.send(to, 'Your OmliveStream Premium plan is active', html);
  }

  // ── 13. Waitlist confirmation ──────────────────────────────────
  async sendWaitlistConfirmationEmail(to: string): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;text-align:center;">
      <h2 style="color:${text};font-size:24px;font-weight:800;margin:0 0 16px;">You're on the list</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 28px;">Welcome to the OmliveStream waitlist. Here's what you get when we launch:</p>
      <table width="100%" style="background:#14102A;border-radius:12px;padding:24px;margin-bottom:28px;text-align:left;">
        <tr><td style="padding:12px 0;border-bottom:1px solid rgba(124,58,237,0.15);">
          <p style="margin:0;color:${text};font-size:15px;font-weight:700;">One month free</p>
          <p style="margin:4px 0 0;color:${muted};font-size:13px;">Full Premium access, completely free for your first month</p>
        </td></tr>
        <tr><td style="padding:12px 0;border-bottom:1px solid rgba(124,58,237,0.15);">
          <p style="margin:0;color:${text};font-size:15px;font-weight:700;">${WAITLIST_DISCOUNT_PCT}% off your first ${WAITLIST_DISCOUNT_MONTHS} months</p>
          <p style="margin:4px 0 0;color:${muted};font-size:13px;">${WAITLIST_DISCOUNT_PCT}% off every month for your first ${WAITLIST_DISCOUNT_MONTHS} months of Premium</p>
        </td></tr>
        <tr><td style="padding:12px 0;">
          <p style="margin:0;color:${text};font-size:15px;font-weight:700;">Full Premium access</p>
          <p style="margin:4px 0 0;color:${muted};font-size:13px;">Stream to 8 platforms, comment replies, AI editing & more</p>
        </td></tr>
      </table>
      <p style="color:${muted};font-size:14px;line-height:1.6;margin:0 0 8px;">Discount codes will be automatically applied when you register.</p>
      <p style="color:#A855F7;font-size:13px;font-weight:600;">Over 1,200 creators are already on the list.</p>
    </td></tr>`);
    await this.send(to, "You're on the OmliveStream waitlist — your exclusive offer inside", html);
  }

  // ── 14. Waitlist reward codes (after registration) ─────────────
  async sendWaitlistRewardEmail(to: string, d: { freeMonthCode: string; sixMonthCode: string; trialDays: number }): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:800;margin:0 0 8px;">Your waitlist rewards</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 24px;">As a waitlist member you get ${d.trialDays} days of free trial plus these exclusive codes:</p>
      <div style="background:#14102A;border:1px solid rgba(124,58,237,0.3);border-radius:12px;padding:20px;margin-bottom:16px;">
        <p style="color:#A855F7;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 8px;">First Month Free</p>
        <p style="font-family:'Courier New',monospace;font-size:22px;font-weight:700;color:${text};letter-spacing:3px;margin:0 0 8px;">${d.freeMonthCode}</p>
        <p style="color:${muted};font-size:13px;margin:0;">Apply at checkout — your first month is completely free</p>
      </div>
      <div style="background:#14102A;border:1px solid rgba(124,58,237,0.3);border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="color:#A855F7;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 8px;">${WAITLIST_DISCOUNT_PCT}% Off First ${WAITLIST_DISCOUNT_MONTHS} Months</p>
        <p style="font-family:'Courier New',monospace;font-size:22px;font-weight:700;color:${text};letter-spacing:3px;margin:0 0 8px;">${d.sixMonthCode}</p>
        <p style="color:${muted};font-size:13px;margin:0;">${WAITLIST_DISCOUNT_PCT}% off each of your first ${WAITLIST_DISCOUNT_MONTHS} months — enter it at checkout</p>
      </div>
      ${btn(`${urls.dashboard}/dashboard`, 'Start streaming')}
      <p style="color:${muted};font-size:12px;margin:16px 0 0;">Codes expire in 90 days. Redeem your free month from Billing; enter the discount code at checkout.</p>
    </td></tr>`);
    await this.send(to, 'Your OmliveStream waitlist rewards — codes inside', html);
  }

  // ── 15. Trial ending soon ──────────────────────────────────────
  async sendTrialEndingSoonEmail(to: string, name: string, daysLeft: number): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">Your free trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 20px;">Hey ${name || 'Creator'}, your OmliveStream trial is ending soon. After it ends, you'll move to the Free plan (1 platform only).</p>
      <table width="100%" style="background:#14102A;border-radius:12px;padding:20px;margin-bottom:24px;">
        ${row('Current (Trial)', '2 platforms, view comments, 3 streams/day')}
        ${row('Free (after trial)', '1 platform, view comments, 1 stream/day')}
        ${row('Premium', 'All 8 platforms, comment replies, unlimited')}
      </table>
      <p style="color:${muted};font-size:14px;margin:0 0 24px;">Upgrade now to keep streaming to multiple platforms without interruption.</p>
      ${btn(`${urls.payment}/billing`, 'Upgrade to Premium')}
    </td></tr>`);
    await this.send(to, `Your OmliveStream trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`, html);
  }

  // ── 16. Trial expired ──────────────────────────────────────────
  async sendTrialExpiredEmail(to: string, name: string): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">Your free trial has ended</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 20px;">Hey ${name || 'Creator'}, your 90-day trial is over. You're now on the Free plan — you can still stream to 1 platform.</p>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 28px;">Upgrade to Premium to stream on all 8 platforms, reply to comments, and get unlimited streams.</p>
      ${btn(`${urls.payment}/billing`, 'Upgrade to Premium')}
    </td></tr>`);
    await this.send(to, 'Your OmliveStream trial has ended — upgrade to keep full access', html);
  }

  // ── 17. Admin broadcast (custom campaigns) ─────────────────────
  // Note: broadcast emails use admin-supplied bodyHtml — sent directly via Resend
  // This wrapper is for simple text-only admin messages if needed
  async sendAdminBroadcast(to: string, subject: string, bodyHtml: string): Promise<void> {
    await this.send(to, subject, bodyHtml);
  }
}
