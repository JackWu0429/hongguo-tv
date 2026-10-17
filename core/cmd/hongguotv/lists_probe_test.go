package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

type probeTransport struct{ t *testing.T }

func (p probeTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	resp, err := http.DefaultTransport.RoundTrip(r)
	if err == nil && r.URL.Path == "/reading/bookapi/search/tab/v" {
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		resp.Body = io.NopCloser(bytes.NewReader(b))
		n := len(b)
		if n > 100 {
			n = 100
		}
		p.t.Logf("search wire: %s encoding=%s prefix=%q", resp.Header.Get("Content-Type"), resp.Header.Get("Content-Encoding"), b[:n])
	}
	return resp, err
}

func TestLiveListAdapters(t *testing.T) {
	dir := os.Getenv("HONGGUO_LISTS_ADAPTER_PROBE_DIR")
	if dir == "" {
		t.Skip("anonymous read-only list adapters")
	}
	c := newPassportClient(accountSession{DeviceID: miniReelRandomID(), InstallID: miniReelRandomID(), Cookies: map[string]string{}})
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	for _, tc := range []struct {
		name string
		q    url.Values
		call func(context.Context, url.Values) (ListResult, error)
	}{
		{"new-adapter", url.Values{}, c.NewSeries},
		{"recommend-adapter", url.Values{}, c.Recommendations},
		{"comic-feed-adapter", url.Values{"channel": {"36"}}, c.Recommendations},
		{"real-feed-adapter", url.Values{"channel": {"39"}}, c.Recommendations},
		{"rank-adapter", url.Values{"rank": {"all"}, "rank_sub": {"ranklist_hot_play_sc"}}, c.RankList},
		{"actors-adapter", url.Values{"rank": {"ranklist_celebrity"}, "rank_sub": {"ranklist_actor_fans"}}, c.RankList},
		{"seasons-adapter", url.Values{"rank": {"series_album"}, "rank_sub": {"series_album_new_rank"}}, c.RankList},
		{"calendar-adapter", url.Values{}, func(ctx context.Context, q url.Values) (ListResult, error) { return c.SubscriptionList(ctx, q, true) }},
	} {
		out, e := tc.call(ctx, tc.q)
		if e != nil {
			t.Error(tc.name, e)
			continue
		}
		b, _ := json.MarshalIndent(out, "", "  ")
		os.WriteFile(filepath.Join(dir, tc.name+".json"), b, 0600)
		t.Logf("%s count=%d next=%d more=%v selectors=%d", tc.name, len(out.Items), out.NextOffset, out.HasMore, len(out.Ranks))
		if len(out.Items) == 0 {
			t.Error(tc.name, "no normalized items")
		}
		if out.HasMore {
			tc.q.Set("offset", strconv.Itoa(out.NextOffset))
			tc.q.Set("session_id", out.SessionID)
			tc.q.Set("feed_cell", out.FeedCell)
			tc.q.Set("feed_plan", out.FeedPlan)
			if out.Calendar != nil {
				tc.q.Set("date", out.Calendar.DefaultDate)
			}
			out, e = tc.call(ctx, tc.q)
			if e != nil {
				t.Error(tc.name, "page2", e)
				continue
			}
			b, _ = json.MarshalIndent(out, "", "  ")
			os.WriteFile(filepath.Join(dir, tc.name+"-page2.json"), b, 0600)
			t.Logf("%s page2 count=%d next=%d more=%v", tc.name, len(out.Items), out.NextOffset, out.HasMore)
		}
	}
	q := url.Values{"series_id": {"7690163276214176792"}, "vid": {"7690223053078268953"}}
	for i := 0; i < 2; i++ {
		out, e := c.Discussion(ctx, q, false)
		if e != nil {
			t.Fatal(e)
		}
		t.Logf("comments page%d count=%d more=%v total=%d", i+1, len(out.Items), out.HasMore, out.Total)
		if len(out.Items) == 0 {
			t.Fatal("unexpected empty comments")
		}
		q.Set("cursor", out.NextCursor)
	}
	q.Set("start", "30000")
	out, e := c.Discussion(ctx, q, true)
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("danmaku count=%d window-end=%d", len(out.Items), out.WindowEnd)
}

