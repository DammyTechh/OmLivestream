package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"
)

// ── Types ──────────────────────────────────────────────────────────

type PlatformTarget struct {
	Platform  string `json:"platform"`
	RtmpURL   string `json:"rtmpUrl"`
	StreamKey string `json:"streamKey"`
}

type StartRequest struct {
	StreamID  string           `json:"streamId"`
	Platforms []PlatformTarget `json:"platforms"`
}

type StopRequest struct {
	StreamID string `json:"streamId"`
}

type PlatformPush struct {
	cancel chan struct{}
	done   chan struct{}
}

type RelaySession struct {
	streamID string
	pushes   map[string]*PlatformPush
	mu       sync.Mutex
}

// ── State ──────────────────────────────────────────────────────────

var (
	sessions   = make(map[string]*RelaySession)
	sessionsMu sync.Mutex
	secret     = os.Getenv("RTMP_RELAY_SECRET")
	port       = getenv("PORT", "3002")
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── Auth ───────────────────────────────────────────────────────────

func requireSecret(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Relay-Secret") != secret {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func jsonResp(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// ── RTMP push goroutine ────────────────────────────────────────────
//
// Reads from a local RTMP source (mediasoup → ffmpeg pipe) and
// re-transmits to the platform RTMP ingest using ffmpeg copy mode.
// This means ZERO transcoding — pure bit-for-bit forward, so the
// stream quality the browser sends is exactly what viewers see.
//
// Each platform runs in its own goroutine — one failing does not
// affect the others.

func pushRTMP(streamID, platform, srcURL, destURL, key string, cancel, done chan struct{}) {
	defer close(done)

	dest       := destURL + "/" + key
	retryDelay := time.Second
	maxRetries := 10

	for attempt := 1; attempt <= maxRetries; attempt++ {
		select {
		case <-cancel:
			log.Printf("[%s][%s] cancelled", streamID, platform)
			return
		default:
		}

		log.Printf("[%s][%s] attempt %d → %s", streamID, platform, attempt, destURL)

		// ffmpeg copy — no re-encoding, maximum quality, minimum CPU
		cmd := exec.Command("ffmpeg",
			"-re",
			"-i", srcURL,
			"-c:v", "copy",  // video: bitstream copy
			"-c:a", "copy",  // audio: bitstream copy
			"-f", "flv",
			"-flvflags", "no_duration_filesize",
			"-loglevel", "warning",
			"-reconnect", "1",
			"-reconnect_streamed", "1",
			"-reconnect_delay_max", "5",
			dest,
		)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr

		if err := cmd.Start(); err != nil {
			log.Printf("[%s][%s] ffmpeg start error: %v", streamID, platform, err)
		} else {
			finished := make(chan error, 1)
			go func() { finished <- cmd.Wait() }()

			select {
			case <-cancel:
				cmd.Process.Kill()
				log.Printf("[%s][%s] stopped by cancel", streamID, platform)
				return
			case err := <-finished:
				if err != nil {
					log.Printf("[%s][%s] ffmpeg error: %v (retry %d/%d)", streamID, platform, err, attempt, maxRetries)
				} else {
					log.Printf("[%s][%s] ffmpeg finished cleanly", streamID, platform)
					return
				}
			}
		}

		select {
		case <-cancel:
			return
		case <-time.After(retryDelay):
			if retryDelay < 30*time.Second {
				retryDelay *= 2
			}
		}
	}

	log.Printf("[%s][%s] max retries reached", streamID, platform)
}

// ── Handlers ───────────────────────────────────────────────────────

func handleStart(w http.ResponseWriter, r *http.Request) {
	var req StartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonResp(w, 400, map[string]string{"error": "invalid body"})
		return
	}
	if req.StreamID == "" || len(req.Platforms) == 0 {
		jsonResp(w, 400, map[string]string{"error": "streamId and platforms required"})
		return
	}

	sessionsMu.Lock()
	if _, exists := sessions[req.StreamID]; exists {
		sessionsMu.Unlock()
		jsonResp(w, 409, map[string]string{"error": "relay already active for this stream"})
		return
	}
	sess := &RelaySession{streamID: req.StreamID, pushes: make(map[string]*PlatformPush)}
	sessions[req.StreamID] = sess
	sessionsMu.Unlock()

	// Source URL — the mediasoup ffmpeg pipeline outputs here
	// Format: rtmp://127.0.0.1:1935/live/{streamId}
	srcURL := fmt.Sprintf("rtmp://127.0.0.1:1935/live/%s", req.StreamID)

	for _, target := range req.Platforms {
		cancel := make(chan struct{})
		done   := make(chan struct{})
		push   := &PlatformPush{cancel: cancel, done: done}

		sess.mu.Lock()
		sess.pushes[target.Platform] = push
		sess.mu.Unlock()

		t := target // capture loop variable
		go pushRTMP(req.StreamID, t.Platform, srcURL, t.RtmpURL, t.StreamKey, cancel, done)
	}

	log.Printf("[%s] relay started — %d platforms", req.StreamID, len(req.Platforms))
	jsonResp(w, 200, map[string]any{"success": true, "streamId": req.StreamID, "platforms": len(req.Platforms)})
}

func handleStop(w http.ResponseWriter, r *http.Request) {
	var req StopRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonResp(w, 400, map[string]string{"error": "invalid body"})
		return
	}

	sessionsMu.Lock()
	sess, exists := sessions[req.StreamID]
	if exists {
		delete(sessions, req.StreamID)
	}
	sessionsMu.Unlock()

	if !exists {
		jsonResp(w, 200, map[string]any{"success": true, "message": "no active relay for stream"})
		return
	}

	sess.mu.Lock()
	for platform, push := range sess.pushes {
		close(push.cancel)
		log.Printf("[%s][%s] stop signal sent", req.StreamID, platform)
	}
	sess.mu.Unlock()

	// Wait for all goroutines to finish (max 5s)
	done := make(chan struct{})
	go func() {
		sess.mu.Lock()
		pushes := make([]*PlatformPush, 0, len(sess.pushes))
		for _, p := range sess.pushes {
			pushes = append(pushes, p)
		}
		sess.mu.Unlock()
		for _, p := range pushes {
			<-p.done
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		log.Printf("[%s] stop timeout — forcing close", req.StreamID)
	}

	log.Printf("[%s] relay stopped", req.StreamID)
	jsonResp(w, 200, map[string]any{"success": true, "streamId": req.StreamID})
}

func handleStatus(w http.ResponseWriter, _ *http.Request) {
	sessionsMu.Lock()
	ids := make([]string, 0, len(sessions))
	for id := range sessions {
		ids = append(ids, id)
	}
	sessionsMu.Unlock()
	jsonResp(w, 200, map[string]any{"activeSessions": len(ids), "streams": ids})
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	jsonResp(w, 200, map[string]string{"status": "ok", "service": "omlivestreambackend-rtmp-relay"})
}

// ── Main ───────────────────────────────────────────────────────────

func main() {
	if secret == "" {
		log.Fatal("RTMP_RELAY_SECRET environment variable is required")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health",        handleHealth)
	mux.HandleFunc("/relay/start",   requireSecret(handleStart))
	mux.HandleFunc("/relay/stop",    requireSecret(handleStop))
	mux.HandleFunc("/relay/status",  requireSecret(handleStatus))

	addr := ":" + port
	log.Printf("🚀 OmliveStream RTMP Relay listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
