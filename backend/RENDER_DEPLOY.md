# Deploying OmliveStream Backend to Render

## Free tier facts
- **Free web service** spins down after 15 minutes of inactivity — cold start takes ~30s
- **Paid Starter ($7/mo)** keeps it always on — recommended once you have users
- Free gives you 750 hours/month (enough for one service running all month)
- Free has 512MB RAM — fine for the API (mediasoup WebRTC needs more; see note below)

---

## Step 1 — Push your code to GitHub

```bash
# In your project root
git init
git add .
git commit -m "feat: initial OmliveStream MVP"

# Create repo at github.com/new, then:
git remote add origin https://github.com/YOUR_USERNAME/omlivestream-backend.git
git push -u origin main
```

---

## Step 2 — Create Render service

1. Go to https://dashboard.render.com
2. Click **New +** → **Web Service**
3. Connect your GitHub account if not done already
4. Select your `omlivestream-backend` repo
5. Fill in:
   - **Name:** `omlivestream-api`
   - **Region:** Oregon (US) or Frankfurt (closer to Africa/Europe)
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `node dist/server.js`
   - **Plan:** Free (upgrade to Starter later)

6. Click **Create Web Service** — Render starts building

---

## Step 3 — Set Environment Variables

In Render → Your Service → **Environment** → Add the following:

### Required (fill immediately)
```
NODE_ENV = production
PORT = 3001
HOST = 0.0.0.0
API_BASE_URL = https://omlivestream-api.onrender.com   ← your Render URL
FRONTEND_URL = https://your-app.vercel.app             ← your Vercel frontend URL

SUPABASE_URL = https://zgtsrwbvfgpkhgxgsqry.supabase.co
SUPABASE_ANON_KEY = [from Supabase Dashboard → Settings → API]
SUPABASE_SERVICE_ROLE_KEY = [from Supabase Dashboard → Settings → API]

JWT_SECRET = [generate: openssl rand -hex 64]
JWT_REFRESH_SECRET = [generate: openssl rand -hex 64]
JWT_EXPIRES_IN = 15m
JWT_REFRESH_EXPIRES_IN = 7d

ENCRYPTION_KEY = [generate: openssl rand -hex 32]

RESEND_API_KEY = re_FLLKLNiv_...
EMAIL_FROM = noreply@yourdomain.com

UPSTASH_REDIS_REST_URL = https://cunning-calf-84115.upstash.io
UPSTASH_REDIS_REST_TOKEN = [your token]

OPENAI_API_KEY = sk-proj-...

MEDIASOUP_ANNOUNCED_IP = 0.0.0.0
MEDIASOUP_LISTEN_IP = 0.0.0.0
RTMP_RELAY_INTERNAL_URL = http://localhost:3002
RTMP_RELAY_SECRET = [generate: openssl rand -hex 32]
```

### Paystack (add when ready)
```
PAYSTACK_SECRET_KEY = sk_live_...
PAYSTACK_PUBLIC_KEY = pk_live_...
PAYSTACK_WEBHOOK_SECRET = [from Paystack webhook settings]
```

### Social OAuth redirect URIs
When registering apps on YouTube, Meta, Twitch etc — set redirect URIs to:
```
https://omlivestream-api.onrender.com/api/v1/platforms/oauth/callback/youtube
https://omlivestream-api.onrender.com/api/v1/platforms/oauth/callback/facebook
https://omlivestream-api.onrender.com/api/v1/platforms/oauth/callback/instagram
https://omlivestream-api.onrender.com/api/v1/platforms/oauth/callback/twitch
https://omlivestream-api.onrender.com/api/v1/platforms/oauth/callback/tiktok
https://omlivestream-api.onrender.com/api/v1/platforms/oauth/callback/twitter
https://omlivestream-api.onrender.com/api/v1/platforms/oauth/callback/linkedin
```

---

## Step 4 — Update Frontend env vars

In **Vercel** → Your Frontend Project → Settings → Environment Variables:
```
NEXT_PUBLIC_API_URL = https://omlivestream-api.onrender.com/api/v1
NEXT_PUBLIC_SOCKET_URL = https://omlivestream-api.onrender.com
```
Then redeploy the frontend.

---

## Step 5 — Verify deployment

Once deployed, test:
```bash
# Health check
curl https://omlivestream-api.onrender.com/health

# Expected response:
{"status":"ok","uptime":12.3,"env":"production"}

# Swagger docs
# Open in browser:
https://omlivestream-api.onrender.com/api/docs
```

---

## Step 6 — Paystack webhook

In Paystack Dashboard → Settings → API Keys & Webhooks:
- Webhook URL: `https://omlivestream-api.onrender.com/api/v1/billing/webhooks/paystack`
- Events to listen for: `charge.success`, `subscription.create`, `subscription.disable`, `invoice.create`, `invoice.payment_failed`

---

## Auto-deploy on git push

Render automatically redeploys when you push to `main`. No extra config needed.

To trigger a manual redeploy:
- Render Dashboard → Your Service → **Manual Deploy** → Deploy latest commit

---

## ⚠️ Free Tier Gotchas

1. **Cold starts:** Free services sleep after 15min. First request takes ~30s to wake up. Your users will see a slow first load. Fix: upgrade to Starter ($7/mo) or use a cron job to ping `/health` every 14 minutes (keep-alive).

2. **Logs:** Render Dashboard → Your Service → **Logs** — check here if anything goes wrong.

3. **mediasoup WebRTC:** Requires persistent connections and UDP ports 40000-49999 open. This doesn't work on free tier (no persistent process, no UDP). For real-time WebRTC streaming, you need a VPS (DigitalOcean $12/mo droplet). The REST API and Socket.io work fine on Render free tier.

4. **Socket.io polling:** On free tier, WebSocket upgrades may be interrupted by Render's 60s request timeout. Socket.io automatically falls back to HTTP long-polling which works fine.
