package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// Read-only, explicitly enabled; log schema/counts only, never account data.
func TestLiveLikesSchema(t *testing.T) {
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
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	p, err := c.cloudJSON(ctx, "/reading/ugc/action/mget/v", http.MethodGet, url.Values{"object_type_list": {"6,15,10"}, "action_type": {"3"}, "offset": {"0"}, "count": {"100"}}, nil)
	if err != nil {
		t.Fatal("authenticated likes read failed")
	}
	d := passportData(p)
	keys := func(m map[string]any) []string {
		out := []string{}
		for k := range m {
			out = append(out, k)
		}
		sort.Strings(out)
		return out
	}
	rows, ok := d["mixed_data_list"].([]any)
	t.Logf("fields=%v list=%t count=%d more=%t next=%d", keys(d), ok, len(rows), asBool(d["has_more"]), asInt(d["next_offset"]))
	if len(rows) > 0 {
		r, _ := asMap(rows[0])
		v, _ := asMap(r["video_data"])
		detail, _ := asMap(v["video_detail"])
		t.Logf("row=%v video=%v detail=%v valid_series=%t valid_vid=%t", keys(r), keys(v), keys(detail), validID(asString(v["series_id"])), validID(asString(v["vid"])))
	}
}

// Explicitly enabled reversible regression on one public drama episode. Read
// initial membership, add only when absent, and always cancel the test like.
func TestLiveVideoLikeRoundTrip(t *testing.T) {
	if os.Getenv("HONGGUO_LIKE_ROUNDTRIP") != "1" {
		t.Skip("requires explicit paired write regression")
	}
	dir := os.Getenv("HONGGUO_AUTH_READ_PROBE_DIR")
	b, err := os.ReadFile(filepath.Join(dir, "account.json"))
	if err != nil {
		t.Fatal("session unavailable")
	}
	var disk accountDisk
	if json.Unmarshal(b, &disk) != nil || disk.Profile == nil {
		t.Fatal("not logged in")
	}
	c := newPassportClient(disk.Session)
	c.uid = disk.Profile.UID
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	const series = "7690163276214176792"
	const vid = "7690223053078268953"
	contains := func(rows []LibraryEntry) bool {
		for _, r := range rows {
			for _, v := range r.LikedVideos {
				if r.Drama.SeriesID == series && v.VideoID == vid {
					return true
				}
			}
		}
		return false
	}
	initial, err := c.pullLikes(ctx)
	if err != nil {
		t.Fatal("initial likes unavailable", err)
	}
	if contains(initial) {
		t.Skip("test episode already liked; preserve it")
	}
	defer func() {
		restoreCtx, done := context.WithTimeout(context.Background(), 15*time.Second)
		defer done()
		if err := c.SetVideoLike(restoreCtx, series, vid, false); err != nil {
			t.Error("test like cleanup failed", err)
		} else {
			rows, e := c.pullLikes(restoreCtx)
			if e != nil || contains(rows) {
				t.Error("test like cleanup not verified")
			} else {
				t.Log("initial unliked state restored")
			}
		}
	}()
	if err = c.SetVideoLike(ctx, series, vid, true); err != nil {
		t.Fatal("test like request failed", err)
	}
	rows, err := c.pullLikes(ctx)
	for attempt := 0; err == nil && !contains(rows) && attempt < 8; attempt++ {
		time.Sleep(300 * time.Millisecond)
		rows, err = c.pullLikes(ctx)
	}
	if err != nil || !contains(rows) {
		t.Fatal("confirmed like not visible in account list")
	}
	t.Log("real like confirmed and present in account list")
}