func TestLiveRemainingReadProtocols(t *testing.T) {
	dir := os.Getenv("HONGGUO_REMAINING_READ_PROBE_DIR")
	if dir == "" {
		t.Skip("read-only protocol research")
	}
	c := newPassportClient(accountSession{DeviceID: miniReelRandomID(), InstallID: miniReelRandomID(), Cookies: map[string]string{}})
	ctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
	defer cancel()
	for _, tc := range []struct {
		name, path string
		q          url.Values
	}{
		{"recommend-raw", "/reading/bookapi/bookmall/cell/change/v", url.Values{"bottom_tab_type": {"7"}, "client_req_type": {"2"}, "client_template": {"7"}, "change_type": {"0"}, "category_id": {"0"}, "cell_sub_id": {"0"}, "limit": {"0"}, "need_personal_recommend": {"1"}, "video_type_preferences_str": {"[]"}, "cell_id": {"7294257141911650341"}, "plan_id": {"7294257258253254693"}, "tab_type": {"16"}, "offset": {"0"}, "session_id": {""}, "filter_ids": {""}}},
		{"comments-raw", "/novel/commentapi/comment/list/7690223053078268953/v1/", url.Values{"comment_source": {"4"}, "server_channel": {"18"}, "group_id": {"7690223053078268953"}, "group_type": {"30"}, "comment_type": {"4"}, "sort": {"1"}, "need_count": {"true"}, "book_id": {"7690163276214176792"}, "req_type": {"0"}, "business_param": {"{\"need_count\":true,\"book_id\":\"7690163276214176792\",\"req_type\":0}"}, "count": {"20"}, "cursor": {"0"}, "aid": {"8662"}, "compliance_status": {"0"}}},
	} {
		p, e := c.cloudJSON(ctx, tc.path, http.MethodGet, tc.q, nil)
		if e != nil {
			t.Log(tc.name, e)
			continue
		}
		b, _ := json.MarshalIndent(p, "", "  ")
		os.WriteFile(filepath.Join(dir, tc.name+".json"), b, 0600)
		t.Log(tc.name, "bytes", len(b))
		if tc.name == "comments-raw" {
			tc.q.Set("comment_source", "601")
			tc.q.Set("server_channel", "1000")
			tc.q.Set("comment_type", "20")
			tc.q.Set("start_offset_time", "0")
			tc.q.Set("playlet_item_duration", "600000")
			tc.q.Set("need_danmaku_guide_type", "24")
			tc.q.Set("count", "90")
			p, e = c.cloudJSON(ctx, "/novel/commentapi/comment/list/7690223053078268953/v1/", http.MethodGet, tc.q, nil)
			if e != nil {
				t.Log("danmaku", e)
			} else {
				b, _ = json.MarshalIndent(p, "", "  ")
				os.WriteFile(filepath.Join(dir, "danmaku-raw.json"), b, 0600)
				t.Log("danmaku bytes", len(b))
			}
		}
	}
	q := url.Values{"bottom_tab_type": {"7"}, "landing_bottom_tab_type": {"7"}, "need_personal_recommend": {"1"}, "device_level": {"3"}, "screen_width_px": {"1078"}, "is_horizontal_screen": {"false"}, "disable_digg_stat": {"false"}, "auth_aweme": {"true"}, "auth_backward": {"true"}, "has_video_cache": {"false"}, "last_tab_type": {"0"}, "last_tab_index": {"0"}, "tab_index": {"0"}, "req_rank_category_id": {"0"}, "video_type_preferences_str": {"[]"}, "tab_type": {"16"}, "offset": {"0"}, "session_id": {""}, "client_req_type": {"1"}}
	p, e := c.cloudJSON(ctx, "/reading/bookapi/bookmall/tab/v", http.MethodGet, q, nil)
	if e != nil {
		t.Log("feed-tabs", e)
	} else {
		b, _ := json.MarshalIndent(p, "", "  ")
		os.WriteFile(filepath.Join(dir, "feed-tabs-raw.json"), b, 0600)
		t.Log("feed-tabs bytes", len(b))
	}
	for _, tab := range []string{"36", "39", "45"} {
		q.Set("tab_type", tab)
		p, e = c.cloudJSON(ctx, "/reading/bookapi/bookmall/tab/v", http.MethodGet, q, nil)
		if e != nil {
			t.Log("feed", tab, e)
			continue
		}
		b, _ := json.MarshalIndent(p, "", "  ")
		os.WriteFile(filepath.Join(dir, "feed-"+tab+"-raw.json"), b, 0600)
		t.Log("feed", tab, "bytes", len(b))
	}
}

