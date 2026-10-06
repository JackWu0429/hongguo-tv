package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const fixtureSeries = "7690163276214176792"
const fixtureVideo = "7690163276214176793"

func loggedFixture(t *testing.T, h http.HandlerFunc) *accountManager {
	t.Helper()
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/passport/") || r.URL.Path == "/reading/user/info/v1/" {
			accountFixtureResponse(w, r.URL.Path, false)
			return
		}
		h(w, r)
	})
	if err := m.sendCode(context.Background(), "13800000000"); err != nil {
		t.Fatal(err)
	}
	if err := m.loginSMS(context.Background(), "13800000000", "123456"); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestCloudPullAndPushWireShapes(t *testing.T) {
	var historyUpdates, progressUpdates, favoriteUpdates atomic.Int32
	m := loggedFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Tt-Token") == "" {
			t.Error("missing session token")
		}
		switch r.URL.Path {
		case "/reading/bookapi/read_history/list/v":
			if r.URL.Query().Get("book_type") != "2" {
				t.Error("history book type")
			}
			ioJSON(w, `{"code":0,"data":{"data_list":[{"book_id_str":"7690163276214176792","book_name":"云端剧","vid":"7690163276214176793","vid_index":7,"current_play_position":12500,"read_timestamp_ms":1700000000000,"episode_cnt":80}],"has_more":false}}`)
		case "/reading/bookapi/bookshelf/video/list/v":
			ioJSON(w, `{"code":0,"data":{"video_shelf_info":[{"series_id":"7690163276214176792"}]}}`)
		case "/reading/bookapi/read_progress/get/v":
			var body map[string]any
			d := json.NewDecoder(r.Body)
			d.UseNumber()
			_ = d.Decode(&body)
			ids := body["book_ids"].(map[string]any)["2"].([]any)
			if len(ids) != 1 || asString(ids[0]) != fixtureSeries {
				t.Error("numeric ID lost precision")
			}
			ioJSON(w, `{"code":0,"video_data":[{"series_id":"7690163276214176792","vid_index":7,"episode_count":80,"last_watch_time":1700000000}]}`)
		case "/reading/bookapi/read_history/update/v", "/reading/bookapi/read_progress/upload/v", "/reading/bookapi/bookshelf/video/update/v":
			var body map[string]any
			d := json.NewDecoder(r.Body)
			d.UseNumber()
			_ = d.Decode(&body)
			if rows, ok := body["update_datas"].([]any); ok {
				historyUpdates.Add(1)
				row := rows[0].(map[string]any)
				if asString(row["book_id"]) != fixtureSeries || asString(row["vid"]) != fixtureVideo || asInt(row["vid_index"]) != 8 || asInt(row["current_play_position"]) != 15250 {
					t.Error("history upload ID/index/ms mismatch")
				}
			} else if rows, ok := body["books"].([]any); ok {
				progressUpdates.Add(1)
				row := rows[0].(map[string]any)
				if asString(row["book_id"]) != fixtureSeries || asString(row["item_id"]) != fixtureVideo || asInt(row["current_play_time"]) != 15250 {
					t.Error("progress upload mismatch")
				}
			} else {
				favoriteUpdates.Add(1)
				row := body["update_bookshelf_video_list"].([]any)[0].(map[string]any)
				if asString(row["book_id"]) != fixtureSeries || asInt(row["video_shelf_operate_type"]) != 1 {
					t.Error("favorite cancellation mismatch")
				}
			}
			ioJSON(w, `{"code":0}`)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	})
	m.synchronize(context.Background())
	d := m.librarySnapshot()
	if len(d.Entries) != 1 || d.Entries[0].Episode != 7 || d.Entries[0].Position != 12.5 || d.Entries[0].FavoriteAt == 0 || m.status().Sync.LastSync == 0 {
		t.Fatalf("pull failed: %+v", d)
	}
	owner := m.status().Profile.UID
	if _, err := m.changeLibrary(LibraryChange{OwnerID: &owner, Action: "progress", Drama: d.Entries[0].Drama, Episode: 8, VideoID: fixtureVideo, Position: 15.25, Duration: 90}); err != nil {
		t.Fatal(err)
	}
	no := false
	if _, err := m.changeLibrary(LibraryChange{OwnerID: &owner, Action: "favorite", Drama: d.Entries[0].Drama, Value: &no}); err != nil {
		t.Fatal(err)
	}
	m.synchronize(context.Background())
	d = m.librarySnapshot()
	if d.Entries[0].Episode != 8 || d.Entries[0].FavoriteAt != 0 || len(d.Cloud.Pending) != 0 {
		t.Fatalf("local upload reverted: %+v", d)
	}
	if historyUpdates.Load() != 1 || progressUpdates.Load() != 1 || favoriteUpdates.Load() != 1 {
		t.Fatal("not all mutations acknowledged")
	}
	reloaded, err := newAccountManager(m.dir, m.guest, nil)
	if err != nil || reloaded.status().Sync.LastSync != m.status().Sync.LastSync {
		t.Fatal("last sync not restored")
	}
}

