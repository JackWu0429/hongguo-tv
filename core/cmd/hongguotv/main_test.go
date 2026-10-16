package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEmbeddedUIUpdateAndCompatibilityAssets(t *testing.T) {
	root, err := fs.Sub(uiFiles, "ui")
	if err != nil {
		t.Fatal(err)
	}
	handler := serveUI(root)
	for _, path := range []string{"/", "/app.js", "/app.css", "/pagination.js", "/compat.js", "/compat.css", "/playback-diagnostics.js", "/playback-recovery.js", "/phone-countries.js"} {
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

func TestActorWorksEndpointValidatesAndReturnsOfficialWorks(t *testing.T) {
	page := `<!doctype html><script>window._ROUTER_DATA = {"loaderData":{"character_(id)/page":{"userInfo":{"actor_id":"7377326001203713305","user_name":"测试演员"},"videoList":[{"series_id":"1234567890123456789","series_title":"演员作品","episode_cnt":12,"vid_list":["1111111111111111111"]}]}}};</script>`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/character/7377326001203713305" {
			t.Errorf("unexpected upstream path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(page))
	}))
	defer upstream.Close()
	client := newHongguoClient()
	client.webBase = upstream.URL
	s := &server{hongguo: client}
	response := httptest.NewRecorder()
	s.actorWorks(response, httptest.NewRequest(http.MethodGet, "/api/v1/actors/works?actor_id=7377326001203713305", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "演员作品") {
		t.Fatalf("unexpected actor works response: status=%d body=%s", response.Code, response.Body.String())
	}

	invalid := httptest.NewRecorder()
	s.actorWorks(invalid, httptest.NewRequest(http.MethodGet, "/api/v1/actors/works?actor_id=bad", nil))
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid actor_id status = %d", invalid.Code)
	}

	method := httptest.NewRecorder()
	s.actorWorks(method, httptest.NewRequest(http.MethodPost, "/api/v1/actors/works?actor_id=7377326001203713305", nil))
	if method.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d", method.Code)
	}
}
