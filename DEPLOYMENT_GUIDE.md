# OmliveStream — MVP Deployment Guide
## API Keys, Vercel Setup & Launch Checklist

---

## 🔑 ADMIN LOGIN (Fix First!)

Your admin panel is at `/admin`. The seeded super admin account is:

```
Email:    superadmin@omlivestreamapp.com
Password: ChangeMe!2026
```

**After first login, immediately create a new super admin with your real email** by calling:
```
POST /api/v1/admin/admins
Body: { "email": "you@yourdomain.com", "password": "StrongPass!123", "full_name": "Your Name", "role": "super_admin" }
```
Then deactivate the default one in Supabase: `UPDATE admin_users SET is_active = false WHERE email = 'superadmin@omlivestreamapp.com';`

> **Why login was failing:** The `admin_users` table only gets populated when you run `migrate_v2.sql` in Supabase. If that migration wasn't run, the table is empty. Run it now from Supabase Dashboard → SQL Editor.

---

## 🚀 VERCEL DEPLOYMENT

### Important: Vercel Limitations

| Feature | Vercel OK? | Notes |
|---|---|---|
| REST API (Fastify) | ✅ Yes | Works fine |
| Socket.io (real-time) | ⚠️ Partial | Works with polling fallback; websocket upgrades may time out |
| mediasoup (WebRTC) | ❌ No | Requires persistent process + UDP ports — needs a VPS/Railway/Render |
| BullMQ Worker | ❌ No | Needs persistent process — deploy as separate service |
| RTMP Relay (Go) | ❌ No | Needs persistent TCP server |

**For MVP v1 on Vercel:** The REST API, auth, admin, AI, billing, and analytics all work. Real-time features (comments, viewer count) need a persistent host.

**Recommended stack for full features:**
- **Frontend** → Vercel ✅
- **Backend API** → Railway, Render, or a DigitalOcean droplet (Node.js)
- **WebRTC/mediasoup** → Same VPS (needs UDP port range open)
- **RTMP Relay** → Same VPS (needs port 1935 open)
- **Worker** → Same server, separate process (`npm run worker`)

### Deploy Backend to Vercel (API only, no WebRTC)
```bash
cd backend
vercel --prod
# Set all env vars from .env.production.example in Vercel dashboard
```

### Deploy Frontend to Vercel
```bash
cd frontend
vercel --prod
# Set env vars:
# NEXT_PUBLIC_API_URL = https://your-backend.vercel.app/api/v1
# NEXT_PUBLIC_SOCKET_URL = https://your-backend.vercel.app
```

---

## 🔑 API KEYS — STEP BY STEP

### 1. Supabase (REQUIRED — already set up)
You already have this. Verify:
- Dashboard: https://supabase.com/dashboard
- Project: `zgtsrwbvfgpkhgxgsqry`
- **Action needed:** Run all migration SQL files in order (v1 → v8) in SQL Editor

```sql
-- Run in order in Supabase SQL Editor:
-- 1. scripts/migrate.sql
-- 2. scripts/migrate_v2.sql       ← creates admin_users table + seeds admin
-- 3. scripts/migrate_v3.sql
-- 4. scripts/migrate_v4.sql
-- 5. scripts/migrate_v5.sql
-- 6. scripts/migrate_v6_otp_fix.sql
-- 7. scripts/migrate_v8_full_schema_check.sql
-- 8. scripts/setup_avatar_bucket.sql
```

### 2. Resend Email (REQUIRED — already set up)
You have `re_FLLKLNiv_...`. For production:
- Go to https://resend.com → Domains → Add your domain
- Change `EMAIL_FROM` from `onboarding@resend.dev` to `noreply@yourdomain.com`
- Verify DNS records (SPF, DKIM, DMARC)

### 3. Upstash Redis (REQUIRED — already set up)
You have the REST URL and token. Already working.
- Dashboard: https://console.upstash.com

### 4. OpenAI (REQUIRED — already set up)
You have the key. Already working for AI chat + title generation.
- Monitor usage: https://platform.openai.com/usage

### 5. Paystack (REQUIRED for billing)
Currently has placeholder values. Get your real keys:
- Go to https://dashboard.paystack.com
- Settings → API Keys & Webhooks
- Copy **Secret Key** (`sk_live_...`) and **Public Key** (`pk_live_...`)
- Set up webhook: `https://your-backend.vercel.app/api/v1/billing/webhook`
- Copy the webhook secret

### 6. YouTube / Google OAuth
1. Go to https://console.cloud.google.com
2. Create project (or use existing)
3. APIs & Services → Credentials → Create OAuth 2.0 Client ID
4. Application type: Web application
5. Authorized redirect URIs: `https://your-backend.vercel.app/api/v1/platforms/oauth/callback/youtube`
6. Enable APIs: YouTube Data API v3, YouTube Live Streaming API
7. Copy Client ID and Client Secret

### 7. Meta (Facebook + Instagram)
1. Go to https://developers.facebook.com
2. Create App → Business → Next
3. Add products: Facebook Login, Instagram Basic Display
4. Settings → Basic → copy App ID and App Secret
5. Facebook Login → Settings → Valid OAuth Redirect URIs:
   `https://your-backend.vercel.app/api/v1/platforms/oauth/callback/facebook`
