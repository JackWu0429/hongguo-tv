package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestVideoLikeWireAndConfirmation(t *testing.T) {
	for _, value := range []bool{true, false} {
		for _, code := range []string{"0", "101045", "101046", "100103", "missing", "nested"} {
			t.Run(fmt.Sprint(value, "/", code), func(t *testing.T) {
				c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
					if r.Method != "POST" || r.URL.Path != "/novel/articleapi/do_action/v1/" || r.Header.Get("X-Tt-Token") != "fixture-token" || r.Header.Get("X-Gorgon") == "" {
						t.Error("wrong authenticated endpoint")
					}
					var body map[string]any
					d := json.NewDecoder(r.Body)
					d.UseNumber()
					d.Decode(&body)
					biz, _ := asMap(body["business_param"])
					shark, _ := asMap(biz["shark_param"])
					action := 4
					if value {
						action = 3
					}
					if asInt(body["action_category"]) != 1 || asInt(body["object_type"]) != 6 || asInt(body["action_type"]) != action || body["object_id"] != fixtureVideo || body["action_reason_remark"] != "like_click" || biz["video_id"] != fixtureSeries || asString(biz["book_id"]) != "0" || biz["has_aigc_content"] != false || asInt(biz["modify_count"]) != 0 || shark["enter_from"] != "MainFragmentActivity" {
						t.Error("wrong video like protocol")
					}
					if code == "missing" {
						ioJSON(w, `{"data":{}}`)
					} else if code == "nested" {
						ioJSON(w, `{"code":0,"data":{"error_code":100103}}`)
					} else {
						ioJSON(w, `{"code":`+code+`,"data":{}}`)
					}
				})
				defer close()
				c.session.Token = "fixture-token"
				err := c.SetVideoLike(context.Background(), fixtureSeries, fixtureVideo, value)
				accepted := code == "0" || code == "101045" || code == "101046"
				if (err == nil) != accepted {
					t.Fatal("unconfirmed response acknowledged", err)
				}
			})
		}
	}
}

func TestLikePagesDeduplicateEpisodesAndValidateWholeSnapshot(t *testing.T) {
	for _, mode := range []string{"ok", "empty", "missing", "bad", "loop", "identity", "incomplete"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
				q := r.URL.Query()
				if r.Method != "GET" || r.URL.Path != "/reading/ugc/action/mget/v" || q.Get("object_type_list") != "6,15,10" || q.Get("action_type") != "3" || q.Get("count") != "100" {
					t.Error("wrong list query")
				}
				if mode == "ok" && q.Get("offset") != fmt.Sprint(calls*100) {
					t.Error("incorrect fallback cursor")
				}
				calls++
				if mode == "empty" {
					ioJSON(w, `{"code":0,"data":{"mixed_data_list":null,"has_more":false}}`)
					return
				}
				if mode == "missing" {
					ioJSON(w, `{"code":0,"data":{"has_more":false}}`)
					return
				}
				if mode == "bad" {
					ioJSON(w, `{"code":0,"data":{"mixed_data_list":{},"has_more":false}}`)
					return
				}
				if mode == "incomplete" {
					ioJSON(w, `{"code":0,"data":{"mixed_data_list":null,"has_more":true}}`)
					return
				}
				identity := fixtureSeries
				if mode == "identity" {
					identity = "111"
				}
				vid := fixtureVideo
				if mode == "ok" && calls == 2 {
					vid = "7690223053078268954"
				}
				index := calls
				if mode == "loop" {
					index = 1
				}
				row := fmt.Sprintf(`{"video_data":{"series_id":%s,"vid":%s,"vid_index":%d,"user_digg_timestamp_ms":1700000000000,"cover":"https://example.com/poster.jpg","episode_cnt":80,"video_detail":{"series_id_str":%q,"series_title":"第一季","season_index":1}}}`, fixtureSeries, vid, index, identity)
				more := mode == "loop" || mode == "ok" && calls == 1
				ioJSON(w, fmt.Sprintf(`{"code":0,"data":{"mixed_data_list":[%s,%s,{"other_data":{}}],"has_more":%t,"next_offset":0}}`, row, row, more))
			})
			defer close()
			rows, err := c.pullLikes(context.Background())
			if mode == "ok" {
				if err != nil || len(rows) != 1 || len(rows[0].LikedVideos) != 2 || rows[0].Drama.SeasonIndex != 1 || rows[0].LikedAt != 1700000000000 {
					t.Fatal("lost per-video membership", err)
				}
			} else if mode == "empty" {
				if err != nil || len(rows) != 0 {
					t.Fatal("valid empty rejected", err)
				}
			} else if err == nil || rows != nil || calls > 2 {
				t.Fatal("partial snapshot accepted", err)
			}
		})
	}
}

