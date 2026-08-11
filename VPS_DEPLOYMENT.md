# VPS Deployment — everything on one host

This replaces the split Render-plus-VPS topology. One machine serves the REST API,
the WebSocket, the WebRTC ingest, the ffmpeg fan-out to the platforms and the video
worker, at `api.omlivestream.com`. Vercel keeps the frontend, which is free and has no
reason to move.

Two reasons this is the right shape at launch. You stop paying twice, which is what
you asked for. And the media path cannot be separated from the API anyway: the
signalling routes and the mediasoup objects they refer to must be in the same process
(see Scaling), so a split deployment buys nothing but a second bill and a CORS
surface.

## Why the media path cannot run on Render at all

The browser publishes over WebRTC — DTLS-SRTP over **UDP**, on ports the process
picks at runtime, with the server's public IP baked into the ICE candidates handed to
the browser. Managed platforms give you one inbound TCP port behind a proxy. No
setting on Render makes inbound UDP arrive, so ICE never completes and the publish
times out while every REST call keeps answering correctly. Nothing about that is
fixable in configuration.

Three further properties rule out the serverless model independently of UDP. The
mediasoup routers, transports and producers live in **process memory** (`routers`,
`transports`, `producers`, `streamProducers` in
`backend/src/modules/webrtc/webrtc.service.ts:69-79`) — a stream's router exists in
exactly one process, and every request about that stream must reach it. `initWorkers()`
forks `min(cpu_count, 4)` native mediasoup subprocesses at boot
(`webrtc.service.ts:96`), and a worker dying takes the process down on purpose
(`process.exit(1)`), because a half-populated router map is worse than a restart. And
the broadcast is a long-lived local `ffmpeg` child holding UDP sockets and outbound
RTMP connections for the whole stream
(`backend/src/modules/webrtc/broadcast.service.ts:554`) — it needs a filesystem, a
stable PID and no request timeout.

Every later `broadcast.service.ts` reference is that same file, under
`modules/webrtc/` rather than the `modules/streams/` you might expect.

## Video quality and lag: what actually determines them

Worth understanding before choosing a box, because the answer is mostly "not the
CPU".

**Quality is set in the browser, not here.** When the browser negotiates H.264, ffmpeg
runs `-c:v copy` (`broadcast.service.ts:324`) and never touches the video — the bytes
your broadcaster's camera encoded are the bytes YouTube receives. There is no
generation loss and no re-encode to tune. Audio is always transcoded to AAC because
Opus cannot live in FLV (`:345`), which costs almost nothing.

**The one case that causes lag is VP8.** If the browser gives you VP8, `copyVideo` is
false and ffmpeg falls back to `libx264 -preset veryfast` (`:328-340`), which the code
logs as roughly 20x the CPU of the copy path (`:479-480`); the comment on `:326` calls
veryfast the slowest preset that reliably keeps up at 1080p30 on 2 vCPU. One such
stream will saturate a small box and every broadcaster on it starts stuttering.
Chrome, Edge and Safari all negotiate H.264, so this is mostly Firefox and mostly
rare, but it is the single failure worth alarming on: grep for
`falling back to software transcoding`.

**Sustained upload is the real ceiling.** Frames are dropped when the outbound pipe is
full, and a dropped frame is visible. Per broadcaster it is 4.5 Mbps × the number of
platforms — 13.5 Mbps for three, 36 Mbps for all eight — sustained for the length of
the stream. This is why the network interface matters more than the core count.

**Distance costs nothing here.** This is a one-way publish, not a call. ~120 ms from
Lagos to Falkenstein is absorbed by the jitter buffer and never seen by a viewer.
Don't pay for a nearer datacenter.

## Which box to buy

