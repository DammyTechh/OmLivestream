# VPS Deployment — Streaming (UDP + RTMP)

This covers the one part of OmliveStream that cannot run on a managed platform: the
media path. Everything else (REST API, auth, billing, admin, AI, analytics) is happy
on Render, and the frontend is happy on Vercel. This document is about the process
that terminates WebRTC and runs ffmpeg.

## Why the media path needs a VPS

The browser publishes over WebRTC to mediasoup. That is DTLS-SRTP over **UDP**, on
ports the process chooses at runtime, with the server's public IP embedded in the ICE
candidates it hands the browser. Managed platforms give you one inbound TCP port
behind a proxy. There is no configuration of Render or Vercel that makes inbound UDP
arrive, so ICE never completes and the publish silently times out — the API answers
every REST call correctly while no video ever moves.

Three further properties rule out the serverless model, independent of UDP:

The mediasoup routers, transports and producers live in **process memory**
(`routers`, `transports`, `producers`, `streamProducers` in
`backend/src/modules/webrtc/webrtc.service.ts:69-79`). A stream's router exists in
exactly one process. Any request about that stream must reach the same process.

`initWorkers()` forks `min(cpu_count, 4)` native mediasoup C++ subprocesses at boot
(`webrtc.service.ts:96`). A worker dying takes the whole process down deliberately
(`process.exit(1)`), because a half-populated router map is worse than a restart.

The broadcast is a long-lived local `ffmpeg` child process holding UDP sockets and
outbound RTMP connections for the duration of the stream
(`broadcast.service.ts:554`). It needs a filesystem, a stable PID and no request
timeout.

## The three port classes

These are easy to conflate, and getting them wrong produces exactly one symptom
(no video) with three different causes. All three are verified in the source.

**Inbound UDP 40000–49999 — must be open to the internet.** The mediasoup RTC range,
from `MEDIASOUP_MIN_PORT` / `MEDIASOUP_MAX_PORT` (`config/env.ts:67-68`). This is
where the browser's audio and video actually arrive. It must not be NATed or
proxied.

**Inbound TCP 3001 — one port, reverse-proxied.** Fastify plus the Socket.io upgrade
share a single `http.Server` (`server.ts:22`), so REST and WebSocket are the same
port.

**UDP 50000–59998 — loopback only, keep it closed.** ffmpeg binds these to receive
RTP from mediasoup's plain transports (`broadcast.service.ts:223-238`). Both ends are
pinned to `127.0.0.1` (`listenIp: { ip: '127.0.0.1' }`, `broadcast.service.ts:449`),
so this traffic never leaves the box. Opening the range in your firewall grants
strangers the ability to inject RTP into live broadcasts. Leave it shut.

Outbound is where RTMP happens: **outbound TCP 1935** (and 443 for the RTMPS
platforms) from the VPS to YouTube, Twitch, Facebook and the rest. ffmpeg's `tee`
muxer opens one connection per platform from this process
(`broadcast.service.ts:356-379`). Most providers allow all egress by default; if you
run a restrictive egress policy, this is the rule to add.

There is **no inbound RTMP listener**, and port 1935 does not need to be open. See
the relay section below.

## Sizing

The copy path is the whole design: when the browser negotiates H.264, ffmpeg runs
`-c:v copy` and never touches the video (`broadcast.service.ts:324`). Audio is always
transcoded to AAC because Opus cannot live in FLV (`:345`), which is cheap. So a
1080p30 stream to eight platforms costs a few percent of a core plus the outbound
bandwidth.

The exception is expensive and worth alarming on. If the browser gives you VP8,
`copyVideo` is false and ffmpeg falls back to `libx264 -preset veryfast`
(`:328-340`), which the code itself notes is roughly 20x the CPU. The comment on
`:327` calls veryfast the slowest preset that reliably keeps up at 1080p30 on 2 vCPU —
so one transcoding stream will saturate a small box. Grep your logs for
`falling back to software transcoding`.

Bandwidth is the real constraint, and it multiplies. Eight platforms at 4.5 Mbps is
36 Mbps **per broadcaster**, sustained, outbound. Ten concurrent broadcasters is
360 Mbps. Check your provider's egress allowance before your core count.

A reasonable start is 4 vCPU / 8 GB with unmetered or generous egress: Hetzner
CPX31, DigitalOcean CPU-Optimized 4vCPU, or equivalent. Scale on bandwidth and
concurrent-broadcaster count, not on CPU.

## Provisioning (Ubuntu 24.04)