func TestConfirmedLikePersistsPerEpisodeAndFailureDoesNotChange(t *testing.T) {
	fail := false
	m := loggedFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/novel/articleapi/do_action/v1/" {
			if fail {
				ioJSON(w, `{"code":100103,"data":{}}`)
			} else {
				ioJSON(w, `{"code":0,"data":{}}`)
			}
			return
		}
		accountFixtureResponse(w, r.URL.Path, false)
	})
	owner := m.store.snapshot().OwnerID
	on, off := true, false
	change := LibraryChange{OwnerID: &owner, Action: "like", Drama: Drama{SeriesID: fixtureSeries, Title: "测试剧"}, VideoID: fixtureVideo, Episode: 1, Value: &on}
	first, err := m.changeVideoLike(context.Background(), change)
	if err != nil || len(first.Entries) != 1 || len(first.Entries[0].LikedVideos) != 1 || len(first.Cloud.Pending) != 0 {
		t.Fatal("confirmed like not persisted", err)
	}
	change.VideoID = "7690223053078268954"
	change.Episode = 2
	second, err := m.changeVideoLike(context.Background(), change)
	if err != nil || len(second.Entries[0].LikedVideos) != 2 {
		t.Fatal("second episode replaced first", err)
	}
	change.VideoID = fixtureVideo
	change.Episode = 1
	change.Value = &off
	fail = true
	if _, err = m.changeVideoLike(context.Background(), change); !errors.Is(err, errVideoLikeUpstream) || len(m.librarySnapshot().Entries[0].LikedVideos) != 2 {
		t.Fatal("failed write changed local state", err)
	}
	fail = false
	third, err := m.changeVideoLike(context.Background(), change)
	if err != nil || len(third.Entries[0].LikedVideos) != 1 || third.Entries[0].LikedVideos[0].Episode != 2 {
		t.Fatal("cancel removed wrong episode", err)
	}
	reopened, err := newLibraryStore(filepath.Dir(m.store.path))
	if err != nil || len(reopened.snapshot().Entries[0].LikedVideos) != 1 {
		t.Fatal("like lost on restart", err)
	}
}

func TestLikeLateAccountReplyAndGuestCannotPopulateCurrentLibrary(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	m := loggedFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/novel/articleapi/do_action/v1/" {
			close(started)
			<-release
			ioJSON(w, `{"code":0,"data":{}}`)
			return
		}
		accountFixtureResponse(w, r.URL.Path, false)
	})
	owner := m.store.snapshot().OwnerID
	on := true
	change := LibraryChange{OwnerID: &owner, Action: "like", Drama: Drama{SeriesID: fixtureSeries, Title: "测试剧"}, VideoID: fixtureVideo, Episode: 1, Value: &on}
	done := make(chan error, 1)
	go func() { _, err := m.changeVideoLike(context.Background(), change); done <- err }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("request not started")
	}
	if err := m.logout(); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; !errors.Is(err, errAccountChanged) || len(m.librarySnapshot().Entries) != 0 {
		t.Fatal("late previous account response accepted", err)
	}
	if _, err := m.changeVideoLike(context.Background(), change); !errors.Is(err, errListLogin) {
		t.Fatal("guest write accepted", err)
	}
}

