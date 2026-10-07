package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCategoryNormalizesMacCompatiblePayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/reading/distribution/category/landpage/v/" {
			t.Fatalf("unexpected category path: %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body["req_scene"] != "default" || body["req_type"] != "only_content" {
			t.Fatalf("unexpected category body: %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"has_more":true,"next_offset":15,"session_id":"s1","video_data":[{"series_id":"7687919221593885758","title":"测试短剧","cover":"https://cover","video_desc":"简介","episode_cnt":77,"accessible_episode_cnt":3,"vid":"7687921187195735102","score":"8.3","play_cnt":51152079,"tags":["爱情"]}]}}`))
	}))
	defer server.Close()

	client := newHongguoClient()
	client.apiBase = server.URL
	client.httpClient.Timeout = 2 * time.Second
	result, err := client.Category(context.Background(), CategoryRequest{Path: "/rank/hot-drama"})
	if err != nil {
		t.Fatalf("Category failed: %v", err)
	}
	if len(result.Items) != 1 || result.Items[0].SeriesID != "7687919221593885758" {
		t.Fatalf("unexpected category result: %#v", result)
	}
	if result.Items[0].EpisodeCount != 77 || result.Items[0].AccessibleEpisodeCnt != 3 {
		t.Fatalf("episode metadata was lost: %#v", result.Items[0])
	}
}

func TestCategoryFiltersSelectorsAndPagination(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		selected, _ := asMap(body["select_items"])
		if len(asStringSlice(selected["genre"])) != 0 || strings.Join(asStringSlice(selected["category_dim_theme"]), ",") != "cate_165" || strings.Join(asStringSlice(selected["gender"]), ",") != "0" {
			t.Errorf("explicit all / theme / female selection was lost: %#v", selected)
		}
		if asInt(body["offset"]) != 15 || body["session_id"] != "session-1" || body["filter_ids"] != "7690163276214176792,7546488656639314968" {
			t.Errorf("pagination context was lost: %#v", body)
		}
		if body["req_type"] != "default" || !asBool(body["need_selector_panel"]) {
			t.Errorf("selector panel request needs default: %#v", body)
		}
		_, _ = w.Write([]byte(`{"code":0,"data":{"has_more":true,"next_offset":30,"session_id":"session-2","video_data":[],"selector_rows":[{"type":"category_dim_theme","row_name":"全部主题","items":[{"selector_item_id":"cate_165","show_name":"悬疑"},{"selector_item_id":"cate_165","show_name":"重复"},{"selector_item_id":"not-a-tag","show_name":"坏值"}]},{"type":"creation_status","items":[{"selector_item_id":"creation_status_0","show_name":"已完结"}]},{"type":"unknown","items":[{"selector_item_id":"fake","show_name":"未知"}]}]}}`))
	}))
	defer upstream.Close()
	client := newHongguoClient()
	client.apiBase = upstream.URL
	result, err := client.Category(context.Background(), CategoryRequest{
		Path: "/category/real-drama", Offset: 15, SessionID: "session-1",
		Shown: []string{"7690163276214176792", "7546488656639314968"}, Selectors: true,
		Filters: map[string]string{"genre": "", "category_dim_theme": "cate_165", "gender": "0"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.NextOffset != 30 || !result.HasMore || result.SessionID != "session-2" {
		t.Fatalf("incorrect cursor: %#v", result)
	}
	if len(result.Filters) != 2 || result.Filters[0].Label != "主题" || len(result.Filters[0].Options) != 1 || result.Filters[1].Type != "creation_status" {
		t.Fatalf("incorrect selector normalization: %#v", result.Filters)
	}
}

func TestInvalidCategoryFilterDoesNotReachUpstream(t *testing.T) {
	for _, filters := range []map[string]string{
		{"gender": "2"}, {"sort": "fake"}, {"category_dim_theme": "cate_165,cate_36"},
		{"online_time": "days_1"}, {"creation_status": "fake"}, {"unknown": "x"},
	} {
		if _, err := categorySelection(CategoryRequest{Filters: filters}); err == nil {
			t.Errorf("accepted invalid filters: %#v", filters)
		}
	}
	s := &server{hongguo: newHongguoClient()}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/category?gender=bad", nil)
	response := httptest.NewRecorder()
	s.category(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid filter status = %d", response.Code)
	}
}

func TestSeriesDetailCreatesLockedEpisodes(t *testing.T) {
	html := `<!doctype html><script>window._ROUTER_DATA = {"loaderData":{"detail_page":{"seriesDetail":{"series_id":"1234567890123456789","series_name":"分季测试","series_cover":"https://cover","series_intro":"简介","episode_cnt":5,"accessible_episode_cnt":3,"vid_list":["11","22","33","44","55"],"tags":["爱情"]}}}};</script>`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/detail") {
			t.Fatalf("unexpected detail path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(html))
	}))
	defer server.Close()

	client := newHongguoClient()
	client.webBase = server.URL
	client.httpClient.Timeout = 2 * time.Second
	result, err := client.SeriesDetail(context.Background(), "1234567890123456789")
	if err != nil {
		t.Fatalf("SeriesDetail failed: %v", err)
	}
	if len(result.Episodes) != 5 || !result.Episodes[3].Locked || result.Episodes[2].Locked {
		t.Fatalf("locked episode state was wrong: %#v", result.Episodes)
	}
}