6. Instagram Basic Display → Valid OAuth Redirect URIs:
   `https://your-backend.vercel.app/api/v1/platforms/oauth/callback/instagram`
7. **For Live Video:** Apply for `publish_video` permission (requires app review)

### 8. Twitch
1. Go to https://dev.twitch.tv/console
2. Applications → Register Your Application
3. OAuth Redirect URLs: `https://your-backend.vercel.app/api/v1/platforms/oauth/callback/twitch`
4. Category: Broadcasting Suite
5. Copy Client ID, then Generate a new Client Secret

### 9. TikTok
1. Go to https://developers.tiktok.com
2. Manage Apps → Create App
3. **Note:** TikTok Live access requires partner approval — submit for review
4. Add Redirect URI: `https://your-backend.vercel.app/api/v1/platforms/oauth/callback/tiktok`
5. Products needed: Login Kit + Live Kit
6. Copy Client Key and Client Secret

### 10. X (Twitter)
1. Go to https://developer.twitter.com/en/portal/dashboard
2. Create a Project and App
3. App Settings → Authentication settings → Enable OAuth 2.0
4. Callback URI: `https://your-backend.vercel.app/api/v1/platforms/oauth/callback/twitter`
5. Copy Client ID and Client Secret
6. Required permissions: `tweet.read`, `tweet.write`, `users.read`, `offline.access`

### 11. LinkedIn
1. Go to https://developer.linkedin.com
2. Create App
3. Auth tab → Authorized Redirect URLs: `https://your-backend.vercel.app/api/v1/platforms/oauth/callback/linkedin`
4. Products → Apply for: Share on LinkedIn, Sign In with LinkedIn
5. Copy Client ID and Client Secret

---

## 🔧 BUGS FIXED IN THIS RELEASE

| # | Location | Issue | Fix |
|---|---|---|---|
| 1 | `backend/src/config/env.ts` | All social OAuth keys were `required` — server crashed at startup if any were missing | Made optional with sensible defaults |
| 2 | `backend/src/config/env.ts` | `MEDIASOUP_ANNOUNCED_IP` was required — crashed on Vercel serverless | Made optional, defaults to `0.0.0.0` |
| 3 | `backend/src/app.ts` | CORS only allowed exact `FRONTEND_URL` — broke Vercel preview URLs | Now supports comma-separated origins + prefix matching |
| 4 | `frontend/src/components/auth/AuthGuard.tsx` | Race condition: `setReady(true)` fired before `refreshProfile()` resolved | `refreshProfile().finally(() => setReady(true))` |
| 5 | `frontend/src/components/auth/AuthGuard.tsx` | No redirect to `/onboarding` for new users who hadn't completed it | Added `onboarding_completed` check after profile loads |
| 6 | `frontend/next.config.mjs` | Supabase storage images (avatars) were blocked by Next.js image domain policy | Added `*.supabase.co` to `remotePatterns` |
| 7 | `backend` | No `vercel.json` — Vercel didn't know how to build/route the API | Created `vercel.json` for both frontend and backend |

---

## 🐳 DOCKER (for VPS / Railway / Render)

Docker is already set up and production-ready. Use it for the full feature stack:

```bash
# Build and start everything
docker-compose up -d --build

# View logs
docker-compose logs -f api
docker-compose logs -f worker

# Update after code changes
git pull
docker-compose up -d --build

# Scale worker
docker-compose up -d --scale worker=2
```

For GitHub Actions auto-deploy to a VPS:
```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_KEY }}
          script: |
            cd /opt/omlivestreambackend
            git pull origin main
            docker-compose up -d --build
```

---

## 📋 LAUNCH CHECKLIST

### Must-Have for MVP v1
- [ ] Run all migration SQL files in Supabase
- [ ] Admin login works (migrate_v2.sql seeds the account)
- [ ] Change default admin password
- [ ] Resend domain verified (not using onboarding@resend.dev)
- [ ] Paystack live keys added
- [ ] Frontend `NEXT_PUBLIC_API_URL` pointing to deployed backend
- [ ] Test user signup → verify OTP → onboarding → dashboard flow

### Nice-to-Have Before Launch
- [ ] YouTube OAuth working (most popular platform)
- [ ] Twitch OAuth working
- [ ] Custom domain on Vercel
- [ ] Error monitoring (add Sentry — `npm install @sentry/nextjs @sentry/node`)

### After Launch
- [ ] Meta app review for `publish_video` permission
- [ ] TikTok Live partner approval
- [ ] Move to VPS for WebRTC/RTMP (when users start streaming)
- [ ] Set up Upstash Redis for BullMQ worker (video processing)

---

## 💬 USER FEEDBACK MANAGEMENT

Your app already has:
- **Feedback module** (`/api/v1/feedback`) — users submit in-app feedback
- **Contact module** (`/api/v1/contact`) — landing page contact form
- **Admin dashboard** → Contact section shows all submissions

For GitHub-based issue tracking, add this to GitHub:
1. Enable Issues in your repo
2. Create label templates: `bug`, `feature`, `feedback`, `priority:high`
3. Users can email `feedback@yourdomain.com` → auto-create issues with Zapier or n8n

---

*Generated for OmliveStream MVP v1 — May 2026*
