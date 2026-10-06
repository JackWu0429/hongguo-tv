package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

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