// Explicitly enabled, anonymous and read-only. Raw responses stay outside the repository.
func TestLiveListsProbe(t *testing.T) {
	dir := os.Getenv("HONGGUO_LISTS_PROBE_DIR")
	if dir == "" {
		t.Skip("read-only protocol probe")
	}
	c := newPassportClient(accountSession{DeviceID: miniReelRandomID(), InstallID: miniReelRandomID(), Cookies: map[string]string{}})
	c.http.Transport = probeTransport{t}
	cases := []struct {
		name, path string
		q          url.Values
	}{
		{"calendar", "/reading/user/subscribe/list/v1/", url.Values{"tab_type": {"5"}, "tab_style": {"2"}, "active_panel": {"6"}, "gender_type": {"2"}, "need_calendar_schema": {"true"}}},
		{"reservations", "/reading/user/subscribe/list/v1/", url.Values{"tab_type": {"13"}, "subscribe_order_type": {"0"}, "swipe_type": {"0"}, "need_calendar_schema": {"false"}, "offset": {"0"}, "subscribe_offset": {"0"}, "limit": {"20"}, "is_online": {"false"}}},
		{"new", "/reading/bookapi/bookmall/cell/change/v1/", url.Values{"change_type": {"1"}, "selected_items": {"firstonlinetime_new"}, "client_req_type": {"1"}, "cell_id": {"7431550523368554558"}, "limit": {"20"}, "offset": {"0"}, "cell_gender": {"2"}}},
		{"rank", "/reading/bookapi/bookmall/cell/change/v", url.Values{"tab_type": {"26"}, "client_req_type": {"2"}, "client_template": {"2"}, "background_selected_items": {""}, "category_id": {"0"}, "limit": {"20"}, "cell_sub_id": {"0"}, "gender": {"2"}, "cell_id": {"7470092475068071998"}, "selected_items": {""}, "sub_selected_items": {""}, "panel_selected_items": {""}, "offset": {"0"}}},
		{"search", "/reading/bookapi/search/tab/v", url.Values{"bookshelf_search_plan": {"4"}, "use_correct": {"true"}, "query": {"万妖图录传"}, "count": {"100"}, "offset": {"0"}, "tab_type": {"11"}}},
	}
	for _, tc := range cases {
		p, err := c.request(context.Background(), tc.path, http.MethodGet, tc.q, nil, "")
		if err != nil && tc.name == "search" {
			c.base = defaultHongguoAPI
			tc.q.Set("count", "20")
			p, err = c.request(context.Background(), tc.path, http.MethodGet, tc.q, nil, "")
			c.base = passportAPI
		}
		if err != nil {
			t.Errorf("%s: %v", tc.name, err)
			continue
		}
		b, _ := json.MarshalIndent(p, "", "  ")
		if err := os.WriteFile(filepath.Join(dir, tc.name+".json"), b, 0600); err != nil {
			t.Fatal(err)
		}
		t.Logf("%s: code=%s message=%s bytes=%d", tc.name, asString(p["code"]), asString(p["message"]), len(b))
		if tc.name == "reservations" {
			continue
		}
		d, _ := asMap(p["data"])
		offset := asInt(d["next_offset"])
		if tc.name == "rank" {
			tc.q.Set("selected_items", "all")
			tc.q.Set("sub_selected_items", "ranklist_hot_play_sc")
		}
		if offset > 0 {
			tc.q.Set("offset", asString(d["next_offset"]))
			tc.q.Set("session_id", asString(d["session_id"]))
			if tc.name == "calendar" {
				tc.q.Set("subscribe_offset", asString(d["next_offset"]))
			}
			p, err = c.request(context.Background(), tc.path, http.MethodGet, tc.q, nil, "")
			if err != nil {
				t.Errorf("%s page 2: %v", tc.name, err)
				continue
			}
			b, _ = json.MarshalIndent(p, "", "  ")
			os.WriteFile(filepath.Join(dir, tc.name+"-page2.json"), b, 0600)
			t.Logf("%s page2: %d bytes", tc.name, len(b))
		}
	}
}

func TestLiveSearchVersions(t *testing.T) {
	dir := os.Getenv("HONGGUO_LISTS_PROBE_DIR")
	if dir == "" {
		t.Skip("read-only")
	}
	c := newPassportClient(accountSession{DeviceID: miniReelRandomID(), InstallID: miniReelRandomID(), Cookies: map[string]string{}})
	for _, v := range []string{"73932", "73532"} {
		q := url.Values{"bookshelf_search_plan": {"4"}, "use_correct": {"true"}, "query": {"万妖"}, "count": {"100"}, "offset": {"0"}, "tab_type": {"11"}, "version_code": {v}, "manifest_version_code": {v}, "update_version_code": {v}}
		if v == "73932" {
			q.Set("version_name", "7.3.9.32")
		}
		for _, path := range []string{"/reading/bookapi/search/tab/v", "/reading/bookapi/search/tab/v/"} {
			p, e := c.request(context.Background(), path, http.MethodGet, q, nil, "")
			t.Log(v, path, e)
			if e == nil {
				b, _ := json.MarshalIndent(p, "", "  ")
				os.WriteFile(filepath.Join(dir, "search-"+v+".json"), b, 0600)
				t.Logf("search: code=%s bytes=%d", asString(p["code"]), len(b))
			}
		}
	}
}
