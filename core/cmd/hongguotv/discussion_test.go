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

func TestRecommendationFeedParserCountsDirectPlayableAndFilteredRecords(t *testing.T) {
	cells := []any{
		map[string]any{"video_data": []any{
			map[string]any{"video_detail": map[string]any{"series_id": "7690163276214176792", "series_title": "嵌套推荐", "episode_cnt": 9}},
			map[string]any{"disable_play": true, "video_detail": map[string]any{"series_id": "7690163276214176793", "episode_cnt": 9}},
		}},
		map[string]any{"video_detail": map[string]any{"series_id": "7690163276214176794", "series_title": "直接详情", "episode_cnt": 12, "first_vid": "7690223053078268953"}},
		map[string]any{"video_detail": map[string]any{"series_id": "7690163276214176795", "series_title": "无可播剧集", "episode_cnt": 0}},
	}
	items, diagnostics := parseFeedDramas(cells)
	if len(items) != 2 || items[1].SeriesID != "7690163276214176794" || items[1].Vid != "7690223053078268953" {
		t.Fatalf("direct details were not parsed safely: %+v", items)
	}
	if diagnostics != (FeedParseDiagnostics{CellsSeen: 3, RecordsSeen: 4, Parsed: 2, Filtered: 2}) {
		t.Fatalf("unexpected aggregate diagnostics: %+v", diagnostics)
	}
}

func TestCategoryChannelsUseHotRank(t *testing.T) {
	c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/reading/bookapi/bookmall/cell/change/v" {
			t.Errorf("home category left the hot rank: %s", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("cell_id") != "7470092475068071998" {
			t.Error("not the rank cell", q.Get("cell_id"))
		}
		key := q.Get("selected_items") + "/" + q.Get("sub_selected_items")
		switch key {
		case "comic_series_rank/comic_series_hot_play":
			if q.Get("offset") != "0" || q.Get("tab_type") != "26" {
				t.Error("comic hot rank first page", q)
			}
		case "human/human_hot_play":
			if q.Get("offset") != "10" || q.Get("tab_type") != "18" || q.Get("session_id") != "rank-session" {
				t.Error("real hot rank next page", q)
			}
		default:
			t.Error("unexpected rank selection", key)
		}
		ioJSON(w, `{"code":0,"data":{"has_more":true,"next_offset":10,"session_id":"rank-session","cell_view":{"cell_selector":{"outer_row":{"items":[{"selector_item_id":"human","show_name":"真人剧"}]}},"cell_data":[{"video_data":[{"series_id":"7690163276214176792","series_title":"热榜剧","episode_cnt":12,"vid":"7690223053078268953"}],"ugc_user_data":[{"user_info":{"base_info":{"actor_id_str":"1234567890123456789","user_name":"不该出现的演员"}}}]}]}}}`)
	})
	defer close()
	first, e := c.Recommendations(context.Background(), url.Values{"channel": {"36"}})
	if e != nil || first.Source != "hot_rank" || first.FeedCell != "" || first.FeedPlan != "" || len(first.Ranks) != 0 || len(first.Items) != 1 || first.Items[0].Title != "热榜剧" || !first.HasMore || first.NextOffset != 10 {
		t.Fatal(first, e)
	}
	next, e := c.Recommendations(context.Background(), url.Values{"channel": {"39"}, "offset": {"10"}, "session_id": {"rank-session"}, "feed_cell": {"7650476176527343678"}, "feed_plan": {"7650476689721409598"}})
	if e != nil || next.Source != "hot_rank" || len(next.Items) != 1 || next.Items[0].SeriesID != "7690163276214176792" {
		t.Fatal(next, e)
	}
}
