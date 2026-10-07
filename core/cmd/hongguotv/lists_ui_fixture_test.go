package main

// Opt-in TV browser fixture: no SMS, cloud writes, media downloads or production account.
import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestListsBrowserFixture(t *testing.T) {
	browseFixture := os.Getenv("HONGGUO_BROWSE_UI_FIXTURE") == "1"
	seriesFixture := os.Getenv("HONGGUO_SERIES_UI_FIXTURE") == "1"
	likesFixture := os.Getenv("HONGGUO_LIKES_UI_FIXTURE") == "1"
	playerFixture := os.Getenv("HONGGUO_PLAYER_UI_FIXTURE") == "1" || seriesFixture || likesFixture
	if os.Getenv("HONGGUO_LISTS_UI_FIXTURE") != "1" && !playerFixture {
		t.Skip("isolated UI fixture")
	}
	var mu sync.Mutex
	calls := []string{}
	var failNew bool
	var failQuality bool
	var guest bool
	var failLike bool
	likeWrites := []LibraryChange{}
	var failSeries, emptySeries, slowDetail, failDetail, failReservation, upcomingNext, skipUpcoming bool
	var reservations []map[string]any
	var progress []map[string]any
	reserved := false
	writes := []PlayerAction{}
	deleted := map[string]bool{}
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
			if likesFixture {
				vids[j] = fmt.Sprintf("769022305307826%04d", 8953+j)
			}
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
		mu.Lock()
		defer mu.Unlock()
		if guest {
			writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"logged_in": false, "sync": map[string]any{"state": "idle"}}})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"logged_in": true, "profile": map[string]any{"uid": "fixture", "name": "测试账号"}, "sync": map[string]any{"state": "idle"}}})
	})
	mux.HandleFunc("/api/v1/library", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if (seriesFixture || likesFixture) && r.Method == http.MethodPost {
			var action map[string]any
			if err := json.NewDecoder(r.Body).Decode(&action); err != nil {
				writeError(w, 400, err.Error())
				return
			}
			if likesFixture && asString(action["action"]) == "like" {
				b, _ := json.Marshal(action)
				var change LibraryChange
				json.Unmarshal(b, &change)
				likeWrites = append(likeWrites, change)
				if guest {
					writeError(w, 401, "请先登录红果账号")
					return
				}
				if failLike {
					failLike = false
					writeError(w, 502, "红果未确认点赞操作")
					return
				}
				if change.Value == nil || !validID(change.VideoID) || change.Episode < 1 {
					writeError(w, 400, "缺少当前播放集")
					return
				}
				for _, e := range entries {
					if e["drama"].(Drama).SeriesID != change.Drama.SeriesID {
						continue
					}
					videos, _ := e["liked_videos"].([]LikedVideo)
					kept := []LikedVideo{}
					for _, v := range videos {
						if v.VideoID != change.VideoID {
							kept = append(kept, v)
						}
					}
					if *change.Value {
						kept = append(kept, LikedVideo{VideoID: change.VideoID, Episode: change.Episode, LikedAt: time.Now().UnixMilli()})
					}
					e["liked_videos"] = kept
					e["liked_at"] = 0
					if len(kept) > 0 {
						e["liked_at"] = kept[0].LikedAt
					}
				}
			}
			if asString(action["action"]) == "progress" {
				progress = append(progress, action)
				if d, ok := asMap(action["drama"]); ok {
					id := asString(d["series_id"])
					for i, e := range entries {
						if asString(e["drama"].(Drama).SeriesID) == id {
							entries[i]["episode"] = action["episode"]
							entries[i]["position"] = action["position"]
							entries[i]["duration"] = action["duration"]
							entries[i]["last_played_at"] = time.Now().UnixMilli()
							entries[i]["completed"] = action["completed"]
						}
					}
				}
			}
		}
		writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"owner_id": func() string {
			if guest {
				return ""
			}
			return "fixture"
		}(), "entries": entries}})
	})
	mux.HandleFunc("/api/v1/reservation", func(w http.ResponseWriter, r *http.Request) {
		if seriesFixture {
			var action map[string]any
			json.NewDecoder(r.Body).Decode(&action)
			mu.Lock()
			reservations = append(reservations, action)
			fail := failReservation
			failReservation = false
			mu.Unlock()
			select {
			case <-r.Context().Done():
				return
			case <-time.After(200 * time.Millisecond):
			}
			if fail {
				writeError(w, 502, "测试预约失败")
				return
			}
			mu.Lock()
			reserved = asBool(action["reserved"])
			mu.Unlock()
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	if seriesFixture {
		mux.HandleFunc("/fixture/series/state", func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			q := r.URL.Query()
			if q.Has("skip_upcoming") {
				skipUpcoming = q.Get("skip_upcoming") == "1"
			}
			if q.Has("upcoming_next") {
				upcomingNext = q.Get("upcoming_next") == "1"
			}
			if q.Has("fail_series") {
				failSeries = q.Get("fail_series") == "1"
			}
			if q.Has("empty_series") {
				emptySeries = q.Get("empty_series") == "1"
			}
			if q.Has("slow_detail") {
				slowDetail = q.Get("slow_detail") == "1"
			}
			if q.Has("fail_detail") {
				failDetail = q.Get("fail_detail") == "1"
			}
			if q.Has("fail_reservation") {
				failReservation = q.Get("fail_reservation") == "1"
			}
			if q.Has("guest") {
				guest = q.Get("guest") == "1"
			}
			writeJSON(w, 200, map[string]any{"calls": calls, "reservations": reservations, "progress": progress, "reserved": reserved})
		})
		mux.HandleFunc("/api/v1/series/seasons", func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			calls = append(calls, r.URL.String())
			fail, empty, res := failSeries, emptySeries, reserved
			failSeries = false
			mu.Unlock()
			select {
			case <-r.Context().Done():
				return
			case <-time.After(250 * time.Millisecond):
			}
			if fail {
				writeError(w, 502, "测试系列剧读取失败")
				return
			}
			items := []SeriesSeason{}
			if !empty {
				for season := 1; season <= 16; season++ {
					d := drama(season)
					if season == 13 {
						d = drama(0)
					}
					d.Title = fmt.Sprintf("测试系列第%d季", season)
					d.SeasonIndex = season
					d.MultiSeason = true
					item := SeriesSeason{Drama: d, Label: fmt.Sprintf("第%d季", season), Subtitle: "4375万热度", Playable: season <= 13}
					if season == 14 || season == 16 {
						item.Upcoming = true
						item.Vid = ""
						item.VidList = nil
						item.EpisodeCount = 0
						item.Subtitle = "预计11月上线"
					}
					if season == 14 {
						item.ReservationID = "7691518344146455577"
						item.Reserved = res
					}
					items = append(items, item)
				}
			}
			writeJSON(w, 200, map[string]any{"ok": true, "data": SeriesSeasonsResult{Items: items}})
		})
	}
	mux.HandleFunc("/fixture/requests", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Query().Get("fail_new") == "1" {
			failNew = true
		}
		writeJSON(w, 200, calls)
	})
	if playerFixture {
		mux.HandleFunc("/fixture/player/state", func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			if r.URL.Query().Get("fail_quality") == "1" {
				failQuality = true
			}
			if r.URL.Query().Get("guest") != "" {
				guest = r.URL.Query().Get("guest") == "1"
			}
			if r.URL.Query().Get("fail_like") == "1" {
				failLike = true
			}
			writeJSON(w, 200, map[string]any{"writes": writes, "calls": calls, "like_writes": likeWrites})
		})
		mux.HandleFunc("/api/v1/player/action", func(w http.ResponseWriter, r *http.Request) {
			var a PlayerAction
			dec := json.NewDecoder(r.Body)
			dec.DisallowUnknownFields()
			if err := dec.Decode(&a); err != nil {
				writeError(w, 400, err.Error())
				return
			}
			if err := a.validate(); err != nil {
				writeError(w, 400, err.Error())
				return
			}
			mu.Lock()
			isGuest := guest
			writes = append(writes, a)
			mu.Unlock()
			if isGuest {
				writeError(w, 401, "请先登录红果账号")
				return
			}
			if a.Text == "失败" {
				writeError(w, 502, "测试发送失败，输入仍保留")
				return
			}
			if a.Text == "延迟" {
				select {
				case <-r.Context().Done():
					return
				case <-time.After(700 * time.Millisecond):
				}
			}
			if a.Action == "comment-delete" {
				mu.Lock()
				deleted[a.CommentID] = true
				mu.Unlock()
			}
			writeJSON(w, 200, map[string]any{"ok": true, "data": DiscussionItem{CommentID: "7691344565400093503", Text: a.Text, Own: true}})
		})
		mux.HandleFunc("/fixture-media.mp4", func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, os.Getenv("HONGGUO_PLAYER_FIXTURE_MEDIA"))
		})
	}
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
		if browseFixture && r.URL.Path == "/api/v1/category" && q.Get("sort") == "online_time" {
			time.Sleep(500 * time.Millisecond) // Let a later selection win.
		}
		if r.URL.Path == "/api/v1/status" {
			writeJSON(w, 200, map[string]any{"ok": true})
			return
		}
		if r.URL.Path == "/api/v1/comments" {
			offset, _ = strconv.Atoi(q.Get("cursor"))
			items := []DiscussionItem{}
			for i := offset; i < offset+20 && i < 70; i++ {
				mu.Lock()
				removed := deleted[strconv.Itoa(i+1)]
				mu.Unlock()
				if removed {
					continue
				}
				items = append(items, DiscussionItem{CommentID: strconv.Itoa(i + 1), Text: fmt.Sprintf("测试评论 %d：滚动加载时保持焦点和原有列表。", i+1), Author: "测试观众", Likes: i, Replies: 2, Own: i == 0, Created: time.Now().Unix() - 86400})
			}
			writeJSON(w, 200, map[string]any{"ok": true, "data": DiscussionResult{Items: items, HasMore: offset+20 < 70, NextCursor: strconv.Itoa(offset + 20), Total: 70}})
			return
		}
		if r.URL.Path == "/api/v1/replies" && playerFixture {
			offset, _ := strconv.Atoi(q.Get("cursor"))
			items := []DiscussionItem{}
			for i := offset; i < offset+20 && i < 35; i++ {
				items = append(items, DiscussionItem{CommentID: strconv.Itoa(i + 101), Text: fmt.Sprintf("回复 %d", i+1), Author: "回复观众"})
			}
			writeJSON(w, 200, map[string]any{"ok": true, "data": DiscussionResult{Items: items, HasMore: offset+20 < 35, NextCursor: strconv.Itoa(offset + 20), Total: 35}})
			return
		}
		if r.URL.Path == "/api/v1/danmaku" {
			start, _ := strconv.ParseInt(q.Get("start"), 10, 64)
			writeJSON(w, 200, map[string]any{"ok": true, "data": DiscussionResult{Items: []DiscussionItem{{CommentID: "fixture-danmaku", Text: "测试弹幕", OffsetMS: start + 1000}}, WindowEnd: start + 30000}})
			return
		}
		if r.URL.Path == "/api/v1/play/info" {
			if playerFixture {
				mu.Lock()
				fail := failQuality && q.Get("quality") == "1080P"
				if fail {
					failQuality = false
				}
				mu.Unlock()
				if q.Get("quality") != "" {
					select {
					case <-r.Context().Done():
						return
					case <-time.After(700 * time.Millisecond):
					}
				}
				if fail {
					writeError(w, 502, "测试清晰度切换失败")
					return
				}
				quality := firstNonEmpty(q.Get("quality"), "720P")
				writeJSON(w, 200, map[string]any{"ok": true, "data": PlayInfo{Path: "/fixture-media.mp4?quality=" + quality, Quality: quality, Qualities: []string{"480P", "720P", "1080P"}, Vid: q.Get("vid")}})
				return
			}
			writeError(w, 502, "测试不播放媒体")
			return
		}
		if seriesFixture && r.URL.Path == "/api/v1/series/next-season" {
			mu.Lock()
			upcoming := upcomingNext
			skip := skipUpcoming
			mu.Unlock()
			if skip {
				d := drama(15)
				d.SeasonIndex = 15
				writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"current_season": 13, "next": d}})
				return
			}
			if upcoming {
				writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"current_season": 13, "next": nil}})
				return
			}
			season := 13
			for n := 1; n <= 12; n++ {
				if drama(n).SeriesID == q.Get("series_id") {
					season = n
				}
			}
			var next *Drama
			if season < 13 {
				d := drama(season + 1)
				if season+1 == 13 {
					d = drama(0)
				}
				d.Title = fmt.Sprintf("测试系列第%d季", season+1)
				d.SeasonIndex = season + 1
				next = &d
			}
			writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"current_season": season, "next": next}})
			return
		}
		if r.URL.Path == "/api/v1/series/detail" {
			d := drama(0)
			d.SeriesID = q.Get("series_id")
			if likesFixture {
				for i, vid := range d.VidList {
					d.Episodes = append(d.Episodes, Episode{Index: i + 1, VideoID: vid, Title: fmt.Sprintf("第%d集", i+1), Locked: i >= 3})
				}
			}
			if seriesFixture {
				mu.Lock()
				slow, fail := slowDetail, failDetail
				failDetail = false
				mu.Unlock()
				if slow {
					select {
					case <-r.Context().Done():
						return
					case <-time.After(900 * time.Millisecond):
					}
				}
				if fail {
					writeError(w, 502, "测试季详情失败")
					return
				}
				for season := 1; season <= 13; season++ {
					if drama(season).SeriesID == d.SeriesID || season == 13 && drama(0).SeriesID == d.SeriesID {
						d.Title = fmt.Sprintf("测试系列第%d季", season)
						d.SeasonIndex = season
					}
				}
				d.MultiSeason = true
				for i, vid := range d.VidList {
					d.Episodes = append(d.Episodes, Episode{Index: i + 1, VideoID: vid})
				}
			}
			writeJSON(w, 200, map[string]any{"ok": true, "data": d})
			return
		}
		out := ListResult{CategoryResult: CategoryResult{Items: []Drama{}, HasMore: offset+20 < 70, NextOffset: offset + 20, SessionID: "fixture-session"}, Ranks: ranks, Calendar: &CalendarSchema{Dates: []string{"20261006", "20261007", "20261008"}, DefaultDate: "20261007", CurrentDate: "20261007"}}
		out.Filters = []CategoryFilterRow{{Type: "genre", Label: "形式", Options: []CategoryFilterOption{{ID: "short_play", Label: "真人剧"}, {ID: "comic_series", Label: "漫剧"}, {ID: "ai_series", Label: "AI剧"}}}, {Type: "sort", Label: "排序", Options: []CategoryFilterOption{{ID: "hot_score", Label: "最热门"}, {ID: "online_time", Label: "最新"}}}}
		if browseFixture {
			out.Filters[1].Options = append(out.Filters[1].Options, CategoryFilterOption{ID: "hot_collect", Label: "最高收藏"})
			out.Filters = append(out.Filters, CategoryFilterRow{Type: "category_dim_theme", Label: "主题", Options: []CategoryFilterOption{{ID: "cate_165", Label: "悬疑"}}})
			if q.Get("selectors") != "1" {
				out.Filters = nil
			}
		}
		for i := offset; i < offset+20 && i < 70; i++ {
			d := drama(i)
			if browseFixture && r.URL.Path == "/api/v1/category" {
				d.Title = q.Get("genre") + "/" + q.Get("sort") + "/" + q.Get("category_dim_theme") + ":" + d.Title
			}
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
	addr := "127.0.0.1:18797"
	if playerFixture {
		addr = "127.0.0.1:18897"
	}
	if seriesFixture {
		addr = "127.0.0.1:18997"
	}
	if override := os.Getenv("HONGGUO_UI_FIXTURE_ADDR"); override != "" {
		addr = override
	}
	t.Log("UI fixture http://" + addr + "/")
	t.Fatal(http.ListenAndServe(addr, mux))
}