func TestNewDramaRequestsOnlineTimeSort(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode category body: %v", err)
		}
		selectItems, _ := asMap(body["select_items"])
		if sort := asStringSlice(selectItems["sort"]); len(sort) != 1 || sort[0] != "online_time" {
			t.Errorf("new drama was not sorted by online time: %#v", selectItems)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"video_data":[],"has_more":false}}`))
	}))
	defer server.Close()
	client := newHongguoClient()
	client.apiBase = server.URL
	if _, err := client.Category(context.Background(), CategoryRequest{Path: "/new/recommend"}); err != nil {
		t.Fatalf("new drama category failed: %v", err)
	}
}

func TestSearchNormalizesSearchList(t *testing.T) {
	html := `<!doctype html><script>_ROUTER_DATA = {"loaderData":{"search_(keyword)/page":{"query":"测试","searchList":[{"name":"测试一","keyword":"1234567890123456789","video_data":{"series_id":"1234567890123456789","series_title":"测试一","series_cover":"https://cover/1","episode_cnt":12}},{"name":"测试二","keyword":"2234567890123456789","video_data":{"series_id":"2234567890123456789","series_title":"测试二","series_cover":"https://cover/2","episode_cnt":8}}]}}};</script>`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/search/") {
			t.Fatalf("unexpected search path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(html))
	}))
	defer server.Close()

	client := newHongguoClient()
	client.webBase = server.URL
	client.httpClient.Timeout = 2 * time.Second
	result, err := client.Search(context.Background(), "测试")
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if len(result.Items) != 2 || result.Items[0].SeriesID != "1234567890123456789" || result.Items[1].EpisodeCount != 8 {
		t.Fatalf("unexpected search result: %#v", result.Items)
	}
}

func TestRankNormalizesCrawlerPayload(t *testing.T) {
	html := `<!doctype html><script>_ROUTER_DATA = {"loaderData":{"rank_hot-drama/page":{"content":{"isSuccess":true,"rankList":[{"seriesId":"1234567890123456789","title":"榜单短剧","cover":"https://cover","rank":1,"heatText":"995万热度","scoreText":"评分9.3","description":"简介","tags":["玄幻"],"episodeVids":["9988776655443322110"]}],"pagination":{"pageNum":1,"totalPages":2}}}}};</script>`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rank/hot-drama" || r.Header.Get("User-Agent") != "Googlebot" {
			t.Fatalf("unexpected rank request: %s ua=%s", r.URL.Path, r.Header.Get("User-Agent"))
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(html))
	}))
	defer server.Close()

	client := newHongguoClient()
	client.webBase = server.URL
	client.httpClient.Timeout = 2 * time.Second
	result, err := client.Rank(context.Background(), RankRequest{Path: "/rank/hot-drama"})
	if err != nil {
		t.Fatalf("Rank failed: %v", err)
	}
	if len(result.Items) != 1 || result.Items[0].Rank != 1 || result.Items[0].Score != "9.3" || result.Items[0].Vid != "9988776655443322110" || !result.HasMore {
		t.Fatalf("unexpected rank result: %#v", result)
	}
}

func TestCoverFallbackPreservesSignedOriginal(t *testing.T) {
	original := "https://p3-reading-sign.fqnovelpic.com/novel-pic/abc~tplv-superreso:400:0.heic?x-signature=secret"
	drama, ok := normalizeDrama(map[string]any{"series_id": "123", "cover": original})
	if !ok || drama.Cover != original || drama.CoverFallback != "https://p3-novel.byteimg.com/novel-pic/abc~tplv-shrink:640:0.image" {
		t.Fatalf("unexpected HEIC cover: %#v", drama)
	}
	for _, ordinary := range []string{"https://p3-reading-sign.fqnovelpic.com/novel-pic/a.jpg?x-signature=keep", "https://example.com/a~b.heic"} {
		if browserCoverFallback(ordinary) != "" {
			t.Fatalf("unexpected fallback for %s", ordinary)
		}
	}
}

func TestPlayInfoUsesEmbeddedPlaybackOnly(t *testing.T) {
	client := newHongguoClient()
	client.internalPlayback = func(_ context.Context, seriesID, vid, quality string, fallback bool) (PlayInfo, error) {
		if seriesID != "123" || vid != "456" {
			t.Fatalf("unexpected embedded playback arguments: %s/%s", seriesID, vid)
		}
		return PlayInfo{Path: "/minireel-proxy/media/token.mp4", Quality: "720P"}, nil
	}
	result, err := client.PlayInfo(context.Background(), "123", "456")
	if err != nil {
		t.Fatalf("PlayInfo failed: %v", err)
	}
	if result.Path != "/minireel-proxy/media/token.mp4" || result.Quality != "720P" || result.Vid != "456" {
		t.Fatalf("unexpected playback result: %#v", result)
	}
}
