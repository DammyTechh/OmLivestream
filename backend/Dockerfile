# ── Stage 1: build ────────────────────────────────────────────────
# IMPORTANT: Debian (glibc), NOT Alpine (musl).
# mediasoup's postinstall downloads a prebuilt C++ worker binary that is
# linked against glibc. On Alpine it downloads, fails its own validation
# run, deletes itself, and falls back to compiling libwebrtc from source —
# which needs >8GB RAM and OOMs the Render build machine.
FROM node:20-bookworm-slim AS builder

ARG MEDIASOUP_VERSION=3.19.19
# Where we stage the worker binary. Must match the production stage.
ARG WORKER_BIN=/opt/mediasoup/mediasoup-worker

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# ── Fetch the prebuilt mediasoup worker ourselves ─────────────────
# mediasoup's own postinstall builds the asset name from the BUILD MACHINE's
# kernel major version (`-kernel${os.release()}`). Render's build host reports
# a kernel with no published asset, so its fetch 404s and it silently falls
# back to compiling libwebrtc from source — >8GB RAM, OOMs the build.
# We ask for known-published kernel variants explicitly and fail loudly if
# none match, instead of ever entering the compile path.
RUN set -eux; \
    base="https://github.com/versatica/mediasoup/releases/download/${MEDIASOUP_VERSION}"; \
    mkdir -p /opt/mediasoup; \
    for k in 6 5 4; do \
      name="mediasoup-worker-${MEDIASOUP_VERSION}-linux-x64-kernel${k}.tgz"; \
      echo "trying ${name}"; \
      if curl -fsSL "${base}/${name}" -o /tmp/w.tgz; then \
        tar -xzf /tmp/w.tgz -C /opt/mediasoup; \
        rm /tmp/w.tgz; \
        break; \
      fi; \
    done; \
    chmod 0775 "${WORKER_BIN}"; \
    test -x "${WORKER_BIN}"

# Setting this makes mediasoup's postinstall exit immediately — no Python,
# no prebuilt fetch, no source compile. It is also read at runtime.
ENV MEDIASOUP_WORKER_BIN=${WORKER_BIN}

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# ── Stage 2: production image ─────────────────────────────────────
FROM node:20-bookworm-slim AS production

ARG WORKER_BIN=/opt/mediasoup/mediasoup-worker

# ffmpeg is required at runtime for recording processing and AI edits.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
# This stage still needs mediasoup in node_modules for runtime, so we
# install with --omit=dev, then copy the worker we built earlier.
ENV MEDIASOUP_WORKER_BIN=${WORKER_BIN}
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder ${WORKER_BIN} ${WORKER_BIN}

# Temp dir for video processing
RUN mkdir -p /tmp/omlivestreambackend

# Non-root user for security
RUN groupadd --system app \
 && useradd --system --gid app app \
 && chown -R app:app /app /tmp/omlivestreambackend /opt/mediasoup
USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/server.js"]
