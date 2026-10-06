package main

// Opt-in TV browser fixture: no SMS, cloud writes, media downloads or production account.
import (
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestListsBrowserFixture(t *testing.T) {
	if os.Getenv("HONGGUO_LISTS_UI_FIXTURE") != "1" {
		t.Skip("isolated UI fixture")
	}
	var mu sync.Mutex
	calls := []string{}
	var failNew bool
	ranks := []RankOption{
		{ID: "all", Label: "全部", Children: []RankOption{{ID: "ranklist_hot_play_sc", Label: "热播榜", Panels: []CategoryFilterRow{{Type: "other", Label: "综合", Options: []CategoryFilterOption{{ID: "", Label: "总榜"}, {ID: "gender_male", Label: "男频"}, {ID: "gender_female", Label: "女频"}}}}}, {ID: "ranklist_subscribe", Label: "预约榜"}}},
		{ID: "human", Label: "真人剧", Children: []RankOption{{ID: "human_hot_play", Label: "热播榜"}}},
		{ID: "comic_series_rank", Label: "漫剧", Children: []RankOption{{ID: "comic_series_hot_play", Label: "热播榜"}}},
		{ID: "ai_playlet", Label: "AI剧", Children: []RankOption{{ID: "ai_playlet_hot_play", Label: "热播榜"}}},
		{ID: "ranklist_celebrity", Label: "演员", Children: []RankOption{{ID: "ranklist_actor_fans", Label: "星光榜"}}},
		{ID: "series_album", Label: "系列剧", Children: []RankOption{{ID: "series_album_new_rank", Label: "新季榜"}}},
	}
	drama := func(i int) Drama {
		vids := make([]string, 80)
		for j := range vids {
			vids[j] = "7690223053078268953"
		}
		return Drama{SeriesID: fmt.Sprintf("7690163276214%06d", i+100), Vid: "7690223053078268953", VidList: vids, Title: fmt.Sprintf("测试短剧%03d", i+1), Intro: "这是用于检查电视遥控器焦点和滚动位置的简介。", EpisodeCount: 80, Score: "8.9", Tags: []string{"都市", "逆袭"}, Cover: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='280'><rect width='200' height='280' fill='%233b4b69'/></svg>"}
	}
	// Use the HTTP-facing library shape directly, keeping this fixture independent of disk.
	entries := []map[string]any{}
	for i := 0; i < 70; i++ {
		entries = append(entries, map[string]any{"drama": drama(i), "last_played_at": time.Now().UnixMilli() - int64(i*1000), "favorite_at": time.Now().UnixMilli() - int64(i*1000), "liked_at": time.Now().UnixMilli() - int64(i*1000), "episode": 4, "position": 15, "duration": 60})
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/account", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"logged_in": true, "profile": map[string]any{"uid": "fixture", "name": "测试账号"}, "sync": map[string]any{"state": "idle"}}})
	})
	mux.HandleFunc("/api/v1/library", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"owner_id": "fixture", "entries": entries}})
	})
	mux.HandleFunc("/api/v1/reservation", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]any{"ok": true}) })
	mux.HandleFunc("/fixture/requests", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Query().Get("fail_new") == "1" {
			failNew = true
		}
		writeJSON(w, 200, calls)
	})
	mux.HandleFunc("/api/v1/", func(w http.ResponseWriter, r *http.Request) {
		offset := parseQueryInt(r, "offset")
		q := r.URL.Query()
		mu.Lock()
		calls = append(calls, r.URL.Path+"?"+r.URL.RawQuery)
		fail := r.URL.Path == "/api/v1/lists/new" && offset >= 20 && failNew
		if fail {
			failNew = false
		}
		mu.Unlock()
		if fail {
			writeError(w, 502, "测试网络断开，请重试")
			return
		}
		if q.Get("q") == "慢" {
			time.Sleep(700 * time.Millisecond)
		}
		if r.URL.Path == "/api/v1/status" {
			writeJSON(w, 200, map[string]any{"ok": true})
			return
		}
		if r.URL.Path == "/api/v1/comments" {
			offset, _ = strconv.Atoi(q.Get("cursor"))
			items := []DiscussionItem{}
			for i := offset; i < offset+20 && i < 70; i++ {
				items = append(items, DiscussionItem{CommentID: strconv.Itoa(i + 1), Text: fmt.Sprintf("测试评论 %d：滚动加载时保持焦点和原有列表。", i+1), Author: "测试观众", Likes: i})
			}
			writeJSON(w, 200, map[string]any{"ok": true, "data": DiscussionResult{Items: items, HasMore: offset+20 < 70, NextCursor: strconv.Itoa(offset + 20), Total: 70}})
			return
		}
		if r.URL.Path == "/api/v1/danmaku" {
			start, _ := strconv.ParseInt(q.Get("start"), 10, 64)
			writeJSON(w, 200, map[string]any{"ok": true, "data": DiscussionResult{Items: []DiscussionItem{{CommentID: "fixture-danmaku", Text: "测试弹幕", OffsetMS: start + 1000}}, WindowEnd: start + 30000}})
			return
		}
		if r.URL.Path == "/api/v1/play/info" {
			writeError(w, 502, "测试不播放媒体")
			return
		}
		if r.URL.Path == "/api/v1/series/detail" {
			d := drama(0)
			d.SeriesID = q.Get("series_id")
			writeJSON(w, 200, map[string]any{"ok": true, "data": d})
			return
		}
		out := ListResult{CategoryResult: CategoryResult{Items: []Drama{}, HasMore: offset+20 < 70, NextOffset: offset + 20, SessionID: "fixture-session"}, Ranks: ranks, Calendar: &CalendarSchema{Dates: []string{"20261006", "20261007", "20261008"}, DefaultDate: "20261007", CurrentDate: "20261007"}}
		out.Filters = []CategoryFilterRow{{Type: "genre", Label: "形式", Options: []CategoryFilterOption{{ID: "short_play", Label: "真人剧"}, {ID: "comic_series", Label: "漫剧"}, {ID: "ai_series", Label: "AI剧"}}}, {Type: "sort", Label: "排序", Options: []CategoryFilterOption{{ID: "hot_score", Label: "最热门"}, {ID: "online_time", Label: "最新"}}}}
		for i := offset; i < offset+20 && i < 70; i++ {
			d := drama(i)
			if q.Get("q") != "" {
				d.Title = q.Get("q") + d.Title
				out.Source = "app"
				out.SearchID = "fixture-search"
				out.Passback = "fixture-passback"
			}
			if r.URL.Path == "/api/v1/lists/calendar" || r.URL.Path == "/api/v1/lists/reservations" {
				d.ReservationID = d.SeriesID
				d.PublishText = "预计10月7日上线"
				d.Upcoming = q.Get("mode") == "upcoming" || i%2 == 0
				d.Reserved = r.URL.Path == "/api/v1/lists/reservations"
			}
			if q.Get("rank") == "ranklist_celebrity" {
				d.ActorID = strconv.Itoa(i + 100)
				d.SeriesID = "actor-" + d.ActorID
				d.Title = "测试演员" + strconv.Itoa(i)
			}
			out.Items = append(out.Items, d)
		}
		writeJSON(w, 200, map[string]any{"ok": true, "data": out})
	})
	mux.Handle("/", http.FileServer(http.Dir("ui")))
	t.Log("list fixture http://127.0.0.1:18797/")
	t.Fatal(http.ListenAndServe("127.0.0.1:18797", mux))
}
