#!/usr/bin/env bash
#
# OmliveStream — stage 2: deploy the API onto a box that stage 1 has prepared.
#
#     scp deploy/02-deploy.sh root@YOUR_IP:/root/
#     ssh root@YOUR_IP 'bash /root/02-deploy.sh'
#
# Stage 1 installed and tuned the system. This clones the code, builds it,
# collects the environment, installs the systemd units, and puts nginx and TLS
# in front. At the end the API is serving on https://api.omlivestream.com.
#
# Safe to re-run. Every step checks its own state, so a run that fails halfway
# is resumed by running the whole thing again rather than unpicking it. Re-running
# on a live box is also how you deploy an update: it pulls, rebuilds and restarts.
#
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/DammyTechh/OmLivestream.git}
BRANCH=${BRANCH:-main}
SERVICE_USER=omls
APP_ROOT=/opt/omlivestream
API_DOMAIN=${API_DOMAIN:-api.omlivestream.com}
ENV_FILE=$APP_ROOT/backend/.env

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m !  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m ✗  %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root."

# ── 0. Confirm stage 1 actually ran ─────────────────────────────────────────
# Failing here with a clear message beats failing later inside a build with an
# error that looks like a code problem.
step "Checking stage 1 completed"
command -v node    >/dev/null || die "node missing — run 01-provision.sh first."
command -v ffmpeg  >/dev/null || die "ffmpeg missing — run 01-provision.sh first."
command -v nginx   >/dev/null || die "nginx missing — run 01-provision.sh first."
redis-cli ping >/dev/null 2>&1 || die "redis not responding — run 01-provision.sh first."
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q ' libx264' \
  || die "ffmpeg has no libx264. The broadcast pipeline cannot encode without it."
echo "  node $(node --version), ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}'), redis up"

# ── 1. Service user ─────────────────────────────────────────────────────────
# A dedicated non-login user. The API spawns ffmpeg and mediasoup workers; if
# any of that is ever exploited, it should not be running as root.
step "Service user: $SERVICE_USER"
if id "$SERVICE_USER" &>/dev/null; then
  echo "  exists"
else
  useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  echo "  created"
fi

# ── 2. Code ─────────────────────────────────────────────────────────────────
step "Fetching code"
if [[ -d $APP_ROOT/.git ]]; then
  git -C "$APP_ROOT" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_ROOT" reset --hard "origin/$BRANCH"
  echo "  updated to $(git -C "$APP_ROOT" rev-parse --short HEAD)"
else
  mkdir -p "$APP_ROOT"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_ROOT"
  echo "  cloned $(git -C "$APP_ROOT" rev-parse --short HEAD)"
fi
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_ROOT"

# ── 3. Environment ──────────────────────────────────────────────────────────
step "Environment"
if [[ -f $ENV_FILE ]]; then
  echo "  $ENV_FILE exists — leaving it alone"
else
  # Derive the public IP the same way stage 1 does, so the two agree.
  PUBLIC_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)
  cat > "$ENV_FILE" <<EOF
# ─── FILL THIS IN, then re-run this script ───────────────────────────────
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
API_BASE_URL=https://${API_DOMAIN}

# The one value unique to this host. If it is wrong, streams connect and then
# carry no video — the hardest failure here to diagnose.
MEDIASOUP_ANNOUNCED_IP=${PUBLIC_IP:-SET_YOUR_PUBLIC_IPV4}
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
# Blank = one worker per core, which is right on a dedicated box.
MEDIASOUP_NUM_WORKERS=

# Leave false. Only for testing mobile sign-in through Expo Go.
ALLOW_DEV_OAUTH_RETURN=false

# ─── Copy the rest verbatim from your Render environment ────────────────
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
JWT_SECRET=
JWT_REFRESH_SECRET=
ENCRYPTION_KEY=
RTMP_RELAY_SECRET=
RESEND_API_KEY=
EMAIL_FROM=
OPENAI_API_KEY=
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=
PAYSTACK_WEBHOOK_SECRET=
FRONTEND_URL=https://www.omlivestream.com
DASHBOARD_URL=https://dashboard.omlivestream.com
ADMIN_URL=https://admin.omlivestream.com
PAYMENT_URL=https://payment.omlivestream.com
CORS_ALLOWED_ORIGINS=https://omlivestream.com,https://www.omlivestream.com,https://dashboard.omlivestream.com,https://admin.omlivestream.com,https://payment.omlivestream.com
SUPPORT_EMAIL=support@omlivestream.com
SALES_EMAIL=sales@omlivestream.com
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=https://${API_DOMAIN}/api/v1/platforms/oauth/callback/youtube
META_APP_ID=
META_APP_SECRET=
FACEBOOK_REDIRECT_URI=https://${API_DOMAIN}/api/v1/platforms/oauth/callback/facebook
INSTAGRAM_REDIRECT_URI=https://${API_DOMAIN}/api/v1/platforms/oauth/callback/instagram
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=https://${API_DOMAIN}/api/v1/platforms/oauth/callback/tiktok
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
TWITTER_REDIRECT_URI=https://${API_DOMAIN}/api/v1/platforms/oauth/callback/twitter
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=https://${API_DOMAIN}/api/v1/platforms/oauth/callback/linkedin
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_REDIRECT_URI=https://${API_DOMAIN}/api/v1/platforms/oauth/callback/twitch
EOF
  chown "$SERVICE_USER":"$SERVICE_USER" "$ENV_FILE"
  # 600, not 644: this file holds the service-role key and every platform
  # secret. Any other user on the box could otherwise read all of it.
  chmod 600 "$ENV_FILE"
  warn "Template written to $ENV_FILE"
  warn "Fill it in (nano $ENV_FILE), then run this script again."
  exit 0