```bash
sudo apt update && sudo apt upgrade -y

# ffmpeg is a hard runtime dependency, not a build tool. The broadcast
# spawns it by bare name, so it must be on PATH for the service user.
sudo apt install -y ffmpeg build-essential python3 pkg-config curl

# Node 20. mediasoup builds a native worker; the toolchain above is why.
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

ffmpeg -version | head -1
node --version
```

Then the firewall. Note what is deliberately absent:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing        # outbound RTMP to the platforms
sudo ufw allow 22/tcp
sudo ufw allow 80,443/tcp              # reverse proxy
sudo ufw allow 40000:49999/udp         # mediasoup RTC — the media itself
# NOT 50000:59998/udp  — loopback RTP between mediasoup and ffmpeg
# NOT 1935/tcp         — nothing listens for inbound RTMP
sudo ufw enable
```

Deploy as a non-root user:

```bash
sudo adduser --system --group --home /opt/omlivestream omls
sudo -u omls git clone <your-repo> /opt/omlivestream/app
cd /opt/omlivestream/app/backend
sudo -u omls npm ci
sudo -u omls npm run build
```

## Environment

Copy your Render backend environment verbatim, then change these.

`MEDIASOUP_ANNOUNCED_IP` is the one variable unique to this host and the one that
breaks silently. It is the IP written into the ICE candidates the browser is told to
send media to (`webrtc.service.ts:172`), so it must be the VPS's **public IPv4**, not
`0.0.0.0` and not a private address. Leave `MEDIASOUP_LISTEN_IP` at `0.0.0.0`; the
socket binds locally and advertises publicly, which is the split that makes this work
behind a provider's 1:1 NAT.

```bash
MEDIASOUP_ANNOUNCED_IP=203.0.113.10     # your public IPv4
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
```

Two variables are validated at boot but read by nothing:
`RTMP_RELAY_INTERNAL_URL` (`z.string().url()`) and `RTMP_RELAY_SECRET`
(`z.string().min(1)`), at `config/env.ts:72-73`. Neither is optional and neither has a
default, so omitting them exits the process at startup with a validation error for a
service that is not in the request path. Set them to anything that parses —
`http://127.0.0.1:3002` and any non-empty string — until they are removed from the
schema.

`UPSTASH_REDIS_URL` (the TCP one, not the REST one) is what enables the Socket.io
Redis adapter and BullMQ. On a single media VPS the adapter is not strictly required,
but set it anyway: without it the process logs a warning that rooms do not span
processes (`socket.ts:89-94`), and you want the video worker's queue available.

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
# minutes, then flushes buffered comments (server.ts:44-81). Give it room.
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

The video worker is a second unit, same `EnvironmentFile`, with
`ExecStart=/usr/bin/node dist/jobs/worker.js`. It is an independent BullMQ consumer
that downloads its input over HTTP (`jobs/worker.ts:98`), so it does not need to share
a filesystem with the API and can live on a different host if you prefer.

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
    server_name media.omlivestream.com;

    ssl_certificate     /etc/letsencrypt/live/media.omlivestream.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/media.omlivestream.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # Socket.io shares this port with the REST API. Without these two
        # headers the upgrade is answered as a normal request and the client
        # silently degrades to HTTP long-polling.
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

`sudo certbot --nginx -d media.omlivestream.com` issues the certificate. Getting TLS
right here is not optional: `getUserMedia` requires a secure context, so a broadcaster
on plain HTTP cannot access their camera at all.

## Pointing the apps at it

Set these in Vercel, then redeploy — `NEXT_PUBLIC_*` values are inlined at build
time, so changing them without a rebuild changes nothing.

```bash
NEXT_PUBLIC_API_URL=https://media.omlivestream.com/api/v1
NEXT_PUBLIC_SOCKET_URL=https://media.omlivestream.com
```

Defaults are `http://localhost:3001/...` (`frontend/src/lib/api.ts:3`,
`frontend/src/lib/socket.ts:18`), which is a confusing failure in production because
the site loads perfectly and only the live features are dead.

On the backend, add the VPS origin to `CORS_ALLOWED_ORIGINS` and set `API_BASE_URL` to
the proxied HTTPS URL. The allowlist already unions in `FRONTEND_URL`,
`DASHBOARD_URL`, `ADMIN_URL` and `PAYMENT_URL` (`config/env.ts:182-205`), so the
dashboard subdomain works without a separate entry. The same list feeds the Socket.io
CORS config (`socket.ts:127`), so a missing origin breaks the WebSocket handshake and
the REST call identically.

## About the Go RTMP relay

`backend/rtmp-relay/` does not participate in the current architecture, and the older
deployment notes that tell you to open port 1935 for it are wrong.

