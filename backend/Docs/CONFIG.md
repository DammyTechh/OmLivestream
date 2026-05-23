# OmliveStream Backend — Complete Setup & Config Guide

> **Product:** OmliveStream &nbsp;|&nbsp; **Logo:** https://i.imgur.com/0NFlGxJ.png  
> **Stack:** Node.js + Fastify + TypeScript + mediasoup + Go + Supabase + Redis + Resend + Paystack

---

## Quick Start

```bash
# 1. Install deps
npm install

# 2. Copy and fill env
cp .env.example .env

# 3. Run Supabase migrations (in order)
# Supabase Dashboard → SQL Editor:
#   Paste scripts/migrate.sql    → Run
#   Paste scripts/migrate_v2.sql → Run

# 4. Start with Docker (all 3 services)
docker-compose up --build

# OR individually:
npm run dev          # Terminal 1 — API + Socket.io + mediasoup
npm run worker       # Terminal 2 — BullMQ video worker
cd rtmp-relay && go run main.go   # Terminal 3 — Go RTMP relay
```

```
Health:  http://localhost:3001/health
Swagger: http://localhost:3001/api/docs
```

---

## Services

| Service | Language | Port | Role |
|---------|----------|------|------|
| `api` | Node.js + TypeScript | 3001 | REST API, Socket.io, mediasoup WebRTC |
| `rtmp-relay` | **Go** | 3002 (internal) | RTMP fan-out — one goroutine per platform, `ffmpeg -c copy` |
| `worker` | Node.js | — | BullMQ: AI video edits (GPT-4o + ffmpeg), platform publishes |

### Why Go for RTMP relay?
The relay fans a single stream out to 8 platforms simultaneously. Go goroutines handle this perfectly — each platform runs independently, a failure on one doesn't affect others, and `ffmpeg -c copy` means zero transcoding so streaming quality is byte-for-byte preserved.

### Why no lag / high quality?
- **mediasoup SFU** — pure packet forwarding, no re-encoding, sub-100ms WebRTC latency
- **UDP transport** — `preferUdp: true` in mediasoup config, TCP fallback for restrictive networks  
- **`ffmpeg -c:v copy -c:a copy`** — bitstream copy to all platforms, no CPU re-encoding
- **Opus FEC** — `useinbandfec: 1` keeps audio clean on packet loss
- **Per-platform goroutines** — independent retry with exponential backoff per destination

---

## Environment Variables

All validated by Zod on startup — clear error messages, fails fast.

### Generate secrets
```bash
openssl rand -hex 64   # → JWT_SECRET, JWT_REFRESH_SECRET
openssl rand -hex 32   # → ENCRYPTION_KEY, RTMP_RELAY_SECRET
```

### Full reference

| Variable | Description | Where to get it |
|----------|-------------|-----------------|
| `SUPABASE_URL` | Project URL | Dashboard → Settings → API |
| `SUPABASE_ANON_KEY` | Public anon key | Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role — backend only ⚠️ | Dashboard → Settings → API |
| `JWT_SECRET` | 64-char hex | `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | 64-char hex, different from above | `openssl rand -hex 64` |
| `ENCRYPTION_KEY` | 32-char hex, AES-256-GCM for tokens | `openssl rand -hex 32` |
| `RESEND_API_KEY` | Starts with `re_` | resend.com → API Keys |
| `EMAIL_FROM` | Verified sender | e.g. `OmliveStream <noreply@yourdomain.com>` |
| `UPSTASH_REDIS_URL` | `rediss://` URL | upstash.com → Redis → Connect |
| `UPSTASH_REDIS_TOKEN` | REST token | upstash.com → Redis |
| `PAYSTACK_SECRET_KEY` | `sk_live_...` | Paystack Dashboard → Settings → API Keys |
| `PAYSTACK_PUBLIC_KEY` | `pk_live_...` | Same page |
| `PAYSTACK_WEBHOOK_SECRET` | Webhook secret | Paystack → Settings → Webhooks |
| `OPENAI_API_KEY` | `sk-...` | platform.openai.com → API Keys |
| `MEDIASOUP_ANNOUNCED_IP` | Server public IP | Your VPS/Railway assigned IP |
| `RTMP_RELAY_SECRET` | 32-char hex | `openssl rand -hex 32` |
| `YOUTUBE_CLIENT_ID/SECRET` | Google OAuth | console.cloud.google.com |
| `META_APP_ID/SECRET` | Facebook + Instagram | developers.facebook.com |
| `TWITCH_CLIENT_ID/SECRET` | Twitch OAuth | dev.twitch.tv/console |
| `TIKTOK_CLIENT_KEY/SECRET` | TikTok OAuth ⚠️ approval needed | developers.tiktok.com |
| `TWITTER_CLIENT_ID/SECRET` | Twitter OAuth | developer.twitter.com |
| `LINKEDIN_CLIENT_ID/SECRET` | LinkedIn OAuth ⚠️ approval needed | developer.linkedin.com |

