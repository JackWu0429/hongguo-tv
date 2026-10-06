package main

import (
	"context"
	"net/http"
	"net/url"
	"testing"
)

func TestDiscussionVideoPathAndOpaqueCursor(t *testing.T) {
	c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/novel/commentapi/comment/list/7690223053078268953/v1/" || r.URL.Query().Get("group_id") != "7690223053078268953" || r.URL.Query().Get("cursor") != "opaque-page1" {
			t.Error("wrong per-episode request", r.URL)
		}
		ioJSON(w, `{"code":0,"data":{"common_list_info":{"cursor":"opaque-page2","has_more":true,"total":42},"data_list":[{"comment":{"comment_id":7691344565400093502,"common":{"content":{"text":"评论内容"},"create_timestamp":1790784507,"user_info":{"base_info":{"user_name":"观众"}}},"expand":{"offset_time":3000},"stat":{"digg_count":9,"reply_count":2}}}]}}`)
	})
	defer close()
	out, e := c.Discussion(context.Background(), url.Values{"series_id": {"7690163276214176792"}, "vid": {"7690223053078268953"}, "cursor": {"opaque-page1"}}, false)
	if e != nil {
		t.Fatal(e)
	}
	if len(out.Items) != 1 || out.Items[0].CommentID != "7691344565400093502" || out.Items[0].OffsetMS != 3000 || out.Items[0].Text != "评论内容" || out.NextCursor != "opaque-page2" || !out.HasMore {
		t.Fatalf("bad comments %+v", out)
	}
}
func TestDanmakuTimesAndMalformedData(t *testing.T) {
	c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("comment_source") != "601" || q.Get("comment_type") != "20" || q.Get("server_channel") != "1000" || q.Get("start_offset_time") != "30000" || q.Get("playlet_item_duration") != "120000" {
			t.Error("wrong danmaku window", q)
		}
		ioJSON(w, `{"code":0,"data":{"common_list_info":{"cursor":"{\"start_offset_time\":30000,\"end_offset_time\":60000}","has_more":false,"total":1},"data_list":[]}}`)
	})
	defer close()
	q := url.Values{"series_id": {"7690163276214176792"}, "vid": {"7690223053078268953"}, "start": {"30000"}, "duration": {"120000"}}
	out, e := c.Discussion(context.Background(), q, true)
	if e != nil || out.WindowEnd != 60000 {
		t.Fatal(out, e)
	}
	q.Set("start", "-1")
	if _, e = c.Discussion(context.Background(), q, true); e == nil {
		t.Fatal("negative start accepted")
	}
	q.Set("vid", "0")
	if _, e = c.Discussion(context.Background(), q, false); e == nil {
		t.Fatal("invalid vid accepted")
	}
}
func TestRecommendationsUseNestedDetailAndFeedCursor(t *testing.T) {
	c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("tab_type") != "16" || q.Get("plan_id") != "7294257258253254693" || q.Get("cell_id") != "7294257141911650341" {
			t.Error("wrong recommendation source")
		}
		ioJSON(w, `{"code":0,"data":{"has_more":true,"next_offset":6,"cell_view":{"cell_data":[{"video_data":[{"series_id":"123","video_detail":{"series_id":7690163276214176792,"series_title":"推荐剧","episode_cnt":209,"first_vid":7690223053078268953}},{"disable_play":true,"video_detail":{"series_id":"123","episode_cnt":9}}]},{"video_data":[]}]}}}`)
	})
	defer close()
	out, e := c.Recommendations(context.Background(), nil)
	if e != nil || len(out.Items) != 1 || out.Items[0].Vid != "7690223053078268953" || out.Items[0].Title != "推荐剧" || out.NextOffset != 6 {
		t.Fatal(out, e)
	}
}

func TestFeedChannelPhaseTransition(t *testing.T) {
	c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/reading/bookapi/bookmall/tab/v" {
			if r.URL.Query().Get("tab_type") != "39" {
				t.Error("channel lost")
			}
			ioJSON(w, `{"code":0,"data":{"tab_item":[{"tab_type":39,"bookstore_id":7650476689721409598,"bottom_unlimited":true,"session_id":"tab-session","cell_data":[{"cell_id_str":"7650476176527343678","cell_data":[{"video_data":[{"video_detail":{"series_id":"7690163276214176792","series_title":"首批","episode_cnt":209}}]}]}]}]}}`)
		} else {
			q := r.URL.Query()
			if q.Get("offset") != "0" || q.Get("cell_id") != "7650476176527343678" || q.Get("session_id") != "tab-session" || q.Get("plan_id") != "7650476689721409598" {
				t.Error("feed phase cursor lost", q)
			}
			ioJSON(w, `{"code":0,"data":{"next_offset":6,"has_more":true,"cell_view":{"cell_data":[]}}}`)
		}
	})
	defer close()
	q := url.Values{"channel": {"39"}}
	first, e := c.Recommendations(context.Background(), q)
	if e != nil || first.NextOffset != 0 || !first.HasMore || len(first.Items) != 1 {
		t.Fatal(first, e)
	}
	q.Set("feed_cell", first.FeedCell)
	q.Set("feed_plan", first.FeedPlan)
	q.Set("session_id", first.SessionID)
	next, e := c.Recommendations(context.Background(), q)
	if e != nil || next.NextOffset != 6 || !next.HasMore {
		t.Fatal(next, e)
	}
}