fi

# Refuse to continue on an unfilled template rather than starting a server that
# will fail in a confusing way at the first request.
MISSING=$(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|ENCRYPTION_KEY|PAYSTACK_SECRET_KEY)=$' "$ENV_FILE" | cut -d= -f1 | tr '\n' ' ' || true)
[[ -z $MISSING ]] || die "These are still empty in $ENV_FILE: $MISSING"
grep -q '^MEDIASOUP_ANNOUNCED_IP=SET_YOUR_PUBLIC_IPV4' "$ENV_FILE" \
  && die "MEDIASOUP_ANNOUNCED_IP is still the placeholder. Set your public IPv4."
echo "  looks filled in"

# ── 4. Build ────────────────────────────────────────────────────────────────
step "Installing dependencies and building"
cd "$APP_ROOT/backend"
# `npm ci`, not `npm install`: it installs exactly the lockfile, so the box
# runs the same dependency tree that was tested rather than whatever resolved
# today. mediasoup compiles a native worker here, which is the slow part.
sudo -u "$SERVICE_USER" npm ci --no-audit --no-fund
sudo -u "$SERVICE_USER" npm run build
[[ -f dist/server.js ]] || die "Build produced no dist/server.js."
echo "  built"

# ── 5. systemd ──────────────────────────────────────────────────────────────
step "systemd units"
cat > /etc/systemd/system/omlivestream-api.service <<EOF
[Unit]
Description=OmliveStream API
After=network-online.target redis-server.service
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_ROOT/backend
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5

# ffmpeg holds many sockets per live stream; the default 1024 runs out once a
# handful of broadcasters are each going to several platforms.
LimitNOFILE=65535

# SIGTERM is handled properly: it stops the RTMP pushes first so platforms mark
# broadcasts ended rather than showing them live-but-frozen, then flushes
# buffered comments. Give it room to finish instead of killing it mid-flush.
KillSignal=SIGTERM
TimeoutStopSec=45

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/omlivestream-worker.service <<EOF
[Unit]
Description=OmliveStream background worker (BullMQ)
After=network-online.target redis-server.service
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_ROOT/backend
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node dist/jobs/worker.js
Restart=always
RestartSec=5
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now omlivestream-api omlivestream-worker
sleep 4
systemctl is-active --quiet omlivestream-api \
  || { journalctl -u omlivestream-api -n 40 --no-pager; die "API failed to start — log above."; }
echo "  api and worker running"

# ── 6. nginx ────────────────────────────────────────────────────────────────
step "nginx"
cat > /etc/nginx/sites-available/omlivestream <<EOF
server {
    listen 80;
    server_name ${API_DOMAIN};

    # Uploads carry base64 avatars and thumbnails; the 1MB default rejects them.
    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # Socket.io needs these two or live comments and viewer counts silently
        # fall back to long-polling and then stop working.
        proxy_set_header Upgrade    \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # A live stream's socket is idle between events for long stretches.
        # The 60s default would cut it and the dashboard would go quiet.
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/omlivestream /etc/nginx/sites-enabled/omlivestream
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "  proxying :3001"

# ── 7. TLS ──────────────────────────────────────────────────────────────────
step "TLS"
if [[ -d /etc/letsencrypt/live/$API_DOMAIN ]]; then
  echo "  certificate already present"
else
  # Requires the A record to resolve here already; certbot proves control over
  # the domain by answering on port 80.
  if ! getent hosts "$API_DOMAIN" >/dev/null; then
    warn "$API_DOMAIN does not resolve yet. Point the A record here, then re-run."
  else
    certbot --nginx -d "$API_DOMAIN" --non-interactive --agree-tos \
            -m "${CERTBOT_EMAIL:-support@omlivestream.com}" --redirect
    echo "  issued"
  fi
fi

# ── 8. Verify ───────────────────────────────────────────────────────────────
step "Verifying"
sleep 2
LOCAL=$(curl -fsS -m 5 http://127.0.0.1:3001/health 2>/dev/null || echo FAILED)
echo "  local  : $LOCAL"
PUBLIC=$(curl -fsS -m 8 "https://${API_DOMAIN}/api/v1/health" 2>/dev/null || echo "not reachable yet")
echo "  public : $PUBLIC"

cat <<DONE

────────────────────────────────────────────────────────────
Deployed.

  systemctl status omlivestream-api
  journalctl -u omlivestream-api -f

Still to do, in this order:

  1. Run any unapplied migrations in the Supabase SQL editor.
     Newest are migrate_v15_tour_views.sql and migrate_v16_stream_feedback.sql.

  2. Point the frontend at this host: set NEXT_PUBLIC_API_URL to
     https://${API_DOMAIN}/api/v1 and redeploy it.

  3. Update the Paystack webhook URL to
     https://${API_DOMAIN}/api/v1/billing/webhooks/paystack
     and re-copy the signing secret — it differs between test and live.

  4. Re-register every OAuth redirect URI against this host in the
     Google, Meta, TikTok, X, LinkedIn and Twitch consoles.

  5. Do one real broadcast end to end before telling anyone.

To deploy an update later, just run this script again.
────────────────────────────────────────────────────────────
DONE