**[Hetzner Cloud CCX13](https://www.hetzner.com/cloud/) — 2 dedicated AMD vCPU, 8 GB
RAM, 80 GB NVMe, 20 TB traffic.** Location Falkenstein, Nuremberg or Helsinki.

Dedicated vCPU rather than the cheaper shared CPX line for one specific reason: on a
shared core another tenant's spike shows up as steal time, steal time shows up as
jitter in the RTP ingest, and jitter in the ingest cannot be repaired downstream —
it is copied to all eight platforms. It is the one place where the cheaper instance
costs you the product.

EU rather than US or Singapore because the 20 TB traffic allowance is EU-only;
Hetzner's US locations include 1 TB and Singapore 0.5 TB. On a streaming workload that
difference dwarfs the instance price.

What this box holds, honestly. Traffic is the binding limit long before CPU is: 20 TB
is about 3,300 broadcaster-hours a month at three platforms, so roughly 25 people
streaming four hours a day, every day. Concurrency is capped lower, by the network
interface — Hetzner Cloud publishes no per-instance bandwidth guarantee and their
support quotes 300–500 Mbit/s in practice, which is about 25 simultaneous broadcasters
at three platforms or 10 at eight. Whichever you hit first is your ceiling.

Resize in place from the Hetzner console when you do: CCX23, then CCX33, doubling
each time, a reboot and no reinstall. **CPU and RAM can go back down; disk cannot** —
so grow the disk last and only when you must.

Move to a [dedicated root server](https://www.hetzner.com/dedicated-rootserver/) when
peak concurrency passes roughly 25, or when monthly traffic approaches 20 TB. The
property you are buying there is a **1 Gbit port with genuinely unmetered traffic** —
Hetzner removed the cap on 1 Gbit dedicated servers permanently. Note their 10 Gbit
option is *not* unmetered: it includes 20 TB and bills overage, which for sustained
streaming is the worse deal despite the bigger number.

## What one bill does and does not cover

Render goes away entirely. What remains is a VPS bill plus the SaaS the app depends
on: Supabase, Upstash, Resend, OpenAI and Paystack. Those are unchanged by this move
and most sit on free tiers at launch volume.

Upstash in particular does **not** need replacing with a self-hosted Redis. The client
is Upstash's REST client (`config/redis.ts:6`), and the facade falls back to an
in-process store when it is unreachable, deliberately, so that a cache outage degrades
rate limiting instead of breaking every login (`config/redis.ts:11-31`). On one host
that fallback is functionally equivalent to Redis. Keep the free tier and spend the
attention elsewhere.

## DNS — `api.omlivestream.com`

Yes, this works, and it is two records at your registrar:

```
A     api     203.0.113.10          # the VPS public IPv4
AAAA  api     2a01:4f8:...          # the IPv6, if the provider gave you one
```

**If you use Cloudflare, set the proxy to DNS-only (grey cloud), not proxied.** An
orange cloud breaks this deployment in two ways at once: Cloudflare proxies TCP only,
so the entire UDP media range is dropped and no video ever arrives, and its WebSocket
buffering adds latency to the comment feed. Proxy the frontend if you like; never the
media host.

Certificates come from Let's Encrypt directly on the box — see the nginx section.

## Provisioning (Ubuntu 24.04)

```bash
sudo apt update && sudo apt upgrade -y

# ffmpeg is a hard runtime dependency, not a build tool. The broadcast
# spawns it by bare name, so it must be on PATH for the service user.
sudo apt install -y ffmpeg build-essential python3 pkg-config curl nginx

# Node 20. mediasoup builds a native worker; the toolchain above is why.
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

ffmpeg -version | head -1
node --version
```

### The three port classes

Easy to conflate, and getting them wrong produces one symptom (no video) with three
different causes. All three are verified in the source.

**Inbound UDP 40000–49999 — open to the internet.** The mediasoup RTC range, from
`MEDIASOUP_MIN_PORT` / `MEDIASOUP_MAX_PORT` (`config/env.ts:67-68`). This is where the
browser's audio and video actually arrive. It must not be NATed or proxied.

**Inbound TCP 443 — reverse-proxied to 3001.** Fastify and the Socket.io upgrade share
a single `http.Server` (`server.ts:22`), so REST and WebSocket are one port.

**UDP 50000–59998 — loopback only, keep it closed.** ffmpeg binds these to receive RTP
from mediasoup's plain transports (`broadcast.service.ts:223-238`), and both ends are
pinned to `127.0.0.1` (`broadcast.service.ts:451`), so this traffic never leaves the
box. Opening the range would let strangers inject RTP into live broadcasts.

Outbound is where RTMP happens: **outbound TCP 1935** and 443 for the RTMPS platforms,
one connection per platform from ffmpeg's `tee` muxer (`broadcast.service.ts:356-379`).
There is **no inbound RTMP listener** — port 1935 does not need to be open inbound.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing        # outbound RTMP to the platforms
sudo ufw allow 22/tcp
sudo ufw allow 80,443/tcp              # reverse proxy + certbot
sudo ufw allow 40000:49999/udp         # mediasoup RTC — the media itself
# NOT 50000:59998/udp  — loopback RTP between mediasoup and ffmpeg
# NOT 1935/tcp         — nothing listens for inbound RTMP
sudo ufw enable
```

Hetzner also has its own Cloud Firewall in the console, applied before the instance.
If you enable it, the same rules go there too — `ufw` being open does not prove the
provider's edge is.

Deploy as a non-root user:

```bash
sudo adduser --system --group --home /opt/omlivestream omls
sudo -u omls git clone <your-repo> /opt/omlivestream/app
cd /opt/omlivestream/app/backend
sudo -u omls npm ci
sudo -u omls npm run build
```

## Environment

Copy the Render backend environment verbatim, then change what the move invalidates.

`MEDIASOUP_ANNOUNCED_IP` is the one variable unique to this host and the one that
breaks silently. It is the IP written into the ICE candidates the browser is told to
send media to (`webrtc.service.ts:172`), so it must be the VPS's **public IPv4** — not
`0.0.0.0`, not a private address. Leave `MEDIASOUP_LISTEN_IP` at `0.0.0.0`: the socket
binds locally and advertises publicly, which is the split that makes this work behind
a provider's 1:1 NAT.

```bash
MEDIASOUP_ANNOUNCED_IP=203.0.113.10     # your public IPv4
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
API_BASE_URL=https://api.omlivestream.com
```

### The hostname change has a tail — this is the part that bites

Moving from `*.onrender.com` to `api.omlivestream.com` invalidates every URL that was
registered with a third party. None of these fail at boot; they fail the first time a
user touches them.

**Seven OAuth redirect URIs**, one per platform, each validated at boot
(`config/env.ts:75-98`) and each also registered in that platform's developer console.
Both sides must change, and the console side is the one that is easy to forget:

```bash
YOUTUBE_REDIRECT_URI=https://api.omlivestream.com/api/v1/platforms/oauth/callback/youtube
FACEBOOK_REDIRECT_URI=https://api.omlivestream.com/api/v1/platforms/oauth/callback/facebook
INSTAGRAM_REDIRECT_URI=https://api.omlivestream.com/api/v1/platforms/oauth/callback/instagram
TWITCH_REDIRECT_URI=https://api.omlivestream.com/api/v1/platforms/oauth/callback/twitch
TIKTOK_REDIRECT_URI=https://api.omlivestream.com/api/v1/platforms/oauth/callback/tiktok
TWITTER_REDIRECT_URI=https://api.omlivestream.com/api/v1/platforms/oauth/callback/twitter
LINKEDIN_REDIRECT_URI=https://api.omlivestream.com/api/v1/platforms/oauth/callback/linkedin
```

**The Paystack webhook.** Point it at
`https://api.omlivestream.com/api/v1/billing/webhooks/paystack` in the Paystack
dashboard. `PAYSTACK_WEBHOOK_SECRET` is the HMAC signing secret, not the URL — the
schema rejects a URL there on purpose (`config/env.ts:57-64`), because that mistake
fails silently and paid subscriptions simply never activate.

**`CORS_ALLOWED_ORIGINS`** must list the frontend origins, not this host. The allowlist
unions in `FRONTEND_URL`, `DASHBOARD_URL`, `ADMIN_URL` and `PAYMENT_URL`
(`config/env.ts:182-205`), and the same list feeds Socket.io (`socket.ts:127`), so a
missing origin breaks the WebSocket handshake and the REST call identically.

Two variables are validated at boot and read by nothing: `RTMP_RELAY_INTERNAL_URL` and
`RTMP_RELAY_SECRET` (`config/env.ts:72-73`). Neither is optional and neither has a
default, so omitting them exits at startup for a service not in the request path. Set
them to anything that parses — `http://127.0.0.1:3002` and any non-empty string.

## Running it: systemd

Docker's port publishing is the wrong tool for this workload, so plain systemd is the
shorter path. See the Docker section for why.

```ini
# /etc/systemd/system/omlivestream-api.service
[Unit]
Description=OmliveStream API + mediasoup
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=omls
WorkingDirectory=/opt/omlivestream/app/backend
EnvironmentFile=/opt/omlivestream/app/backend/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5

# ffmpeg holds many sockets per stream; the default 1024 is not enough
# once you have a handful of broadcasters going to eight platforms each.
LimitNOFILE=65535

# SIGTERM is handled: it stops the RTMP pushes first so platforms mark the
# broadcast ended instead of showing it live-but-frozen for up to two
# minutes, then stops comment ingestion and metrics sampling and flushes
# buffered comments (server.ts:44-81). Give it room.
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

The video worker is a second unit, same `EnvironmentFile`, with
`ExecStart=/usr/bin/node dist/jobs/worker.js`. It is an independent BullMQ consumer
that downloads its input over HTTP (`jobs/worker.ts:98`), so it needs no shared
filesystem.

There is no third unit for scheduled jobs. The birthday and re-engagement crons run
in-process via `node-cron` behind a Redis lock (`src/jobs/crons.ts`), so they start
with the API and do not double-fire.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now omlivestream-api omlivestream-worker
journalctl -u omlivestream-api -f
```

## Reverse proxy and TLS

Only TCP 3001 goes through the proxy. The UDP media range must reach the process
directly — do not try to route it through nginx.

```nginx
# /etc/nginx/sites-available/omlivestream
server {
    listen 443 ssl http2;
    server_name api.omlivestream.com;

    ssl_certificate     /etc/letsencrypt/live/api.omlivestream.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.omlivestream.com/privkey.pem;

    # The pre-flight upload speed test POSTs a binary blob up to 24 MB
    # (streams.routes.ts:210). nginx's 1 MB default rejects it as a 413,
    # and the broadcaster sees "could not measure your connection".
    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # Socket.io shares this port with the REST API. Without these two
        # headers the upgrade is answered as a normal request and the client
        # silently degrades to HTTP long-polling — which still works, and
        # still shows comments, just late enough to feel broken.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # A live socket is idle between events. The 60s default closes it
        # mid-broadcast and the client reconnects on a loop.
        proxy_read_timeout  7d;
        proxy_send_timeout  7d;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/omlivestream /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.omlivestream.com
sudo nginx -t && sudo systemctl reload nginx
```

TLS is not optional here beyond the usual reasons: `getUserMedia` requires a secure
context, so a broadcaster on plain HTTP cannot reach their camera at all.

## Pointing the frontend at it

Set these in Vercel, then **redeploy** — `NEXT_PUBLIC_*` values are inlined at build
time, so changing them without a rebuild changes nothing at all.

```bash
NEXT_PUBLIC_API_URL=https://api.omlivestream.com/api/v1
NEXT_PUBLIC_SOCKET_URL=https://api.omlivestream.com
```

The defaults are `http://localhost:3001/...` (`frontend/src/lib/api.ts:3`,
`frontend/src/lib/socket.ts:18`), which is a confusing production failure because the
site loads perfectly and only the live features are dead.

## Scaling — and why a load balancer is not the next step

A round-robin load balancer in front of two instances makes this app *less* reliable,
not more. A stream's router, transports and producers live in one process's memory, so
a `POST /streams/:id/produce` landing on a different instance than the transport it
references fails with `Stream router not found` (`webrtc.service.ts:169`) — a 404 on a
stream that plainly exists. Roughly half of all signalling calls would fail.

Sticky sessions do not fix it either. The stream is created by one call and its
transports by later ones; affinity by client IP breaks the moment a broadcaster's
phone changes network, and affinity by cookie does not cover the Socket.io upgrade.

What multi-host actually needs is **stream affinity**: record which host owns a stream
when it goes live, keyed in Redis, and route every subsequent request for that stream
there. Nothing in `backend/src/` records this today — there is no instance id,
hostname or node id anywhere in the tree. Socket.io rooms already span instances
through the Redis adapter (`socket.ts:86-113`), so comments and viewer counts fan out
correctly once that exists; it is only the mediasoup objects that are pinned.

Until then: **run exactly one instance and scale it vertically.** That is not a
limitation you will feel soon — one CCX-class box carries more concurrent broadcasters
than most launches see in their first year, and the resize is a reboot.

## Verifying it works

```bash
curl -s https://api.omlivestream.com/health
journalctl -u omlivestream-api | grep "mediasoup worker"   # expect min(cpus,4) lines
```

Confirm the UDP range is reachable **from off the box** — the check that catches a
provider firewall you forgot:

```bash
sudo nc -u -l 40000                          # on the VPS
echo probe | nc -u 203.0.113.10 40000        # from your laptop
```

Then run a real broadcast and watch for the two failures that look identical in the
UI. `falling back to software transcoding` means the browser negotiated VP8 and one
core is now pinned. `ffmpeg exited` is a restart with backoff, capped at five attempts
before the broadcast is declared down (`broadcast.service.ts:578-609`), and the
`stderrTail` logged alongside it names the platform that rejected the key.

If ICE never completes, check `MEDIASOUP_ANNOUNCED_IP` first. It is wrong far more
often than the firewall.

## If you must use Docker

`backend/docker-compose.yml` predates this document and three things in it are wrong
for a production media host.

It publishes `40000-40050:40000-40050/udp` — 51 ports against a configured range of
10,000, so most sessions land on a port that never reaches the container. Widening the
mapping is not the fix: Docker's userland proxy allocates per published port, and a
10,000-port UDP range makes container start pathologically slow. The standard answer
for mediasoup in Docker is to skip the network namespace entirely. It also sets
`NODE_ENV: development`, which switches CORS into localhost-permitting mode
(`config/env.ts:190-192`), and it depends on the dead relay service.

```yaml
services:
  api:
    build: { context: ., dockerfile: Dockerfile }
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
    # No port publishing and no bridge network. host mode is what makes the
    # 10,000-port UDP range workable, and it also means MEDIASOUP_ANNOUNCED_IP
    # behaves the same inside the container as outside it.
    network_mode: host

  worker:
    build: { context: ., dockerfile: Dockerfile }
    restart: unless-stopped
    command: ["node", "dist/jobs/worker.js"]
    env_file: .env
    environment:
      NODE_ENV: production
```

`network_mode: host` is Linux-only, which is fine for a VPS and one more reason
systemd is the simpler choice.

## About the Go RTMP relay

`backend/rtmp-relay/` does not participate in the current architecture, and older notes
telling you to open port 1935 are wrong. Broadcasts are fanned out by the backend's own
ffmpeg — one `-f tee` invocation with a slave per platform, `onfail=ignore` so a
rejected YouTube key does not take down Twitch (`broadcast.service.ts:356-379`).
Nothing calls the relay: `RTMP_RELAY_INTERNAL_URL` and `RTMP_RELAY_SECRET` appear only
in `config/env.ts`.

It could not work if it were called. It reads from `rtmp://127.0.0.1:1935/live/{streamId}`
(`rtmp-relay/main.go:181`) — an RTMP server on its own loopback that nothing publishes
to and that its container does not run. Leave it out of the deployment.

## Migrations

Before the first boot, run the SQL in `backend/scripts/` in numeric order:
`migrate.sql`, then v2, v3, v4, v5, v6, v8, v9, v10 (waitlist discount), v11 (social
identities), v12 (notifications), v13 (AI usage and chat history), v14 (analytics
aggregation). v9 contains aggregation RPCs and indexes referencing columns added by
later files, so running them out of order fails in ways that are tedious to unpick.

v14 replaces v9's `analytics_overview`. v9 summed `stream_metrics.viewers`, which is a
concurrent-viewer level rather than a total — summing it produced a "Total views"
figure that grew with sampling frequency instead of audience. v14 reports peak
concurrent viewers from the metrics series and total views from the platforms' own
post-broadcast counts. If you seeded `platform_analytics` or `stream_metrics` by hand
during development, the commented-out deletes at the foot of the file clear those
invented rows; they are commented out because a delete should be a decision, not a
side effect of running a migration.