---

## Getting API Keys

### Google / YouTube
1. [console.cloud.google.com](https://console.cloud.google.com) → New project
2. Enable: YouTube Data API v3, YouTube Live Streaming API
3. Credentials → OAuth 2.0 Client ID → Web app
4. Redirect URI: `{API_BASE_URL}/api/v1/platforms/oauth/callback/youtube`

### Meta (Facebook + Instagram)
1. [developers.facebook.com](https://developers.facebook.com) → Create App (Business type)
2. Add: Facebook Login, Instagram Graph API
3. App Review required for `instagram_content_publish` + `publish_video`

### Twitch
1. [dev.twitch.tv/console](https://dev.twitch.tv/console) → Register App
2. Redirect URI: `{API_BASE_URL}/api/v1/platforms/oauth/callback/twitch`

### TikTok ⚠️ 2–4 weeks approval
1. [developers.tiktok.com](https://developers.tiktok.com) → Apply for Live API partner access

### Twitter/X
1. [developer.twitter.com](https://developer.twitter.com) → Basic plan ($100/mo) needed for live
2. OAuth 2.0 with PKCE

### LinkedIn ⚠️ 2–4 weeks approval  
1. [developer.linkedin.com](https://developer.linkedin.com) → Apply for Live Video API

### Kick — no API needed
Users paste stream key via `POST /platforms/connect/manual`

### Resend (email)
1. [resend.com](https://resend.com) → Add domain → Verify DNS → Create API key

### Upstash (Redis)
1. [upstash.com](https://upstash.com) → Redis → Create → Copy `rediss://` URL and token

### Paystack
1. [paystack.com](https://paystack.com) → Settings → API Keys & Webhooks
2. Webhook URL: `{API_BASE_URL}/api/v1/billing/webhooks/paystack`
3. Enable events: `charge.success`, `subscription.create`, `subscription.disable`, `invoice.create`, `invoice.payment_failed`

---

## Supabase Setup

### Run migrations (in order)
```
SQL Editor → paste scripts/migrate.sql    → Run
SQL Editor → paste scripts/migrate_v2.sql → Run
```

### Create Storage buckets
```
Dashboard → Storage → New bucket:
  recordings  (private)   — stream recordings, AI-edited videos
  thumbnails  (public)    — stream thumbnails, max 5MB per file
  avatars     (public)    — user profile photos, max 2MB
```

---

## Database Tables

| Table | Description |
|-------|-------------|
| `users` | Core user accounts — plan, status, verified |
| `sessions` | Refresh token store — one row per device session |
| `otp_codes` | One-time codes — hashed, single-use, 10-min expiry |
| `onboarding_responses` | Survey answers from onboarding flow |
| `platform_connections` | OAuth/RTMP credentials per platform — AES-256-GCM encrypted |
| `streams` | Stream sessions — scheduled, live, ended |
| `stream_platforms` | Per-platform push status + viewer/impression counts |
| `recordings` | Stream recordings — processing→ready→failed |
| `stream_metrics` | Time-series bitrate/viewer/impression data |
| `platform_analytics` | Aggregated daily/weekly/monthly stats |
| `video_edits` | AI edit jobs — prompt, GPT-4o plan, ffmpeg output |
| `video_publishes` | Post-stream publishing jobs |
| `subscriptions` | Paystack subscription lifecycle |
| `invoices` | Payment records — paid/pending/failed |
| `feedback` | User feedback + ratings |
| `feature_updates` | In-app feature announcements |
| `user_feature_reads` | Read/unread state per user |
| `login_logs` | ⭐ Device fingerprint, IP, risk level, new-device flag |
| `admin_users` | Admin accounts — bcrypt passwords, roles |
| `admin_sessions` | Admin refresh tokens |
| `admin_audit_logs` | ⭐ Every admin action — who, what, when, why |

---

## Complete API Reference

**Base URL:** `{API_BASE_URL}/api/v1`  
**Swagger UI:** `{API_BASE_URL}/api/docs`  
**Auth:** `Authorization: Bearer <accessToken>`

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/send-otp` | — | Send 6-digit OTP to email |
| POST | `/auth/verify-otp` | — | Verify OTP → JWT tokens |
| POST | `/auth/social/google` | — | Google OAuth |
| POST | `/auth/social/facebook` | — | Facebook OAuth |
| POST | `/auth/social/instagram` | — | Instagram OAuth |
| POST | `/auth/social/twitch` | — | Twitch OAuth |
| POST | `/auth/refresh` | — | Refresh access token |
| POST | `/auth/logout` | ✅ | Invalidate session |

### Users
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/me` | ✅ | Profile |
| PATCH | `/users/me` | ✅ | Update profile |
| DELETE | `/users/me` | ✅ | **Delete account permanently** |
| POST | `/users/onboarding` | ✅ | Save onboarding survey |
| GET | `/users/me/subscription` | ✅ | Plan, status, days remaining |
| GET | `/users/me/login-history` | ✅ | **Last 50 logins with device/IP/risk** |
| GET | `/users/me/sessions` | ✅ | **All active device sessions** |
| DELETE | `/users/me/sessions/:id` | ✅ | **Log out a specific device** |
| POST | `/users/me/sessions/revoke-all` | ✅ | **Emergency: log out all devices** |

### Platforms
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/platforms` | ✅ | List connected platforms |
| POST | `/platforms/connect/oauth` | ✅ | Get OAuth URL |
| GET | `/platforms/oauth/callback/:platform` | CSRF | OAuth redirect handler |
| POST | `/platforms/connect/manual` | ✅ | Manual RTMP (Kick) |
| DELETE | `/platforms/:id` | ✅ | Disconnect |
| POST | `/platforms/:id/reconnect` | ✅ | Refresh tokens |

### Streams
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/streams` | ✅ | List streams |
| POST | `/streams` | ✅ | Create stream |
| GET | `/streams/:id` | ✅ | Stream details |
| POST | `/streams/:id/start` | ✅ | Start → returns `rtpCapabilities` |
| POST | `/streams/:id/end` | ✅ | End stream |
| GET | `/streams/network-check` | ✅ | Network quality hint |

### WebRTC (mediasoup)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/webrtc/create-transport` | ✅ | Create send transport |
| POST | `/webrtc/connect-transport` | ✅ | DTLS handshake |
| POST | `/webrtc/produce` | ✅ | Start sending video/audio track |
| GET | `/webrtc/stats/:streamId` | ✅ | mediasoup stats |

### Recordings
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/recordings` | ✅ | List recordings |
| GET | `/recordings/:id` | ✅ | Get + signed download URL (1h) |
| DELETE | `/recordings/:id` | ✅ | Delete from storage |
| POST | `/recordings/:id/ai-edit` | ✅ Premium | AI edit by text prompt |
| GET | `/recordings/:id/edit-status` | ✅ | Poll edit job |
| POST | `/recordings/:id/publish` | ✅ | Publish to platform |

### Analytics
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/analytics/overview` | ✅ | Totals + per-platform breakdown |
| GET | `/analytics/platforms` | ✅ | Time-series per platform |
| GET | `/analytics/streams/:id` | ✅ | Single stream detail |

### Billing
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/billing/plans` | ✅ | Plans + pricing |
| POST | `/billing/subscribe` | ✅ | Paystack checkout — `card` or `google_pay` |
| GET | `/billing/dashboard` | ✅ | **Full payment dashboard** — plan, sub, invoices, spend |
| GET | `/billing/invoices` | ✅ | Invoice history |
| POST | `/billing/cancel` | ✅ | Cancel subscription |
| GET | `/billing/security/sessions` | ✅ | Active sessions |
| DELETE | `/billing/security/sessions/:id` | ✅ | Revoke session |
| POST | `/billing/security/revoke-all-sessions` | ✅ | Revoke all |
| POST | `/billing/webhooks/paystack` | HMAC | Paystack webhook |

### AI
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/ai/chat` | ✅ | GPT-4o-mini assistant |
| POST | `/ai/generate-title` | ✅ | Generate stream titles per platform |

### Feedback
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/feedback` | ✅ | Submit feedback + rating |
| GET | `/feedback/feature-updates` | ✅ | Feature updates with read status |
| POST | `/feedback/feature-updates/:id/mark-read` | ✅ | Mark read |

### Admin (separate JWT from `/admin/auth/login`)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/admin/auth/login` | — | Admin login — email + password |
| POST | `/admin/auth/refresh` | — | Refresh admin token |
| POST | `/admin/auth/logout` | Admin | Logout |
| GET | `/admin/auth/me` | Admin | Current admin profile |
| POST | `/admin/admins` | Super | Create new admin |
| GET | `/admin/dashboard` | All | KPIs: users, revenue, streams, subscriptions |
| GET | `/admin/charts/revenue` | All | Revenue chart — day/week/month |
| GET | `/admin/charts/user-growth` | All | Signups chart |
| GET | `/admin/charts/subscriptions` | All | Sub breakdown |
| GET | `/admin/charts/platforms` | All | Platform usage |
| GET | `/admin/payments` | All | All payments — filter by status/date |
| GET | `/admin/subscriptions` | All | All subscriptions |
| GET | `/admin/users` | All | User list — search, filter, sort |
| GET | `/admin/users/:id` | All | Full user detail |
| POST | `/admin/users/:id/flag` | Admin | Flag for review |
| POST | `/admin/users/:id/suspend` | Admin | Suspend + kill all sessions |
| POST | `/admin/users/:id/ban` | Super | Permanent ban |
| POST | `/admin/users/:id/restore` | Admin | Restore to active |
| DELETE | `/admin/users/:id` | Super | Delete account permanently |
| POST | `/admin/users/:id/grant-premium` | Admin | **Manual premium grant** — auto-emails user |
| POST | `/admin/users/:id/revoke-premium` | Admin | Revoke premium |
| GET | `/admin/security/suspicious-logins` | All | High-risk login attempts |
| GET | `/admin/security/multi-account` | All | **Same device, different accounts** — fraud detection |
| GET | `/admin/audit-log` | All | All admin actions with timestamps |

---

## WebSocket Events

**Connect:** `io(SOCKET_URL, { auth: { token: accessToken } })`

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `join:stream` | `streamId` | Join a stream room |
| `leave:stream` | `streamId` | Leave stream room |
| `comment:reply` | `{ streamId, platformCommentId, platform, replyText }` | Reply to comment (Premium only) |
| `stream:health:ping` | `{ streamId, bitrateKbps }` | Send every 2s — server returns quality status |
| `recording:chunk` | `{ streamId, chunk, index }` | Binary recording chunks from MediaRecorder |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `comment:new` | `{ id, platform, username, avatarUrl, text, timestamp }` | New comment from any platform |
| `stream:viewers` | `{ count }` | Aggregated viewer count |
| `stream:health:status` | `{ quality, recommended, bitrateKbps }` | Network quality feedback |
| `stream:ended` | `{ streamId }` | Stream ended (from another device) |
| `platform:status` | `{ platform, status }` | Platform push status update |
| `comment:reply:sent` | `{ platformCommentId, platform, replyText }` | Reply delivered |
| `comment:reply:failed` | `{ platformCommentId, error }` | Reply failed |
| `error` | `{ code, message }` | Server error |

---

## Go Live — Complete Flow

```typescript
// 1. Create stream
const { data: stream } = await api.post('/streams', {
  title: 'Saturday Night Stream',
  platforms: ['youtube', 'twitch', 'tiktok'],
});

// 2. Start stream → get WebRTC capabilities
const { data: startData } = await api.post(`/streams/${stream.id}/start`);
const { rtpCapabilities } = startData.data;

// 3. Load mediasoup device
const device = new mediasoupClient.Device();
await device.load({ routerRtpCapabilities: rtpCapabilities });

// 4. Create WebRTC transport
const { data: transportData } = await api.post('/webrtc/create-transport', { streamId: stream.id });
const transport = device.createSendTransport(transportData.data);

// 5. Connect transport
transport.on('connect', async ({ dtlsParameters }, cb) => {
  await api.post('/webrtc/connect-transport', { transportId: transport.id, dtlsParameters });
  cb();
});

// 6. Produce video track
const videoTrack = canvasStream.getVideoTracks()[0];
const producer = await transport.produce({ track: videoTrack });
await api.post('/webrtc/produce', {
  transportId: transport.id, kind: 'video', rtpParameters: producer.rtpParameters,
});

// 7. Connect Socket.io
const socket = io(SOCKET_URL, { auth: { token: accessToken } });
socket.emit('join:stream', stream.id);
socket.on('comment:new', addToFeed);
socket.on('stream:viewers', ({ count }) => setViewers(count));

// 8. Health pings every 2s
setInterval(() => {
  socket.emit('stream:health:ping', { streamId: stream.id, bitrateKbps: currentBitrate });
}, 2000);

// 9. End stream
await api.post(`/streams/${stream.id}/end`);
```

---

## Google Pay Integration

```typescript
// paymentMethod: 'google_pay' → Paystack renders Google Pay sheet on capable devices
const { data } = await api.post('/billing/subscribe', {
  plan:          'premium',
  billingCycle:  'monthly',
  paymentMethod: 'google_pay',   // or 'card' for standard checkout
});

// Redirect user — on mobile, Google Pay sheet appears automatically
window.location.href = data.data.paystackAuthUrl;
// User authenticates with fingerprint/face — no card entry needed
```

---

## Admin Dashboard — First Login

```bash
# Default super admin (CHANGE IMMEDIATELY after first login)
Email:    superadmin@omlivestreamapp.com
Password: ChangeMe!2026

# Login
POST /api/v1/admin/auth/login
{ "email": "superadmin@omlivestreamapp.com", "password": "ChangeMe!2026" }
# → { accessToken, refreshToken, admin: { id, email, role } }

# Use admin accessToken as Bearer token for all /admin/* routes

# Create your real admin account
POST /api/v1/admin/admins
Authorization: Bearer <admin-access-token>
{ "email": "you@company.com", "password": "StrongPass!123", "full_name": "Your Name", "role": "super_admin" }

# Grant manual premium to a user (e.g. bank transfer payment)
POST /api/v1/admin/users/:userId/grant-premium
{ "billingCycle": "monthly", "notes": "Bank transfer received — Ref: TXN123456" }
# → Subscription activated + branded email automatically sent to user
```

---

## Email Templates (13 total via Resend)

| Template | Trigger |
|----------|---------|
| OTP verification | Sign up or login |
| Welcome guide | First account created |
| New device login alert ⭐ | Login from unrecognised device |
| Payment receipt | Successful Paystack charge |
| Subscription renewal | Monthly/annual auto-renewal |
| Cancellation notice | Subscription cancelled |
| Recording ready | Stream recording processed |
| AI edit complete | AI video edit job done |
| Birthday wish | Daily cron at 08:00 UTC |
| Re-engagement | 5+ days since last stream |
| Feedback confirmation | User submits feedback |
| Feature update | New feature announcement |
| Admin granted Premium ⭐ | Admin manually activates subscription |

---

## Production Deployment (Railway)

### Services
| Service | Dockerfile | Port |
|---------|------------|------|
| `api` | `./Dockerfile` | 3001 (public) |
| `rtmp-relay` | `./rtmp-relay/Dockerfile` | 3002 (private) |
| `worker` | `./Dockerfile`, CMD: `node dist/jobs/worker.js` | — |

### Key env vars per service

**api:** All vars from `.env.example`  
**rtmp-relay:** Only `PORT=3002` and `RTMP_RELAY_SECRET`  
**worker:** All vars (same as api — needs DB, Redis, OpenAI, Supabase Storage)

### mediasoup on Railway
```env
MEDIASOUP_ANNOUNCED_IP=<railway-public-ip>
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
```
Expose UDP range 40000–49999 in Railway service settings.

### RTMP relay URL
Set on `api` service:
```env
RTMP_RELAY_INTERNAL_URL=http://<railway-private-url-of-relay-service>:3002
```
