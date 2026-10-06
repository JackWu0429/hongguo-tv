package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestOfficialNextSeasonAndLastSeason(t *testing.T) {
	const first = "7621200213801176126"
	const second = "7628202881140657177"
	const last = "7690163276214176792"
	fixtures := map[string]string{first: "1", second: "2", last: "13"}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if r.Method != "GET" || r.URL.Path != "/reading/bookapi/plan/v" || q.Get("scene") != "10" || q.Get("from") != "series_short_play_info" || q.Get("filter_ids") != q.Get("book_id") || q.Get("limit") != "0" {
			t.Errorf("incorrect official relation request: %s", r.URL)
		}
		stamp, _ := strconv.ParseInt(q.Get("_rticket"), 10, 64)
		for name, value := range miniReelSignRequest(r.URL.RawQuery, "", stamp) {
			if r.Header.Get(name) != value {
				t.Errorf("signature %s differs", name)
			}
		}
		if !validID(q.Get("device_id")) || !validID(q.Get("iid")) {
			t.Errorf("missing device identity")
		}
		fixture, err := os.ReadFile("testdata/seasons-" + fixtures[q.Get("book_id")] + ".json")
		if err != nil {
			t.Errorf("unknown relation request: %s", q.Get("book_id"))
			w.WriteHeader(500)
			return
		}
		_, _ = w.Write(fixture)
	}))
	defer upstream.Close()
	client := newHongguoClient()
	client.apiBase = upstream.URL
	result, err := client.NextSeason(context.Background(), first)
	if err != nil || result.CurrentSeason != 1 || result.Next == nil || result.Next.SeriesID != second || result.Next.Vid != "7628204794481495065" || result.Next.SeasonIndex != 2 {
		t.Fatalf("first -> second: %#v, %v", result, err)
	}
	result, err = client.NextSeason(context.Background(), second)
	if err != nil || result.CurrentSeason != 2 || result.Next == nil || result.Next.SeasonIndex != 3 {
		t.Fatalf("second -> third: %#v, %v", result, err)
	}
	result, err = client.NextSeason(context.Background(), last)
	if err != nil || result.CurrentSeason != 13 || result.Next != nil {
		t.Fatalf("season 14 without episodes must not start: %#v, %v", result, err)
	}
}

func TestNextSeasonFiltersAndRequiresConfirmedCurrentSeason(t *testing.T) {
	const current = "7000000000000000009"
	const sibling = "7000000000000000001"
	for _, confirmed := range []bool{false, true} {
		t.Run(strconv.FormatBool(confirmed), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				rows := []map[string]any{}
				if r.URL.Query().Get("book_id") == current {
					rows = []map[string]any{
						{"series_id": sibling, "season_index": 1, "episode_cnt": 10, "vid": "100"},
						{"series_id": "7000000000000000010", "season_index": 10, "episode_cnt": 10, "vid": "101", "disable_play": true},
						{"series_id": "7000000000000000011", "season_index": 11, "episode_cnt": 0, "vid": "102"},
						{"series_id": "7000000000000000012", "season_index": 12, "episode_cnt": 10, "vid": ""},
						{"series_id": "7000000000000000014", "season_index": 14, "episode_cnt": 10, "vid": "104"},
						{"series_id": "7000000000000000013", "season_index": 13, "episode_cnt": 10, "vid": "103"},
					}
				} else if confirmed {
					rows = []map[string]any{{"series_id": current, "season_index": 9, "episode_cnt": 10, "vid": "109"}}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": []any{map[string]any{"video_data": rows}}})
			}))
			defer upstream.Close()
			client := newHongguoClient()
			client.apiBase = upstream.URL
			result, err := client.NextSeason(context.Background(), current)
			if !confirmed {
				if err == nil || result.Next != nil {
					t.Fatalf("unknown season must not jump: %#v %v", result, err)
				}
			} else if err != nil || result.CurrentSeason != 9 || result.Next == nil || result.Next.SeasonIndex != 13 {
				t.Fatalf("must skip older/disabled/unreleased seasons and choose nearest: %#v %v", result, err)
			}
		})
	}
}

func TestNextSeasonRejectsBadResponseAndRetries(t *testing.T) {
	for _, body := range []string{"", "{}", `{"code":0}`, `{"code":1,"data":[]}`, `{"code":0,"data":{}}`, `{"code":0,"data":[{"video_data":{}}]}`, `{"code":0,"data":[{"video_data":[{"series_id":"1","season_index":1},{"series_id":"1","season_index":2}]}]}`} {
		t.Run(body, func(t *testing.T) {
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) == 1 {
					_, _ = w.Write([]byte(body))
				} else {
					_, _ = w.Write([]byte(`{"code":0,"data":[]}`))
				}
			}))
			defer upstream.Close()
			client := newHongguoClient()
			client.apiBase = upstream.URL
			if _, err := client.NextSeason(context.Background(), "123"); err == nil {
				t.Fatal("bad response accepted as season end")
			}
			if result, err := client.NextSeason(context.Background(), "123"); err != nil || result.Next != nil || calls.Load() != 2 {
				t.Fatalf("failed result must not poison retry: %#v %v", result, err)
			}
		})
	}
}

func TestNextSeasonCancellationAndHTTPValidation(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer upstream.Close()
	client := newHongguoClient()
	client.apiBase = upstream.URL
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := client.NextSeason(ctx, "123"); err == nil {
		t.Fatal("cancellation ignored")
	}
	s := &server{hongguo: client}
	for _, test := range []struct {
		method, id string
		status     int
	}{{"POST", "123", 405}, {"GET", "bad", 400}} {
		w := httptest.NewRecorder()
		s.nextSeason(w, httptest.NewRequest(test.method, "/api/v1/series/next-season?series_id="+test.id, nil))
		if w.Code != test.status || !strings.Contains(w.Body.String(), `"ok":false`) {
			t.Fatalf("validation %d: %s", w.Code, w.Body.String())
		}
	}
}

func TestSeriesDetailRejectsDifferentSeries(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<script>window._ROUTER_DATA={"seriesDetail":{"series_id":"456","title":"另一部短剧","vid_list":["999"]}};</script>`))
	}))
	defer upstream.Close()
	client := newHongguoClient()
	client.webBase = upstream.URL
	if detail, err := client.SeriesDetail(context.Background(), "123"); err == nil || detail.SeriesID != "" {
		t.Fatalf("must not play another series' episodes: %#v %v", detail, err)
	}
}
