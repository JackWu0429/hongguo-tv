package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
)

func TestMiniReelNativeOptionsUsesFreshDeviceForEmptyResponses(t *testing.T) {
	var mu sync.Mutex
	var requests int
	ids := make([]string, 0, miniReelVideoModelAttempts)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, key := range []string{"X-Khronos", "X-SS-Req-Ticket", "X-Helios", "X-Medusa", "X-Gorgon", "X-SS-STUB"} {
			if r.Header.Get(key) == "" {
				t.Errorf("missing signed request header %s", key)
			}
		}
		if got, want := r.Header.Get("X-SS-Req-Ticket"), r.URL.Query().Get("_rticket"); got != want {
			t.Errorf("request ticket = %q, query ticket = %q", got, want)
		}

		mu.Lock()
		requests++
		requestNumber := requests
		ids = append(ids, r.URL.Query().Get("device_id"), r.URL.Query().Get("iid"))
		mu.Unlock()
		if requestNumber < 3 {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":{"video_model":{"video_list":[{"video_meta":{"codec_type":"h264","vheight":720,"definition":"720p"},"main_url":"https://media.example/video.mp4","encrypt_info":{}}],"video_duration":1}}}`)
	}))
	defer server.Close()

	options, err := miniReelNativeOptionsEndpoint(context.Background(), "123", server.URL)
	if err != nil {
		t.Fatalf("miniReelNativeOptionsEndpoint() error = %v", err)
	}
	if len(options) != 1 || options[0].Quality != "720P" {
		t.Fatalf("options = %#v, want one 720P option", options)
	}
	mu.Lock()
	defer mu.Unlock()
	if requests != 3 {
		t.Fatalf("requests = %d, want 3", requests)
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if len(id) != 16 {
			t.Fatalf("device identity %q has length %d, want 16", id, len(id))
		}
		if _, err := strconv.ParseUint(id, 10, 64); err != nil {
			t.Fatalf("device identity %q is not decimal: %v", id, err)
		}
		if seen[id] {
			t.Fatalf("device identity %q was reused", id)
		}
		seen[id] = true
	}
}

func TestMiniReelNativeOptionsDoesNotRetryNonEmptyInvalidResponse(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	defer server.Close()

	_, err := miniReelNativeOptionsEndpoint(context.Background(), "123", server.URL)
	if err == nil || requests != 1 {
		t.Fatalf("error = %v, requests = %d; want one request and a direct parse error", err, requests)
	}
	if errors.Is(err, errMiniReelVideoModelEmpty) {
		t.Fatalf("non-empty invalid JSON was classified as an empty response: %v", err)
	}
}

func TestMiniReelNativeOptionsStopsAfterEmptyResponseLimit(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
	}))
	defer server.Close()

	_, err := miniReelNativeOptionsEndpoint(context.Background(), "123", server.URL)
	if err == nil || requests != miniReelVideoModelAttempts {
		t.Fatalf("error = %v, requests = %d; want %d empty-response attempts", err, requests, miniReelVideoModelAttempts)
	}
	if !errors.Is(err, errMiniReelVideoModelEmpty) {
		t.Fatalf("error = %v, want empty-response cause", err)
	}
}
