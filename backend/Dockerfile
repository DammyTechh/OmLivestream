# ── Stage 1: build ────────────────────────────────────────────────
# IMPORTANT: Debian (glibc), NOT Alpine (musl).
# mediasoup's postinstall downloads a prebuilt C++ worker binary that is
# linked against glibc. On Alpine it downloads, fails its own validation
# run, deletes itself, and falls back to compiling libwebrtc from source —
# which needs >8GB RAM and OOMs the Render build machine.
FROM node:20-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./

# Prebuilt worker is fetched here — no compiler toolchain needed.
RUN npm ci

COPY src ./src
RUN npm run build

# ── Stage 2: production image ─────────────────────────────────────
FROM node:20-bookworm-slim AS production

# ffmpeg is required at runtime for recording processing and AI edits.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Temp dir for video processing
RUN mkdir -p /tmp/omlivestreambackend

# Non-root user for security
RUN groupadd --system app \
 && useradd --system --gid app app \
 && chown -R app:app /app /tmp/omlivestreambackend
USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/server.js"]
