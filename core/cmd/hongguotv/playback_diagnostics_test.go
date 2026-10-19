package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func isolateMediaDiagnostics(t *testing.T) {
	t.Helper()
	mediaDiagnostics.Lock()
	previous := mediaDiagnostics.items
	mediaDiagnostics.items = make(map[string]mediaDiagnosticRecord)
	mediaDiagnostics.Unlock()
	t.Cleanup(func() { mediaDiagnostics.Lock(); mediaDiagnostics.items = previous; mediaDiagnostics.Unlock() })
}

func TestMediaDiagnosticLedgerIsBoundedAndIsolatedBySource(t *testing.T) {
	isolateMediaDiagnostics(t)
	for i := 0; i < 40; i++ {
		recordMediaDiagnostic(fmt.Sprintf("%024x", i), 206)
	}
	mediaDiagnostics.Lock()
	if len(mediaDiagnostics.items) != 24 {
		t.Fatalf("unbounded ledger: %d", len(mediaDiagnostics.items))
	}
	mediaDiagnostics.items["ffffffffffffffffffffffff"] = mediaDiagnosticRecord{Status: 404, At: time.Now().Add(-31 * time.Minute)}
	mediaDiagnostics.Unlock()
	recordMediaDiagnostic("aaaaaaaaaaaaaaaaaaaaaaaa", 200)
	recordMediaDiagnostic("invalid", 500)
	mediaDiagnostics.Lock()
	_, expired := mediaDiagnostics.items["ffffffffffffffffffffffff"]
	count := len(mediaDiagnostics.items)
	mediaDiagnostics.Unlock()
	if expired || count != 24 {
		t.Fatalf("expired/bounded state: %v/%d", expired, count)
	}
	s := &server{}
	r := httptest.NewRequest("GET", "/api/v1/player/diagnostics?media=/minireel-proxy/media/aaaaaaaaaaaaaaaaaaaaaaaa.mp4", nil)
	w := httptest.NewRecorder()
	s.playbackDiagnostics(w, r)
	var payload struct {
		Data playbackDiagnosticResponse `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &payload)
	if payload.Data.MediaHTTPStatus != 200 {
		t.Fatal(w.Body.String())
	}
	r = httptest.NewRequest("GET", "/api/v1/player/diagnostics?media=/minireel-proxy/media/bbbbbbbbbbbbbbbbbbbbbbbb.mp4", nil)
	w = httptest.NewRecorder()
	s.playbackDiagnostics(w, r)
	json.Unmarshal(w.Body.Bytes(), &payload)
	if payload.Data.MediaHTTPStatus != 0 {
		t.Fatal("another source's HTTP status leaked")
	}
}

func TestMediaDiagnosticWriterPreservesRangeResponses(t *testing.T) {
	isolateMediaDiagnostics(t)
	for _, tt := range []struct {
		method, byteRange string
		status            int
		body              string
	}{
		{"GET", "", 200, "0123456789"}, {"GET", "bytes=2-5", 206, "2345"}, {"HEAD", "bytes=2-5", 206, ""}, {"GET", "bytes=90-100", 416, ""},
	} {
		r := httptest.NewRequest(tt.method, "/media", nil)
		if tt.byteRange != "" {
			r.Header.Set("Range", tt.byteRange)
		}
		w := httptest.NewRecorder()
		recorder := &diagnosticMediaWriter{ResponseWriter: w, token: "cccccccccccccccccccccccc"}
		http.ServeContent(recorder, r, "video.mp4", time.Time{}, strings.NewReader("0123456789"))
		if w.Code != tt.status || tt.status != 416 && w.Body.String() != tt.body {
			t.Fatalf("Range changed: %s %s %d %q", tt.method, tt.byteRange, w.Code, w.Body.String())
		}
		mediaDiagnostics.Lock()
		record := mediaDiagnostics.items[recorder.token]
		mediaDiagnostics.Unlock()
		if record.Status != tt.status {
			t.Fatalf("recorded %d rather than %d", record.Status, tt.status)
		}
	}
}

func TestPlaybackDiagnosticsPrivateReadOnlyAndRedacted(t *testing.T) {
	s := &server{}
	for _, path := range []string{"https://signed.invalid/file?token=secret", "/etc/passwd", "/minireel-proxy/media/../../private.mp4"} {
		r := httptest.NewRequest("GET", "/api/v1/player/diagnostics", nil)
		q := r.URL.Query()
		q.Set("media", path)
		r.URL.RawQuery = q.Encode()
		w := httptest.NewRecorder()
		s.playbackDiagnostics(w, r)
		if w.Code != 400 || strings.Contains(w.Body.String(), path) {
			t.Fatalf("invalid source reflected: %d %s", w.Code, w.Body.String())
		}
	}
	for _, tt := range []struct {
		method, origin string
		expected       int
	}{{"GET", "", 200}, {"POST", "", 405}, {"GET", "https://untrusted.invalid", 403}} {
		r := httptest.NewRequest(tt.method, "http://127.0.0.1:8797/api/v1/player/diagnostics", nil)
		r.RemoteAddr = "127.0.0.1:10000"
		r.Header.Set("Origin", tt.origin)
		w := httptest.NewRecorder()
		s.withCORS(http.HandlerFunc(s.playbackDiagnostics)).ServeHTTP(w, r)
		if w.Code != tt.expected {
			t.Fatalf("private/read-only check: %d %s", w.Code, w.Body.String())
		}
		if tt.expected != 403 && w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("missing no-store: %v", w.Header())
		}
		for _, value := range []string{"instance_id", "token", "account", "cookie", "path", "series_id", "vid"} {
			if tt.expected == 200 && strings.Contains(w.Body.String(), `"`+value+`"`) {
				t.Fatalf("sensitive field %s", value)
			}
		}
	}
}

func TestPlaybackDiagnosticsExposeMediaPreparationDurations(t *testing.T) {
	token := "aaaaaaaaaaaaaaaaaaaaaaaa"
	ready := make(chan struct{})
	close(ready)
	root := t.TempDir()
	path := root + "/media.mp4"
	if err := os.WriteFile(path, []byte("prepared"), 0600); err != nil {
		t.Fatal(err)
	}
	miniReelState.Lock()
	previous := miniReelState.jobs
	miniReelState.jobs = map[string]*miniReelMediaJob{
		token:                      {Ready: ready, Path: path, Mode: "full", ResolveMS: 21, DownloadMS: 34, DecryptMS: 8},
		"bbbbbbbbbbbbbbbbbbbbbbbb": {Ready: ready, Mode: "range", Range: &miniReelRangeSource{Prefix: []byte("moov")}, ResolveMS: 13, RangeInitMS: 27},
	}
	miniReelState.Unlock()
	t.Cleanup(func() { miniReelState.Lock(); miniReelState.jobs = previous; miniReelState.Unlock() })

	r := httptest.NewRequest("GET", "/api/v1/player/diagnostics?media=/minireel-proxy/media/"+token+".mp4", nil)
	w := httptest.NewRecorder()
	(&server{}).playbackDiagnostics(w, r)
	var payload struct {
		Data playbackDiagnosticResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data.MediaResolveMS != 21 || payload.Data.MediaDownloadMS != 34 || payload.Data.MediaDecryptMS != 8 {
		t.Fatalf("missing media timing: %+v", payload.Data)
	}
	r = httptest.NewRequest("GET", "/api/v1/player/diagnostics?media=/minireel-proxy/media/bbbbbbbbbbbbbbbbbbbbbbbb.mp4", nil)
	w = httptest.NewRecorder()
	(&server{}).playbackDiagnostics(w, r)
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Data.MediaPrepared || payload.Data.MediaMode != "range" || payload.Data.MediaBytes != 4 || payload.Data.MediaResolveMS != 13 || payload.Data.MediaRangeInitMS != 27 {
		t.Fatalf("missing Range preparation timing: %+v", payload.Data)
	}
	for _, sensitive := range []string{"series_id", "vid", "path", "token", "account"} {
		if strings.Contains(w.Body.String(), `"`+sensitive+`"`) {
			t.Fatalf("diagnostics exposed %s", sensitive)
		}
	}
}
