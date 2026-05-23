# ── Stage 1: build ────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY main.go ./
RUN go build -o rtmp-relay -ldflags="-w -s" .

# ── Stage 2: minimal runtime ──────────────────────────────────────
FROM alpine:3.19
RUN apk add --no-cache ffmpeg ca-certificates
RUN addgroup -S relay && adduser -S relay -G relay
USER relay
WORKDIR /app
COPY --from=builder /app/rtmp-relay .
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1
CMD ["./rtmp-relay"]
