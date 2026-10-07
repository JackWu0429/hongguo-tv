package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSeriesSeasonsContractIncludesUpcomingAndExactIDs(t *testing.T) {
	c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if r.Method != "GET" || r.URL.Path != "/reading/bookapi/plan/v" || q.Get("from") != "single_col_same_ip_series" || q.Get("book_id") != "7690163276214176792" || q.Get("filter_ids") != q.Get("book_id") || q.Get("limit") != "0" {
			t.Fatal("wrong same-IP contract", r.URL)
		}
		ioJSON(w, `{"code":0,"data":[{"video_data":[{"series_id":7690163276214176792,"vid":"7690223053078268953","episode_cnt":209,"title":"万妖图录传第十三季","secondary_info_list":[{"content":"第13季"}],"sub_title_list":[{"content":"435万热度"}]},{"series_id":"7691518344146455576","title":"万妖图录传第十四季","vid":"7691520694017854526","episode_cnt":1,"subscribe_item":{"item_id":7691518344146455577,"is_subscribed":true},"secondary_info_list":[{"content":"第14季"}],"sub_title_list":[{"content":"预告"},{"content":"即将上线"}]},{"series_id":"123","title":"禁播季","vid":"789","episode_cnt":10,"disable_play":true},{"series_id":"456","title":"未就绪","episode_cnt":0},{"series_id":"7690163276214176792","title":"重复"}]}]}`)
	})
	defer close()
	out, err := c.SeriesSeasons(context.Background(), "7690163276214176792")
	if err != nil || len(out.Items) != 4 {
		t.Fatal(out, err)
	}
	if !out.Items[0].Playable || out.Items[0].SeasonIndex != 13 || out.Items[0].SeriesID != "7690163276214176792" {
		t.Fatal("lost ID, official label or playable state", out.Items[0])
	}
	upcoming := out.Items[1]
	if !upcoming.Upcoming || upcoming.Playable || upcoming.Vid != "" || !upcoming.Reserved || upcoming.ReservationID != "7691518344146455577" {
		t.Fatal("trailer must remain reservable, never playable", upcoming)
	}
	if out.Items[2].Playable || out.Items[2].Upcoming || out.Items[3].ReservationID != "" {
		t.Fatal("unavailable rows must not invent reservation IDs")
	}
}

func TestSeriesSeasonsRejectsMalformedList(t *testing.T) {
	for _, raw := range []string{`{}`, `{"code":1,"data":[]}`, `{"code":0,"data":{}}`, `{"code":0,"data":[{"video_data":{}}]}`} {
		var p map[string]any
		json.Unmarshal([]byte(raw), &p)
		if _, err := parseSeriesSeasons(p); err == nil {
			t.Fatal("malformed response treated as empty", raw)
		}
	}
}

func TestLiveSeriesSeasons(t *testing.T) {
	dir := os.Getenv("HONGGUO_SERIES_READ_PROBE_DIR")
	if dir == "" {
		t.Skip("anonymous read-only series selector probe")
	}
	c := newPassportClient(accountSession{DeviceID: miniReelRandomID(), InstallID: miniReelRandomID(), Cookies: map[string]string{}})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	p, err := c.cloudJSON(ctx, "/reading/bookapi/plan/v", http.MethodGet, seriesSeasonsQuery("7690163276214176792"), nil)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.MarshalIndent(p, "", "  ")
	if err = os.WriteFile(filepath.Join(dir, "series-seasons-raw.json"), b, 0600); err != nil {
		t.Fatal(err)
	}
	out, err := parseSeriesSeasons(p)
	if err != nil || len(out.Items) == 0 {
		t.Fatal(out, err)
	}
	b, _ = json.MarshalIndent(out, "", "  ")
	os.WriteFile(filepath.Join(dir, "series-seasons-adapter.json"), b, 0600)
	for _, item := range out.Items {
		t.Logf("%s %s playable=%v upcoming=%v reservation=%s", item.SeriesID, item.Label, item.Playable, item.Upcoming, item.ReservationID)
	}
}

func TestSeriesSeasonsDoesNotInventReservationItem(t *testing.T) {
	for _, raw := range []string{`{}`, `{"item_id":0}`, `{"item_id":"bad"}`} {
		var sub map[string]any
		json.Unmarshal([]byte(raw), &sub)
		out, err := parseSeriesSeasons(map[string]any{"code": "0", "data": []any{map[string]any{"video_data": []any{map[string]any{"series_id": "123", "title": "新季", "vid": "456", "episode_cnt": "1", "subscribe_item": sub}}}}})
		if err != nil || len(out.Items) != 1 || out.Items[0].ReservationID != "" || out.Items[0].Playable || !out.Items[0].Upcoming {
			t.Fatal(raw, out, err)
		}
	}
}

func TestSeriesSeasonsQueryUsesOfficialSelectorScene(t *testing.T) {
	q := seriesSeasonsQuery("123")
	expected := map[string]string{"scene": "10", "from": "single_col_same_ip_series", "offset": "0", "limit": "0", "total_chapter_num": "0", "current_chapter_num": "0", "post_id": "0", "is_horizontal_screen": "false", "bookstore_tab": "0", "bookstore_tab_type": "0", "book_id": "123", "filter_ids": "123"}
	if len(q) != len(expected) {
		t.Fatal(q)
	}
	for key, value := range expected {
		if q.Get(key) != value {
			t.Fatal(key, q)
		}
	}
}

func TestSeriesSeasonsProtectedRead(t *testing.T) {
	s := &server{}
	h := s.withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, tt := range []struct {
		remote, origin string
		status         int
	}{
		{"127.0.0.1:8000", "http://127.0.0.1:8797", 204},
		{"127.0.0.1:8000", "https://other.example", 403},
		{"192.168.1.2:8000", "", 403},
	} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:8797/api/v1/series/seasons?series_id=123", nil)
		r.RemoteAddr = tt.remote
		r.Header.Set("Origin", tt.origin)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tt.status || w.Header().Get("Access-Control-Allow-Origin") == "*" {
			t.Fatal(tt, w.Code, w.Header())
		}
	}
	for _, id := range []string{"", "0", "bad"} {
		w := httptest.NewRecorder()
		s.seriesSeasons(w, httptest.NewRequest("GET", "/api/v1/series/seasons?series_id="+id, nil))
		if w.Code != 400 {
			t.Fatal(id, w.Code)
		}
	}
}
