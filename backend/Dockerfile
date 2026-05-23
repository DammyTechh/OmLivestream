# ── Stage 1: build ────────────────────────────────────────────────
FROM node:20-alpine AS builder

# mediasoup build dependencies
RUN apk add --no-cache python3 make g++ pkgconfig libsrtp-dev openssl-dev linux-headers

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --frozen-lockfile

COPY src ./src
RUN npm run build

# ── Stage 2: production image ─────────────────────────────────────
FROM node:20-alpine AS production

# Runtime deps: mediasoup native + ffmpeg
RUN apk add --no-cache python3 make g++ pkgconfig libsrtp-dev openssl-dev linux-headers ffmpeg

WORKDIR /app

COPY package.json ./
RUN npm install --frozen-lockfile --omit=dev

COPY --from=builder /app/dist ./dist

# Temp dir for video processing
RUN mkdir -p /tmp/omlivestreambackend

# Non-root user for security
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app /tmp/omlivestreambackend
USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/server.js"]