func TestCloudMalformedSnapshotCannotEraseFavoritesOrAck(t *testing.T) {
	m := loggedFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "read_history/list") {
			ioJSON(w, `{"code":0,"data":{"data_list":[],"has_more":false}}`)
		} else {
			ioJSON(w, `{"code":0,"data":{}}`)
		}
	})
	owner := m.status().Profile.UID
	yes := true
	_, _ = m.changeLibrary(LibraryChange{OwnerID: &owner, Action: "favorite", Drama: Drama{SeriesID: fixtureSeries, Title: "收藏"}, Value: &yes})
	m.synchronize(context.Background())
	d := m.librarySnapshot()
	if d.Entries[0].FavoriteAt == 0 || len(d.Cloud.Pending) != 1 || m.status().Sync.LastSync != 0 || m.status().Sync.Error == "" {
		t.Fatal("partial snapshot caused false success/data loss")
	}
}

func TestCloudRemoteNewerProgressSupersedesOnlyStaleMutation(t *testing.T) {
	s, _ := newLibraryStore(t.TempDir())
	s.data.OwnerID = "123456789"
	drama := Drama{SeriesID: fixtureSeries, Title: "进度冲突"}
	yes := true
	_, _ = s.apply(LibraryChange{Action: "progress", Drama: drama, Episode: 2, VideoID: fixtureVideo, Position: 30})
	_, _ = s.apply(LibraryChange{Action: "favorite", Drama: drama, Value: &yes})
	stamp := s.snapshot().Entries[0].LastPlayedAt
	if err := s.mergeCloud([]LibraryEntry{{Drama: drama, Episode: 5, Position: 10, LastPlayedAt: stamp + 1000}}, 0); err != nil {
		t.Fatal(err)
	}
	d := s.snapshot()
	if d.Entries[0].Episode != 5 || len(d.Cloud.Pending) != 1 || d.Cloud.Pending[0].Kind != "favorite" || d.Entries[0].FavoriteAt == 0 {
		t.Fatal("conflict reconciliation damaged other changes")
	}
	// A new save created during a pull must survive an older remote snapshot.
	_, _ = s.apply(LibraryChange{Action: "progress", Drama: drama, Episode: 6, VideoID: fixtureVideo, Position: 8})
	if err := s.mergeCloud([]LibraryEntry{{Drama: drama, Episode: 4, LastPlayedAt: stamp - 1}}, 0); err != nil {
		t.Fatal(err)
	}
	if s.snapshot().Entries[0].Episode != 6 || len(s.snapshot().Cloud.Pending) != 2 {
		t.Fatal("older snapshot replaced fresh local save")
	}
}

func TestCloudLogoutDuringPullDoesNotRestoreAccount(t *testing.T) {
	entered := make(chan struct{})
	m := loggedFixture(t, func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
	})
	done := make(chan struct{})
	go func() { defer close(done); m.synchronize(context.Background()) }()
	<-entered
	if err := m.logout(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("logout did not cancel sync")
	}
	if m.status().LoggedIn || m.librarySnapshot().OwnerID != "" || m.status().Sync.State != "local" {
		t.Fatal("late sync restored account")
	}
}

func TestCloudPersistenceFailureKeepsQueueAndLocalState(t *testing.T) {
	s, _ := newLibraryStore(t.TempDir())
	s.data.OwnerID = "123456789"
	yes := true
	_, _ = s.apply(LibraryChange{Action: "favorite", Drama: Drama{SeriesID: fixtureSeries, Title: "持久化"}, Value: &yes})
	before := s.snapshot()
	blocker := filepath.Join(filepath.Dir(s.path), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("block"), 0600); err != nil {
		t.Fatal(err)
	}
	s.path = filepath.Join(blocker, "library.json")
	if err := s.ackCloud(before.Cloud.Pending[0].Sequence); err == nil {
		t.Fatal("ack persistence failure ignored")
	}
	if err := s.markCloudSynced(1); err == nil {
		t.Fatal("sync persistence failure ignored")
	}
	if len(s.snapshot().Cloud.Pending) != 1 || s.snapshot().Cloud.LastSync != 0 {
		t.Fatal("memory published failed write")
	}
}

func TestCloudNestedErrorIsNotAcknowledged(t *testing.T) {
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { ioJSON(w, `{"code":0,"data":{"error_code":401}}`) }))
	defer remote.Close()
	c := newPassportClient(accountSession{DeviceID: "123", InstallID: "456"})
	c.base = remote.URL
	c.http = remote.Client()
	if _, err := c.cloudJSON(context.Background(), "/update", http.MethodPost, nil, map[string]any{}); err == nil {
		t.Fatal("nested failure accepted")
	}
}

func TestAccountRejectsReboundHostname(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "http://rebound.example:8797/api/v1/account/login", nil)
	r.RemoteAddr = "127.0.0.1:4000"
	r.Header.Set("Origin", "http://rebound.example:8797")
	if privateLocalRequest(r) {
		t.Fatal("non-loopback Host accepted")
	}
}

func TestAccountExpiredIdentityCannotMergeCloud(t *testing.T) {
	for _, payload := range []string{`{"code":0,"data":{"user_id":0}}`, `{"code":0,"data":{}}`, `{"code":0,"data":{"user_id_str":"987654321"}}`} {
		var response map[string]any
		_ = json.Unmarshal([]byte(payload), &response)
		if err := validateAccountIdentity(response, "123456789"); err == nil {
			t.Fatalf("invalid identity accepted: %s", payload)
		}
	}
}
