package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testRadarRanks = `{"hot":{"rank_date":"2026-10-16","prev_rank_date":"2026-10-15","items":[{"id":"101","rank":1,"title":"综合短剧","delta":2}]},"real":{"rank_date":"2026-10-16","items":[{"id":"102","rank":1,"title":"真人短剧"}]},"ai":{"rank_date":"2026-10-16","items":[{"id":"103","rank":1,"title":"AI短剧"}]},"comic":{"rank_date":"2026-10-16","items":[{"id":"104","rank":1,"title":"漫剧"}]}}`
const testRadarGrowth = `{"date":"2026-10-16","prev_date":"2026-10-15","gap":1,"items":[{"id":"105","title":"飙升短剧","type":"real","watch":true,"d_hot":500,"d_fav":12,"d_like":34,"r_hot":0.12},{"id":"106","title":"次高短剧","type":"ai","watch":false,"d_hot":250}]}`

func TestRadarSnapshotUsesRawFallbackAndOmitsWatchlistMarker(t *testing.T) {
	raw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ranks_latest.json" {
			w.Write([]byte(testRadarRanks))
			return
		}
		if r.URL.Path == "/growth_latest.json" {
			w.Write([]byte(testRadarGrowth))
			return
		}
		http.NotFound(w, r)
	}))
	defer raw.Close()
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "proxy unavailable", http.StatusBadGateway)
	}))
	defer primary.Close()

	service := newRadarService(t.TempDir(), &http.Client{Timeout: time.Second})
	service.primaryBase = primary.URL
	service.rawBase = raw.URL
	got, err := service.snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot failed: %v", err)
	}
	if got.Ranks == nil || got.Growth == nil || got.RanksStale || got.GrowthStale {
		t.Fatalf("expected fresh rank and growth data, got %#v", got)
	}
	if got.Ranks.Hot.Items[0].Title != "综合短剧" || len(got.Growth.Items) != 2 || got.Growth.Items[0].DHot != 500 {
		t.Fatalf("unexpected normalized snapshot: %#v", got)
	}
	body, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), `"watch"`) || strings.Contains(string(body), "watchlist") {
		t.Fatalf("response must omit observation-list data: %s", body)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(service.path), "radar-cache.json")); err != nil {
		t.Fatalf("fresh snapshot was not persisted: %v", err)
	}
}

func TestRadarSnapshotFallsBackToPersistedData(t *testing.T) {
	dir := t.TempDir()
	ranks, err := decodeRadarRanks([]byte(testRadarRanks))
	if err != nil {
		t.Fatal(err)
	}
	growth, err := decodeRadarGrowth([]byte(testRadarGrowth))
	if err != nil {
		t.Fatal(err)
	}
	fetched := time.Date(2026, 10, 15, 10, 30, 0, 0, time.UTC)
	cache := radarPersistedCache{Ranks: &ranks, RanksFetched: fetched, Growth: &growth, GrowthFetched: fetched}
	if err := atomicPrivateJSON(filepath.Join(dir, "radar-cache.json"), cache); err != nil {
		t.Fatal(err)
	}
	unavailable := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "offline", http.StatusServiceUnavailable) }))
	defer unavailable.Close()
	service := newRadarService(dir, &http.Client{Timeout: time.Second})
	service.primaryBase = unavailable.URL
	service.rawBase = unavailable.URL

	got, err := service.snapshot(context.Background())
	if err != nil {
		t.Fatalf("cached snapshot should survive source outage: %v", err)
	}
	if !got.RanksStale || !got.GrowthStale || got.Ranks == nil || got.Growth == nil {
		t.Fatalf("expected stale cached data, got %#v", got)
	}
	if got.RanksFetched != fetched.Format(time.RFC3339) || got.GrowthFetched != fetched.Format(time.RFC3339) {
		t.Fatalf("cached timestamps were not preserved: %#v", got)
	}
}

func TestRadarRejectsIncompleteRanks(t *testing.T) {
	if _, err := decodeRadarRanks([]byte(`{"hot":{"items":[{"id":"1","title":"有效"}]}}`)); err == nil {
		t.Fatal("expected incomplete rank file to be rejected")
	}
}