func TestLikesCloudMergePreservesHistoryAndHiddenRows(t *testing.T) {
	s, err := newLibraryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s.data.OwnerID = "123456789"
	s.data.Entries = []LibraryEntry{{Drama: Drama{SeriesID: fixtureSeries, Title: "已看"}, LastPlayedAt: 123, Episode: 7, FavoriteAt: 456, LikedAt: 789}, {Drama: Drama{SeriesID: "111", Title: "本机隐藏"}, LikedAt: 789}}
	s.data.Cloud = &cloudLibraryState{Hidden: map[string]int64{"likes:111": 123}}
	remote := []LibraryEntry{{Drama: Drama{SeriesID: fixtureSeries, Title: "已看"}, LikedAt: 900, LikedVideos: []LikedVideo{{VideoID: fixtureVideo, Episode: 1, LikedAt: 900}}}, {Drama: Drama{SeriesID: "111", Title: "隐藏"}, LikedAt: 900}}
	if err = s.mergeLikes(remote); err != nil {
		t.Fatal(err)
	}
	rows := s.snapshot().Entries
	if len(rows) != 1 || rows[0].LastPlayedAt != 123 || rows[0].Episode != 7 || rows[0].FavoriteAt != 456 || len(rows[0].LikedVideos) != 1 {
		t.Fatal("likes merge damaged unrelated records")
	}
	if err = s.mergeCloud([]LibraryEntry{{Drama: rows[0].Drama, LastPlayedAt: 999, Episode: 9}}, 0); err != nil {
		t.Fatal(err)
	}
	if len(s.snapshot().Entries[0].LikedVideos) != 1 {
		t.Fatal("history sync erased episode likes")
	}
	if err = s.mergeLikes(nil); err != nil {
		t.Fatal(err)
	}
	if rows = s.snapshot().Entries; len(rows) != 1 || rows[0].LikedAt != 0 || len(rows[0].LikedVideos) != 0 || rows[0].LastPlayedAt != 999 {
		t.Fatal("remote empty must clear only likes")
	}
}

func TestInFlightCloudSnapshotCannotEraseConfirmedLike(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/reading/bookapi/read_history/list/v":
			ioJSON(w, `{"code":0,"data":{"data_list":[],"has_more":false}}`)
		case "/reading/bookapi/bookshelf/video/list/v":
			ioJSON(w, `{"code":0,"data":{"video_shelf_info":[]}}`)
		case "/reading/ugc/action/mget/v":
			close(started)
			<-release
			ioJSON(w, `{"code":0,"data":{"mixed_data_list":null,"has_more":false}}`)
		case "/novel/articleapi/do_action/v1/":
			ioJSON(w, `{"code":0,"data":{}}`)
		default:
			accountFixtureResponse(w, r.URL.Path, false)
		}
	})
	if err := m.sendCode(context.Background(), "13800000000"); err != nil {
		t.Fatal(err)
	}
	if err := m.loginSMS(context.Background(), "13800000000", "123456"); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { m.synchronize(context.Background()); close(done) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("sync not started")
	}
	owner := m.store.snapshot().OwnerID
	on := true
	_, err := m.changeVideoLike(context.Background(), LibraryChange{OwnerID: &owner, Action: "like", Drama: Drama{SeriesID: fixtureSeries, Title: "新点赞"}, VideoID: fixtureVideo, Episode: 1, Value: &on})
	close(release)
	<-done
	rows := m.librarySnapshot().Entries
	if err != nil || len(rows) != 1 || len(rows[0].LikedVideos) != 1 || m.status().Sync.Error != "" {
		t.Fatal("old cloud snapshot overwrote confirmed like", err)
	}
}