Broadcasts are fanned out by the backend's own ffmpeg. One `-f tee` invocation opens
a slave per platform and pushes to each platform's ingest directly
(`broadcast.service.ts:356-379`), with `onfail=ignore` so a rejected YouTube key does
not take down Twitch. Nothing calls the relay: `RTMP_RELAY_INTERNAL_URL` and
`RTMP_RELAY_SECRET` appear only in `config/env.ts` and in no other source file.

The relay also could not work if it were called. It reads its source from
`rtmp://127.0.0.1:1935/live/{streamId}` (`rtmp-relay/main.go:181`) — an RTMP server on
its own loopback that nothing in the topology publishes to and that its container does
not run. It is a leftover from a design where a local RTMP server sat between
mediasoup and the platforms.

Leave it out of the deployment. Do not open 1935. If you later want per-platform
process isolation, it is a reasonable starting point, but it needs an actual RTMP
ingest in front of it first.

## If you must use Docker

`backend/docker-compose.yml` exists and predates this document. Three things in it are
wrong for a production media host.

It publishes `40000-40050:40000-40050/udp` — 51 ports against a configured range of
10,000. Streams get RTC ports from the whole range, so most sessions land on a port
that never reaches the container. Widening the mapping to the full range is not the
fix: Docker's userland proxy allocates per published port, and a 10,000-port UDP range
makes container start pathologically slow and memory-hungry. The standard answer for
mediasoup in Docker is to skip the network namespace entirely.

It also sets `NODE_ENV: development`, which switches the CORS allowlist into
localhost-permitting mode (`config/env.ts:190-192`), and it depends on the relay
service described above.

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

The `rtmp-relay` service and the `depends_on` that references it can be deleted.
`network_mode: host` is Linux-only, which is fine for a VPS and one more reason
systemd is the simpler choice.

## Scaling

The media process cannot be replicated behind a round-robin load balancer. A stream's
router, transports and producers are in one process's memory, so a `POST
/streams/:id/produce` that lands on a different instance than the transport it
references fails with `Stream router not found` (`webrtc.service.ts:169`) — a 404 on a
stream that plainly exists.

Scale by sharding whole streams instead: run N media hosts, and record which host owns
a stream when it goes live so every subsequent request for it routes there. Socket.io
rooms already span instances through the Redis adapter (`socket.ts:86-113`), so
comments and viewer counts fan out correctly across hosts once the adapter is
configured; it is only the mediasoup objects that are pinned.

Until that routing exists, run exactly one media instance and scale vertically. The
REST-only surface on Render can still scale horizontally as normal — it holds no
mediasoup state.

## Verifying it works

Confirm the process is healthy and the workers actually forked:

```bash
curl -s https://media.omlivestream.com/health
journalctl -u omlivestream-api | grep "mediasoup worker"   # expect min(cpus,4) lines
```

Confirm the UDP range is reachable **from off the box**, which is the check that
catches a cloud firewall or security group you forgot about. `ufw` being open does not
prove the provider's edge is:

```bash
sudo nc -u -l 40000                          # on the VPS
echo probe | nc -u 203.0.113.10 40000        # from your laptop
```

Then a real broadcast, and watch for the two failure modes that look identical in the
UI. Grep for `falling back to software transcoding` — that is the browser having
negotiated VP8, and it will pin a core rather than fail outright. Grep for `ffmpeg
exited` — a restart with backoff, capped at five attempts before the broadcast is
declared down (`broadcast.service.ts:590-609`), where the logged `stderrTail` names the
platform that rejected the key.

If ICE never completes, `MEDIASOUP_ANNOUNCED_IP` is the first thing to check. It is
wrong far more often than the firewall.

## Migrations

Before the first boot, run the SQL in `backend/scripts/` in numeric order:
`migrate.sql`, then v2, v3, v4, v5, v6, v8, v9, v10 (waitlist discount), v11 (social
identities), v12 (notifications), v13 (AI usage and chat history), v14 (analytics
aggregation). v9 in particular contains aggregation RPCs and indexes that reference
columns added by later files, so running them out of order fails in ways that are
tedious to unpick.

v14 replaces v9's `analytics_overview`. v9 summed `stream_metrics.viewers`, which is a
concurrent-viewer level rather than a total — summing it produced a "Total views" figure
that grew with sampling frequency instead of audience. v14 reports peak concurrent
viewers from the metrics series and total views from the platforms' own post-broadcast
counts. If you seeded `platform_analytics` or `stream_metrics` by hand during
development, the commented-out deletes at the foot of the file clear those invented rows;
they are commented out because a delete should be a decision, not a side effect of
running a migration.

