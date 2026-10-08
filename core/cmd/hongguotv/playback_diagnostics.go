package main

import (
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Small in-memory status ledger; no URLs, titles, account data or error bodies.
type mediaDiagnosticRecord struct {
	Status int
	At     time.Time
}

var mediaDiagnostics = struct {
	sync.Mutex
	items map[string]mediaDiagnosticRecord
}{items: make(map[string]mediaDiagnosticRecord)}

func recordMediaDiagnostic(token string, status int) {
	if !miniReelCacheTokenRE.MatchString(token) {
		return
	}
	mediaDiagnostics.Lock()
	defer mediaDiagnostics.Unlock()
	now := time.Now()
	for key, item := range mediaDiagnostics.items {
		if now.Sub(item.At) > 30*time.Minute {
			delete(mediaDiagnostics.items, key)
		}
	}
	if _, exists := mediaDiagnostics.items[token]; !exists && len(mediaDiagnostics.items) >= 24 {
		var oldest string
		var when time.Time
		for key, item := range mediaDiagnostics.items {
			if oldest == "" || item.At.Before(when) {
				oldest, when = key, item.At
			}
		}
		delete(mediaDiagnostics.items, oldest)
	}
	mediaDiagnostics.items[token] = mediaDiagnosticRecord{Status: status, At: now}
}

type diagnosticMediaWriter struct {
	http.ResponseWriter
	token string
	wrote bool
}

func (w *diagnosticMediaWriter) WriteHeader(status int) {
	if !w.wrote {
		w.wrote = true
		recordMediaDiagnostic(w.token, status)
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *diagnosticMediaWriter) Write(p []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(p)
}
func (w *diagnosticMediaWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

type playbackDiagnosticResponse struct {
	Version         string `json:"version"`
	OS              string `json:"os"`
	Arch            string `json:"arch"`
	MediaPrepared   bool   `json:"media_prepared"`
	MediaBytes      int64  `json:"media_bytes"`
	MediaHTTPStatus int    `json:"media_http_status"`
	MediaAgeSeconds int    `json:"media_age_seconds"`
}

func (s *server) playbackDiagnostics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	result := playbackDiagnosticResponse{Version: version, OS: runtime.GOOS, Arch: runtime.GOARCH}
	path := r.URL.Query().Get("media")
	if path != "" {
		const prefix = "/minireel-proxy/media/"
		name := strings.TrimPrefix(path, prefix)
		if !strings.HasPrefix(path, prefix) || !miniReelCacheFileRE.MatchString(name) {
			writeError(w, http.StatusBadRequest, "invalid local media path")
			return
		}
		token := strings.TrimSuffix(name, ".mp4")
		miniReelState.Lock()
		job := miniReelState.jobs[token]
		var file string
		if job != nil && isMiniReelReady(job.Ready) && job.Err == nil {
			file = job.Path
		}
		miniReelState.Unlock()
		if file != "" {
			if stat, err := os.Stat(file); err == nil && stat.Mode().IsRegular() {
				result.MediaPrepared = true
				result.MediaBytes = stat.Size()
			}
		}
		mediaDiagnostics.Lock()
		item, ok := mediaDiagnostics.items[token]
		mediaDiagnostics.Unlock()
		if ok && time.Since(item.At) <= 30*time.Minute {
			result.MediaHTTPStatus = item.Status
			result.MediaAgeSeconds = int(time.Since(item.At).Seconds())
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": result})
}
