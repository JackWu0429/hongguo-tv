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

func TestPlayInfoUsesEmbeddedPlaybackOnly(t *testing.T) {
	client := newHongguoClient()
	client.internalPlayback = func(_ context.Context, seriesID, vid string) (PlayInfo, error) {
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
