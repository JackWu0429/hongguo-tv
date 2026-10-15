package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmbeddedUIUpdateAndCompatibilityAssets(t *testing.T) {
	root, err := fs.Sub(uiFiles, "ui")
	if err != nil {
		t.Fatal(err)
	}
	handler := serveUI(root)
	for _, path := range []string{"/", "/app.js", "/app.css", "/pagination.js", "/compat.js", "/compat.css", "/playback-diagnostics.js", "/playback-recovery.js"} {
		t.Run(path, func(t *testing.T) {
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
			if res.Code != 200 || res.Body.Len() == 0 || res.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("UI update response: status=%d cache=%q bytes=%d", res.Code, res.Header().Get("Cache-Control"), res.Body.Len())
			}
		})
	}
}

func TestHealth(t *testing.T) {
	s := &server{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	res := httptest.NewRecorder()
	s.health(res, req)
	if res.Code != http.StatusOK || res.Body.String() != "{\"ok\":true}\n" {
		t.Fatalf("unexpected health response: %d %q", res.Code, res.Body.String())
	}
}

func TestHealthRejectsWrite(t *testing.T) {
	s := &server{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/health", nil)
	res := httptest.NewRecorder()
	s.health(res, req)
	if res.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", res.Code)
	}
}
