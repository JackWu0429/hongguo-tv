package main

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"
)

// Opt-in anonymous read; only public engagement counts and field names are logged.
func TestLiveEngagementSchema(t *testing.T) {
	if os.Getenv("HONGGUO_ENGAGEMENT_PROBE") != "1" {
		t.Skip("anonymous engagement read probe")
	}
	c := newPassportClient(accountSession{DeviceID: miniReelRandomID(), InstallID: miniReelRandomID(), Cookies: map[string]string{}})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	p, err := c.cloudJSON(ctx, "/novel/player/multi_video_detail/preload/v1", http.MethodPost, nil, map[string]any{
		"dr_scene": "preload", "series_id": "7690163276214176792", "biz_param": map[string]any{"detail_page_version": 0, "disable_digg_stat": false, "disable_video_relate_book": false, "need_all_video_definition": false, "need_mp4_align": false, "source": 7, "use_os_player": false, "use_server_dns": false},
	})
	if err != nil {
		t.Fatal(err)
	}
	d, _ := asMap(p["data"])
	x, _ := asMap(d["7690163276214176792"])
	v, _ := asMap(x["video_data"])
	for name, obj := range map[string]map[string]any{"row": x, "video": v} {
		keys := []string{}
		for k := range obj {
			keys = append(keys, k)
		}
		t.Log(name, keys)
	}
	detail, _ := asMap(v["video_detail"])
	keys := []string{}
	for k := range detail {
		keys = append(keys, k)
	}
	t.Log("detail", keys)
	for _, obj := range []map[string]any{v, detail} {
		t.Log("followed_cnt", obj["followed_cnt"], "digged_count", obj["digged_count"], "comment_count", obj["comment_count"])
		rows, _ := obj["video_list"].([]any)
		if len(rows) > 0 {
			row, _ := asMap(rows[0])
			t.Log("first video", row["vid"], "digged_count", row["digged_count"], "comment_count", row["comment_count"])
		}
	}
}
