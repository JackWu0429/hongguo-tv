package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Explicit opt-in, read-only authenticated regression. Only schema names,
// counts and cursors are logged; never credentials, identity or private rows.
func TestLiveAuthenticatedListShapes(t *testing.T) {
	dir := os.Getenv("HONGGUO_AUTH_READ_PROBE_DIR")
	if dir == "" {
		t.Skip("requires explicit authenticated read regression")
	}
	b, err := os.ReadFile(filepath.Join(dir, "account.json"))
	if err != nil {
		t.Fatal("cannot read local session")
	}
	var disk accountDisk
	if json.Unmarshal(b, &disk) != nil || disk.Profile == nil {
		t.Fatal("not logged in")
	}
	c := newPassportClient(disk.Session)
	c.uid = disk.Profile.UID
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancel()
	for _, limit := range []string{"100", "0"} {
		offset := 0
		for page := 0; page < 100; page++ {
			q := url.Values{"limit": {limit}, "offset": {strconv.Itoa(offset)}, "book_type": {"2"}, "full_field": {"false"}, "query_soft_deleted": {"false"}, "last_min_read_timestamp_ms": {"0"}, "is_first_load": {strconv.FormatBool(offset == 0)}}
			p, e := c.cloudJSON(ctx, "/reading/bookapi/read_history/list/v", http.MethodGet, q, nil)
			if e != nil {
				t.Fatal("history read failed")
			}
			d := passportData(p)
			rows, _ := d["data_list"].([]any)
			next := asInt(d["next_offset"])
			t.Logf("history limit=%s page=%d count=%d more=%t next=%d", limit, page, len(rows), asBool(d["has_more"]), next)
			if !asBool(d["has_more"]) {
				break
			}
			if next <= offset {
				next = offset + 500
			}
			offset = next
			if limit == "100" && page == 2 {
				break
			}
		}
	}
	for _, mode := range []string{"true", "false"} {
		q := url.Values{"offset": {"0"}, "subscribe_offset": {"0"}, "tab_type": {"2"}, "subscribe_order_type": {"1"}, "swipe_type": {"1"}, "need_calendar_schema": {"false"}, "limit": {"20"}, "is_online": {mode}}
		p, e := c.cloudJSON(ctx, "/reading/user/subscribe/list/v1/", http.MethodGet, q, nil)
		if e != nil {
			t.Fatal("reservations read failed")
		}
		d := passportData(p)
		keys := []string{}
		for k := range d {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		t.Logf("reservation online=%s fields=%v", mode, keys)
		for k, v := range d {
			if k == "online_total_count" || k == "offline_total_count" {
				t.Logf("counter %s=%s", k, asString(v))
			}
			if m, ok := asMap(v); ok {
				sub := []string{}
				for s := range m {
					sub = append(sub, s)
				}
				sort.Strings(sub)
				t.Logf("object %s fields=%v", k, sub)
			}
		}
	}
	p, e := c.cloudJSON(ctx, "/reading/bookapi/bookshelf/video/list/v", http.MethodGet, urlValues("target_user_id", c.uid), nil)
	if e != nil {
		t.Fatal("favorites read failed")
	}
	rows, _ := passportData(p)["video_shelf_info"].([]any)
	t.Logf("favorites count=%d", len(rows))
	if len(rows) > 0 {
		r, _ := asMap(rows[0])
		keys := []string{}
		for k := range r {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		t.Logf("favorite row fields=%v", keys)
	}
	ids := []string{}
	for _, v := range rows[:min(20, len(rows))] {
		r, _ := asMap(v)
		ids = append(ids, asString(r["series_id"]))
	}
	p, e = c.cloudJSON(ctx, "/novel/player/multi_video_detail/preload/v1", http.MethodPost, nil, map[string]any{"dr_scene": "preload", "series_id": strings.Join(ids, ","), "biz_param": map[string]any{"detail_page_version": 0, "disable_digg_stat": false, "disable_video_relate_book": false, "need_all_video_definition": false, "need_mp4_align": false, "source": 7, "use_os_player": false, "use_server_dns": false}})
	if e != nil {
		t.Fatal("batch metadata read failed")
	}
	d := passportData(p)
	t.Logf("batch metadata objects=%d", len(d))
	for _, id := range ids[:min(1, len(ids))] {
		x, _ := asMap(d[id])
		v, _ := asMap(x["video_data"])
		ks := []string{}
		for k := range v {
			ks = append(ks, k)
		}
		sort.Strings(ks)
		t.Logf("batch video fields=%v", ks)
	}
}

func TestLiveAuthenticatedCloudReads(t *testing.T) {
	dir := os.Getenv("HONGGUO_AUTH_READ_PROBE_DIR")
	if dir == "" {
		t.Skip("explicit read regression only")
	}
	b, e := os.ReadFile(filepath.Join(dir, "account.json"))
	if e != nil {
		t.Fatal("session unavailable")
	}
	var disk accountDisk
	if json.Unmarshal(b, &disk) != nil || disk.Profile == nil {
		t.Fatal("not logged in")
	}
	c := newPassportClient(disk.Session)
	c.uid = disk.Profile.UID
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancel()
	p, e := c.cloudJSON(ctx, "/reading/bookapi/bookshelf/video/list/v", http.MethodGet, urlValues("target_user_id", c.uid), nil)
	if e != nil {
		t.Fatal("shelf read failed")
	}
	rows, _ := passportData(p)["video_shelf_info"].([]any)
	ids := []string{}
	for _, v := range rows {
		r, _ := asMap(v)
		ids = append(ids, asString(r["series_id"]))
	}
	for _, size := range []int{1, 20, 200} {
		batch := []any{}
		for _, id := range ids[:min(size, len(ids))] {
			batch = append(batch, cloudNumericID(id))
		}
		p, e := c.cloudJSON(ctx, "/reading/bookapi/read_progress/get/v", http.MethodPost, nil, map[string]any{"book_ids": map[string]any{"2": batch}})
		if e != nil {
			t.Logf("progress size=%d error=%v", size, e)
		} else {
			a, _ := p["video_data"].([]any)
			t.Logf("progress size=%d rows=%d", size, len(a))
		}
	}
	total := 0
	for start := 0; start < len(ids); start += 20 {
		out, e := c.libraryMetadata(ctx, ids[start:min(start+20, len(ids))])
		if e != nil {
			t.Fatalf("batch index=%d error=%v", start/20, e)
		}
		total += len(out)
	}
	t.Logf("metadata requested=%d resolved=%d", len(ids), total)
}
