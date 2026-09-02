#!/usr/bin/env bash
#
# OmliveStream — stage 1 provisioning for a fresh Ubuntu 24.04 box.
#
# Run as root on a brand new Ubuntu 24.04 host (Contabo, Hetzner, OVH, Hostinger —
# the script is provider-neutral):
#
#     scp deploy/01-provision.sh root@YOUR_IP:/root/
#     ssh root@YOUR_IP 'bash /root/01-provision.sh'
#
# This stage stops short of deploying the app. It installs and tunes the
# system, then prints a REPORT block at the end. Paste that block back and
# it can be checked before stage 2 (clone, build, .env, systemd, TLS).
#
# Safe to re-run. Every step checks its own state first, so a failed run can
# be resumed by running the whole thing again rather than unpicking it.
#
set -euo pipefail

NODE_MAJOR=22
SERVICE_USER=omls
APP_ROOT=/opt/omlivestream

# The mediasoup RTC range from config/env.ts:67-68. These are the ports the
# browser's audio and video actually arrive on, and the only inbound UDP that
# may be open. 50000-59998 is loopback RTP between mediasoup and ffmpeg and
# stays shut — opening it would let strangers inject media into live streams.
RTC_MIN=40000
RTC_MAX=49999

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[0;32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[0;33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[0;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. Preflight ────────────────────────────────────────────────────────────
step "Preflight"

[[ $EUID -eq 0 ]] || die "run as root (ssh root@your-ip)"

. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || die "expected Ubuntu, found ${PRETTY_NAME:-unknown}"
[[ "${VERSION_ID:-}" == "24.04" ]] \
  || warn "written for Ubuntu 24.04, this is ${VERSION_ID:-unknown} — continuing"
ok "${PRETTY_NAME}"

MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
CPUS=$(nproc)
ok "${CPUS} vCPU, ${MEM_MB} MB RAM"
(( MEM_MB >= 7000 )) || warn "under 8 GB — mediasoup plus ffmpeg will be tight"

# Derive the public IPv4 from the routing table rather than an external
# lookup service. On most VPS hosts the public address sits directly on the
# interface, so the source address for an outbound route IS the announced IP.
# Where the host uses 1:1 NAT instead, the warning below fires and the value
# has to be set by hand from the control panel.
#
# The `|| true` matters: pipefail makes this assignment inherit the failure
# when there is no default route, and set -e would then abort with no message
# at all rather than reaching the explanatory check below.
PUBLIC_IP=$(ip -4 route get 1.1.1.1 2>/dev/null \
  | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' || true)

if [[ -z "$PUBLIC_IP" ]]; then
  # No default route yet — fall back to the first global-scope IPv4.
  PUBLIC_IP=$(ip -4 -o addr show scope global 2>/dev/null \
    | awk 'NR==1 {split($4,a,"/"); print a[1]}' || true)
fi

[[ -n "$PUBLIC_IP" ]] || die "could not determine public IPv4 — is IPv4 enabled on this server?"
case "$PUBLIC_IP" in
  10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|127.*)
    warn "$PUBLIC_IP is private — behind NAT, MEDIASOUP_ANNOUNCED_IP must be the public address" ;;
esac
ok "public IPv4: ${PUBLIC_IP}"

# ── 1. Packages ─────────────────────────────────────────────────────────────
step "System packages"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

# ffmpeg is a runtime dependency, not a build tool: broadcast.service.ts:554
# spawns it by bare name, so it must be on PATH for the service user.
#
# build-essential, python3 and pkg-config are here because mediasoup 3.19
# ships a native worker. It prefers a prebuilt binary but falls back to
# compiling with meson/ninja, and that fallback is silent until it fails.
apt-get install -y -qq \
  ffmpeg \
  build-essential python3 python3-pip pkg-config \
  nginx certbot python3-certbot-nginx \
  redis-server \
  ufw curl git jq ca-certificates unattended-upgrades

ok "ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"
ok "nginx $(nginx -v 2>&1 | awk -F/ '{print $2}')"

# libx264 is the software encoder used only when a browser sends VP8 instead
# of H.264 (broadcast.service.ts:328-340). Without it that path dies rather
# than degrading, so confirm it is actually compiled in.
# Captured, not piped into `grep -q`.
#
# `grep -q` exits at the first match and closes the pipe, so ffmpeg dies of
# SIGPIPE (141). With `set -o pipefail` that makes the pipeline report failure
# even when the match succeeded — a false MISSING on a server that has libx264.
FFMPEG_ENC=$(ffmpeg -hide_banner -encoders 2>/dev/null || true)
if [[ $FFMPEG_ENC == *libx264* ]]; then
  ok "libx264 present (VP8 fallback path will work)"
else
  warn "libx264 MISSING — a browser sending VP8 cannot be transcoded"
fi

# ── 2. Node ─────────────────────────────────────────────────────────────────
step "Node ${NODE_MAJOR} LTS"

# Node 20 reached end-of-life in April 2026, so 22 is the current LTS.
# tsconfig targets ES2022 and mediasoup 3.19 needs >= 18, so 22 is in range.
if [[ "$(node --version 2>/dev/null | cut -d. -f1 | tr -d v)" == "$NODE_MAJOR" ]]; then
  ok "already on $(node --version)"
else
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs
  ok "installed $(node --version)"
fi
ok "npm $(npm --version)"

# ── 3. Swap ─────────────────────────────────────────────────────────────────
step "Swap"

# Most cloud images ship with none. `npm ci` plus tsc plus a possible mediasoup
# compile can spike well past steady-state usage, and an OOM kill mid-build
# leaves a half-populated node_modules that fails confusingly afterwards.
# Swappiness stays low so this is an overflow valve, not something the media
# path ever touches — swapping during a live broadcast would cause the exact
# stutter this box exists to avoid.
if swapon --show --noheadings | grep -q .; then
  ok "already present: $(swapon --show=NAME,SIZE --noheadings | tr '\n' ' ')"
else
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap -q /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "4 GB swapfile created"
fi
sysctl -qw vm.swappiness=10

# ── 4. Kernel tuning for the media path ─────────────────────────────────────
step "Kernel tuning"

modprobe nf_conntrack 2>/dev/null || true

cat > /etc/sysctl.d/99-omlivestream.conf <<'SYSCTL'
# Tuning for a mediasoup SFU that also pushes RTMP out to eight platforms.

# UDP socket buffers. The defaults are sized for occasional datagrams, not
# for continuous RTP from many broadcasters. When the receive buffer fills,
# the kernel drops packets before mediasoup ever sees them — which surfaces
# as pixelation and freezing that no application-level setting can fix,
# because the data is already gone.
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576

# BBR plus fair queueing for outbound TCP. Every platform push is a long
# sustained upload, and on a loss-prone path the default CUBIC reads loss as
# congestion and backs off hard — which the viewer sees as the stream
# stalling. BBR paces on measured bandwidth instead, so transient loss does
# not collapse the send rate.
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# Backlog headroom for bursts of new connections.
net.core.somaxconn = 4096
net.core.netdev_max_backlog = 5000

# ffmpeg holds many descriptors per broadcast; systemd raises the per-service
# limit but the system ceiling has to clear it.
fs.file-max = 2097152

# Each RTP flow across a 10,000-port range consumes a conntrack entry. A full
# table drops new packets silently, so some viewers get no video with nothing
# in the application log to explain it.
net.netfilter.nf_conntrack_max = 262144
SYSCTL

sysctl -q --system 2>/dev/null || warn "some sysctl keys were rejected — see the report below"
ok "congestion control: $(sysctl -n net.ipv4.tcp_congestion_control)"
ok "udp rmem_max: $(sysctl -n net.core.rmem_max)"

# ── 5. Redis ────────────────────────────────────────────────────────────────
step "Redis (local, for BullMQ and the rate limiter)"

# BullMQ needs a real TCP Redis. When UPSTASH_REDIS_URL is unset, queues.ts
# hands back a stub whose .add() returns null without erroring, so video and
# email jobs vanish silently. A local instance costs nothing, has no network
# hop, and tlsFor() at config/redis.ts:229 already omits TLS for redis://.
install -d -m 0755 /etc/redis/redis.conf.d 2>/dev/null || true
cat > /etc/redis/redis.conf.d/omlivestream.conf <<'REDISCONF'
bind 127.0.0.1 -::1
protected-mode yes

# BullMQ requires noeviction. Under any allkeys policy Redis may evict job
# hashes while a job is in flight, and the job disappears mid-execution.
maxmemory 512mb
maxmemory-policy noeviction

# Jobs should survive a restart. everysec bounds the worst case to one
# second of queued work rather than the whole backlog.
appendonly yes
appendfsync everysec
REDISCONF

grep -q 'redis.conf.d' /etc/redis/redis.conf \
  || echo 'include /etc/redis/redis.conf.d/*.conf' >> /etc/redis/redis.conf

systemctl enable --now redis-server >/dev/null 2>&1 || true
systemctl restart redis-server
sleep 1
if redis-cli ping 2>/dev/null | grep -q PONG; then
  ok "responding on 127.0.0.1:6379, policy=$(redis-cli config get maxmemory-policy | tail -1)"
else
  die "redis is not responding — check: journalctl -u redis-server -n 40"
fi

# ── 6. Firewall ─────────────────────────────────────────────────────────────
step "Firewall"

# Order matters: SSH is allowed before the policy flips to deny, otherwise
# enabling ufw over an SSH session closes the session it is running in.
ufw --force reset >/dev/null
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null   # outbound RTMP 1935 + RTMPS 443
ufw allow 22/tcp           >/dev/null
ufw allow 80,443/tcp       >/dev/null   # reverse proxy and certbot
ufw allow "${RTC_MIN}:${RTC_MAX}/udp" >/dev/null
ufw --force enable >/dev/null
ok "inbound: 22/tcp, 80+443/tcp, ${RTC_MIN}-${RTC_MAX}/udp"
warn "if your host has its own firewall in its control panel (Hetzner Cloud Firewall, OVH, a Contabo security group), it is applied BEFORE this box — the same UDP range must be opened there too, or ufw being open proves nothing"

# ── 7. Service user and layout ──────────────────────────────────────────────
step "Service user"

if id "$SERVICE_USER" &>/dev/null; then
  ok "${SERVICE_USER} exists"
else
  # --system gives no login shell and no password: this account exists to own
  # the process and its files, and should not be reachable over SSH.
  adduser --system --group --home "$APP_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER" >/dev/null
  ok "created ${SERVICE_USER}"
fi

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$APP_ROOT" "$APP_ROOT/app"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$APP_ROOT/recordings"
ok "${APP_ROOT} ready"

systemctl enable unattended-upgrades >/dev/null 2>&1 || true

# ── Report ──────────────────────────────────────────────────────────────────
cat <<REPORT

────────────────────────── PASTE EVERYTHING BELOW ──────────────────────────
host          : $(hostname) — ${PRETTY_NAME}
kernel        : $(uname -r)
cpu / ram     : ${CPUS} vCPU / ${MEM_MB} MB
disk free     : $(df -h / | awk 'NR==2 {print $4" of "$2}')
swap          : $(swapon --show=SIZE --noheadings | tr '\n' ' ' | grep . || echo none)

PUBLIC_IPV4   : ${PUBLIC_IP}
              (this is your MEDIASOUP_ANNOUNCED_IP and your DNS A record)

node          : $(node --version)
npm           : $(npm --version)
ffmpeg        : $(ffmpeg -version | head -1 | awk '{print $3}')
libx264       : $(FE=$(ffmpeg -hide_banner -encoders 2>/dev/null || true); [[ $FE == *libx264* ]] && echo yes || echo MISSING)
nginx         : $(nginx -v 2>&1 | awk -F/ '{print $2}')
redis         : $(redis-cli ping 2>/dev/null || echo DOWN) / policy=$(redis-cli config get maxmemory-policy 2>/dev/null | tail -1)

tcp cc        : $(sysctl -n net.ipv4.tcp_congestion_control)
qdisc         : $(sysctl -n net.core.default_qdisc)
rmem_max      : $(sysctl -n net.core.rmem_max)
conntrack_max : $(sysctl -n net.netfilter.nf_conntrack_max 2>/dev/null || echo "module not loaded")
file-max      : $(sysctl -n fs.file-max)

firewall      :
$(ufw status | sed 's/^/                /')
─────────────────────────── PASTE EVERYTHING ABOVE ──────────────────────────

Stage 1 done. Nothing is deployed yet and nothing is listening on 443.

Next, in this order:
  1. Point an A record for api.omlivestream.com at ${PUBLIC_IP}, Cloudflare
     proxy OFF (grey cloud). Cloudflare proxies TCP only, so it would drop
     the entire UDP media range.
  2. Paste the report block above back into the chat.
  3. Stage 2 covers the clone, npm ci, build, .env, systemd units and TLS.

REPORT
