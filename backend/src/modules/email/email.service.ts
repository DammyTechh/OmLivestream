import { Resend } from 'resend';
import { env, urls } from '../../config/env';
import { logger } from '../../config/logger';

const resend = new Resend(env.RESEND_API_KEY);

// ── Design tokens ─────────────────────────────────────────────────
const logo    = 'https://i.imgur.com/0NFlGxJ.png';
const bg      = '#07050F';
const surface = '#0F0C1E';
const text    = '#F8F5FF';
const muted   = '#6B6880';

// ── Template helpers ──────────────────────────────────────────────
const wrap = (body: string) => `<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:${bg};font-family:'DM Sans',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${bg};padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:${surface};border-radius:16px;border:1px solid rgba(124,58,237,0.2);overflow:hidden;max-width:560px;width:100%;">
<tr><td style="background:linear-gradient(135deg,#7C3AED,#A855F7);padding:28px 40px;text-align:center;">
  <img src="${logo}" alt="OmliveStream" style="height:44px;display:block;margin:0 auto 10px;">
  <span style="color:${text};font-size:20px;font-weight:800;letter-spacing:-0.02em;">OmliveStream</span>
</td></tr>
${body}
<tr><td style="padding:20px 40px;border-top:1px solid rgba(124,58,237,0.15);text-align:center;">
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
  `<a href="${href}" style="display:inline-block;background:linear-gradient(135deg,#7C3AED,#A855F7);color:${text};text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:15px;">${label}</a>`;

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
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">Your account is ready</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 20px;">Welcome to OmliveStream — the only platform you need to go live everywhere at once.</p>
      <ol style="color:${muted};font-size:14px;line-height:2;margin:0 0 28px;padding-left:18px;">
        <li><strong style="color:${text};">Connect your platforms</strong> — YouTube, TikTok, Twitch & more</li>
        <li><strong style="color:${text};">Create a stream</strong> — title, thumbnail, select platforms</li>
        <li><strong style="color:${text};">Go live</strong> — reach your entire audience simultaneously</li>
      </ol>
      ${btn(`${urls.dashboard}/dashboard`, 'Go to Dashboard →')}
    </td></tr>`);
    await this.send(to, 'Welcome to OmliveStream — your account is ready', html);
  }

  // ── 3. Payment receipt ─────────────────────────────────────────
  async sendReceiptEmail(to: string, d: { amount: number; reference: string; plan: string; billingCycle: string }): Promise<void> {
    const amount = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(d.amount / 100);
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <div style="text-align:center;margin-bottom:28px;">
        <span style="display:inline-block;background:rgba(16,185,129,0.15);color:#10B981;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:5px 12px;border-radius:99px;margin-bottom:14px;">Payment received</span>
        <h2 style="color:${text};font-size:22px;font-weight:700;margin:0;">Payment successful</h2>
      </div>
      <table width="100%" style="background:#14102A;border-radius:12px;padding:20px;margin-bottom:24px;">
        ${row('Plan', `${d.plan} (${d.billingCycle})`)}
        ${row('Amount', `<span style="color:#10B981;font-weight:700;">${amount}</span>`)}
        ${row('Reference', `<span style="font-family:monospace;font-size:12px;">${d.reference}</span>`)}
        ${row('Date', new Date().toLocaleDateString('en-NG', { dateStyle: 'long' }))}
      </table>
      ${btn(`${urls.dashboard}/dashboard`, 'Go to Dashboard →')}
    </td></tr>`);
    await this.send(to, `OmliveStream — Payment confirmed: ${amount}`, html);
  }

  // ── 4. Subscription cancelled ──────────────────────────────────
  async sendCancellationEmail(to: string, periodEnd: string): Promise<void> {
    const endDate = new Date(periodEnd).toLocaleDateString('en-NG', { dateStyle: 'long' });
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">Subscription Cancelled</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 12px;">Your subscription has been cancelled. Premium access continues until <strong style="color:${text};">${endDate}</strong>.</p>
      <p style="color:${muted};font-size:14px;line-height:1.6;margin:0 0 28px;">You can resubscribe any time from your billing settings.</p>
      ${btn(`${urls.payment}/billing`, 'Resubscribe →')}
    </td></tr>`);
    await this.send(to, 'OmliveStream — Subscription cancelled', html);
  }

  // ── 5. Recording ready ─────────────────────────────────────────
  async sendRecordingReadyEmail(to: string, streamTitle: string): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">Your recording is ready</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 8px;">Your stream <strong style="color:${text};">"${streamTitle}"</strong> has been saved successfully.</p>
      <p style="color:${muted};font-size:14px;line-height:1.6;margin:0 0 28px;">Download, AI-edit, or publish directly to your platforms.</p>
      ${btn(`${urls.dashboard}/recordings`, 'View Recording →')}
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
      ${btn(`${urls.dashboard}/dashboard`, 'Go Live Now →')}
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
      ${btn(`${urls.payment}/billing`, 'View Billing →')}
    </td></tr>`);
    await this.send(to, 'OmliveStream — Subscription renewed', html);
  }

  // ── 10. Feature update ─────────────────────────────────────────
  async sendFeatureUpdateEmail(to: string, title: string, description: string): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <span style="display:inline-block;background:rgba(124,58,237,0.15);color:#A855F7;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:4px 12px;border-radius:99px;margin-bottom:16px;">New Feature</span>
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">${title}</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 28px;">${description}</p>
      ${btn(`${urls.dashboard}/dashboard`, 'Try It Now →')}
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
      ${btn(`${urls.dashboard}/settings/security`, 'Secure My Account →')}
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
      ${btn(`${urls.dashboard}/dashboard`, 'Start Streaming →')}
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
          <p style="margin:0;color:${text};font-size:15px;font-weight:700;">50% off your first 6 months</p>
          <p style="margin:4px 0 0;color:${muted};font-size:13px;">Half price on your first 6 months of Premium</p>
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
        <p style="color:#A855F7;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 8px;">50% Off First 6 Months</p>
        <p style="font-family:'Courier New',monospace;font-size:22px;font-weight:700;color:${text};letter-spacing:3px;margin:0 0 8px;">${d.sixMonthCode}</p>
        <p style="color:${muted};font-size:13px;margin:0;">Half price for 6 months</p>
      </div>
      ${btn(`${urls.dashboard}/dashboard`, 'Start Streaming →')}
      <p style="color:${muted};font-size:12px;margin:16px 0 0;">Codes expire in 90 days. Apply via Settings → Billing → Apply Code.</p>
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
      ${btn(`${urls.payment}/billing`, 'Upgrade to Premium →')}
    </td></tr>`);
    await this.send(to, `Your OmliveStream trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`, html);
  }

  // ── 16. Trial expired ──────────────────────────────────────────
  async sendTrialExpiredEmail(to: string, name: string): Promise<void> {
    const html = wrap(`<tr><td style="padding:36px 40px;">
      <h2 style="color:${text};font-size:22px;font-weight:700;margin:0 0 12px;">Your free trial has ended</h2>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 20px;">Hey ${name || 'Creator'}, your 90-day trial is over. You're now on the Free plan — you can still stream to 1 platform.</p>
      <p style="color:${muted};font-size:15px;line-height:1.6;margin:0 0 28px;">Upgrade to Premium to stream on all 8 platforms, reply to comments, and get unlimited streams.</p>
      ${btn(`${urls.payment}/billing`, 'Upgrade to Premium →')}
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
