package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func importEntry(id string, stamp int64, episode int) LibraryEntry {
	return LibraryEntry{Drama: Drama{SeriesID: id, Title: "测试短剧", EpisodeCount: 50}, VideoID: "123456789", Episode: episode, Position: 17, Duration: 80, LastPlayedAt: stamp, Completed: true}
}
func importStore(t *testing.T) *libraryStore {
	t.Helper()
	s, err := newLibraryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s.data.OwnerID = "123456789"
	return s
}

func TestGuestHistoryConflictAndNoMembershipImport(t *testing.T) {
	for _, tc := range []struct {
		name                  string
		accountStamp          int64
		wantEpisode, imported int
	}{
		{"guest newer", 50, 4, 1}, {"account newer", 150, 2, 0}, {"equal keeps account", 100, 2, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := importStore(t)
			s.data.Entries = []LibraryEntry{importEntry("100000001", tc.accountStamp, 2)}
			s.data.Entries[0].FavoriteAt = 9
			s.data.Entries[0].LikedAt = 8
			s.data.Entries[0].LikedVideos = []LikedVideo{{VideoID: "123456788", LikedAt: 8}}
			source := importEntry("100000001", 100, 4)
			source.FavoriteAt = 99
			source.LikedAt = 98
			guest := LibraryData{Entries: []LibraryEntry{source}}
			before := cloneLibrary(guest)
			r, err := s.mergeGuestHistory(guest)
			if err != nil || r.Imported != tc.imported {
				t.Fatal(r, err)
			}
			got := s.snapshot()
			e := got.Entries[0]
			if e.Episode != tc.wantEpisode || e.LastPlayedAt != max(tc.accountStamp, int64(100)) || e.FavoriteAt != 9 || e.LikedAt != 8 || len(e.LikedVideos) != 1 {
				t.Fatal("incorrect conflict or memberships", e)
			}
			if !reflect.DeepEqual(before, guest) {
				t.Fatal("source mutated")
			}
			if tc.imported == 1 && (len(got.Cloud.Pending) != 1 || got.Cloud.Pending[0].Kind != "progress" || got.Cloud.Pending[0].Entry.LastPlayedAt != 100) {
				t.Fatal("wrong upload timestamp or kind")
			}
		})
	}
}

func TestGuestHistoryDedupAndInvalidProgress(t *testing.T) {
	s := importStore(t)
	valid := importEntry("100000001", 100, 4)
	invalid := importEntry("100000003", 100, 0)
	guest := LibraryData{Entries: []LibraryEntry{importEntry("100000001", 50, 2), valid, importEntry("100000002", 90, 3), invalid, {Drama: Drama{SeriesID: "100000004", Title: "仅收藏"}, FavoriteAt: 99}}}
	guest.Entries[1].FavoriteAt = 88
	r, err := s.mergeGuestHistory(guest)
	if err != nil || r.Imported != 2 || len(s.snapshot().Entries) != 2 {
		t.Fatal(r, err)
	}
	for _, e := range s.snapshot().Entries {
		if e.FavoriteAt != 0 || e.LikedAt != 0 {
			t.Fatal("guest memberships imported")
		}
	}
	if s.snapshot().Entries[0].Episode != 4 {
		t.Fatal("duplicate selected older progress")
	}
}

func TestGuestHistoryRestartDeletionAndNewGuestPlayback(t *testing.T) {
	for _, action := range []string{"remove", "clear"} {
		t.Run(action, func(t *testing.T) {
			s := importStore(t)
			guest := LibraryData{Entries: []LibraryEntry{importEntry("100000001", 100, 4)}}
			if r, err := s.mergeGuestHistory(guest); err != nil || r.Imported != 1 {
				t.Fatal(r, err)
			}
			if err := s.ackCloud(s.snapshot().Cloud.Pending[0].Sequence); err != nil {
				t.Fatal(err)
			}
			if _, err := s.apply(LibraryChange{Action: action, Kind: "history", SeriesID: "100000001"}); err != nil {
				t.Fatal(err)
			}
			// Import watermark must outlive hidden-marker eviction and record pruning.
			s.data.Cloud.Hidden = nil
			if err := s.persistLocked(s.data); err != nil {
				t.Fatal(err)
			}
			s, err := newLibraryStore(filepath.Dir(s.path))
			if err != nil {
				t.Fatal(err)
			}
			if r, err := s.mergeGuestHistory(guest); err != nil || r.Imported != 0 || len(s.snapshot().Entries) != 0 {
				t.Fatal("deleted history resurrected", r, err)
			}
			guest.Entries[0].LastPlayedAt = 200
			if r, err := s.mergeGuestHistory(guest); err != nil || r.Imported != 1 {
				t.Fatal("new guest playback could not import", r, err)
			}
		})
	}
}

func TestGuestHistoryAtomicSaveFailureAndCapacity(t *testing.T) {
	s := importStore(t)
	guest := LibraryData{Entries: []LibraryEntry{importEntry("100000001", 100, 4)}}
	if err := s.persistLocked(s.data); err != nil {
		t.Fatal(err)
	}
	before := s.snapshot()
	disk, _ := os.ReadFile(s.path)
	goodPath := s.path
	s.path = filepath.Join(s.path, "invalid")
	if _, err := s.mergeGuestHistory(guest); err == nil {
		t.Fatal("save failure accepted")
	}
	if !reflect.DeepEqual(before, s.snapshot()) {
		t.Fatal("failed save committed memory, queue or ledger")
	}
	after, _ := os.ReadFile(goodPath)
	if !bytes.Equal(disk, after) {
		t.Fatal("failed save changed disk")
	}
	s.path = goodPath
	s.data.Cloud = &cloudLibraryState{}
	for i := 0; i < 2000; i++ {
		s.data.Cloud.Pending = append(s.data.Cloud.Pending, cloudMutation{Kind: "progress", SeriesID: fmt.Sprint(200000000 + i), Sequence: uint64(i + 1)})
	}
	before = s.snapshot()
	if _, err := s.mergeGuestHistory(guest); err == nil || !reflect.DeepEqual(before, s.snapshot()) {
		t.Fatal("full queue lost records or import marker")
	}
	s.data.Cloud.Pending[0].SeriesID = "100000001"
	if r, err := s.mergeGuestHistory(guest); err != nil || r.Imported != 1 || len(s.snapshot().Cloud.Pending) != 2000 {
		t.Fatal("could not replace matching pending progress", r, err)
	}
}

func TestGuestHistoryLargeBatchRemainsAvailable(t *testing.T) {
	s := importStore(t)
	guest := LibraryData{}
	for i := 0; i < 2001; i++ {
		guest.Entries = append(guest.Entries, importEntry(fmt.Sprint(100000000+i), 100, 1))
	}
	r, err := s.mergeGuestHistory(guest)
	if err != nil || r.Imported != 2000 || r.Remaining != 1 || historyImportStatus(guest, s.snapshot()).Available != 1 {
		t.Fatal("batch lost overflow", r, err)
	}
	if err := s.ackCloud(s.snapshot().Cloud.Pending[0].Sequence); err != nil {
		t.Fatal(err)
	}
	if r, err := s.mergeGuestHistory(guest); err != nil || r.Imported != 1 || r.Remaining != 0 || len(s.snapshot().Entries) != 2001 {
		t.Fatal(r, err)
	}
}

func TestGuestHistoryCloudConflictAndUploadRetry(t *testing.T) {
	s := importStore(t)
	guest := LibraryData{Entries: []LibraryEntry{importEntry("100000001", 100, 4)}}
	if _, err := s.mergeGuestHistory(guest); err != nil {
		t.Fatal(err)
	}
	if err := s.mergeCloud([]LibraryEntry{importEntry("100000001", 200, 6)}, 0); err != nil {
		t.Fatal(err)
	}
	if e := s.snapshot(); e.Entries[0].Episode != 6 || len(e.Cloud.Pending) != 0 || e.Cloud.GuestHistory["100000001"] != 100 {
		t.Fatal("cloud newer lost")
	}
	guest.Entries[0].LastPlayedAt = 300
	if _, err := s.mergeGuestHistory(guest); err != nil {
		t.Fatal(err)
	}
	var fail atomic.Bool
	fail.Store(true)
	var writes atomic.Int32
	c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
		writes.Add(1)
		if fail.Load() {
			ioJSON(w, `{"code":500}`)
		} else {
			ioJSON(w, `{"code":0}`)
		}
	})
	defer close()
	m := &accountManager{store: s}
	if err := m.flushCloud(context.Background(), 0, s, c); err == nil || len(s.snapshot().Cloud.Pending) != 1 {
		t.Fatal("failed upload dropped pending record")
	}
	fail.Store(false)
	if err := m.flushCloud(context.Background(), 0, s, c); err != nil || len(s.snapshot().Cloud.Pending) != 0 || writes.Load() != 3 {
		t.Fatal("retry/dual ack failed", err)
	}
}

func TestGuestHistoryConcurrentPlaybackAndMerge(t *testing.T) {
	s := importStore(t)
	guest := LibraryData{Entries: []LibraryEntry{importEntry("100000001", 100, 4)}}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 8; i++ {
			if _, err := s.mergeGuestHistory(guest); err != nil {
				t.Error(err)
			}
		}
	}()
	go func() {
		defer wg.Done()
		if _, err := s.apply(LibraryChange{Action: "progress", Drama: guest.Entries[0].Drama, Episode: 8, VideoID: "123456780", Position: 55}); err != nil {
			t.Error(err)
		}
	}()
	wg.Wait()
	d := s.snapshot()
	if d.Entries[0].Episode != 8 || len(d.Cloud.Pending) != 1 || d.Cloud.Pending[0].Entry.Episode != 8 {
		t.Fatal("import overwrote newer playback")
	}
}

func TestGuestHistoryHTTPIdentityAndPrivateLedger(t *testing.T) {
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected upstream request") })
	m.guest.data.Entries = []LibraryEntry{importEntry("100000001", 100, 4)}
	if err := m.guest.persistLocked(m.guest.data); err != nil {
		t.Fatal(err)
	}
	guestBytes, _ := os.ReadFile(m.guest.path)
	s := &server{accounts: m}
	call := func(method, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		s.account(w, httptest.NewRequest(method, "/api/v1/account/import-history", strings.NewReader(body)))
		return w
	}
	if call("POST", `{"owner_id":"123456789"}`).Code != 400 || call("GET", "").Code != 405 {
		t.Fatal("guest or read request accepted")
	}
	m.disk.Profile = &accountProfile{UID: "123456789"}
	m.store = importStore(t)
	m.phase = "logged_in"
	for _, body := range []string{`{}`, `{"owner_id":"987654321"}`, `{"owner_id":"123456789","extra":1}`, `{"owner_id":"123456789"} {}`} {
		if call("POST", body).Code != 400 {
			t.Fatal("invalid/late identity accepted")
		}
	}
	w := call("POST", `{"owner_id":"123456789"}`)
	var payload struct {
		OK     bool               `json:"ok"`
		Data   accountStatus      `json:"data"`
		Result guestHistoryResult `json:"import_history"`
	}
	if json.Unmarshal(w.Body.Bytes(), &payload) != nil || w.Code != 200 || !payload.OK || payload.Result.Imported != 1 || payload.Data.GuestHistory.Available != 0 {
		t.Fatal("import response", w.Body.String())
	}
	if strings.Contains(w.Body.String(), `"cloud"`) || strings.Contains(w.Body.String(), `"100000001"`) {
		t.Fatal("status leaked internal ledger")
	}
	after, _ := os.ReadFile(m.guest.path)
	if !bytes.Equal(guestBytes, after) {
		t.Fatal("original guest file modified")
	}
	if len(m.wake) != 1 {
		t.Fatal("sync not signalled")
	}
	if call("POST", `{"owner_id":"123456789"}`).Code != 200 || len(m.store.snapshot().Cloud.Pending) != 1 {
		t.Fatal("repeat import enqueued duplicate")
	}
}

// Opt-in isolated UI fixture: never logs in or connects to real cloud services.
func TestGuestHistoryBrowserFixture(t *testing.T) {
	if os.Getenv("HONGGUO_GUEST_HISTORY_UI_FIXTURE") != "1" {
		t.Skip("local browser fixture only")
	}
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected upstream request") })
	m.disk.Profile = &accountProfile{UID: "123456789", Name: "合并测试账号"}
	m.phase = "logged_in"
	m.store = importStore(t)
	m.guest.data.Entries = []LibraryEntry{importEntry("100000001", 100, 4), importEntry("100000002", 150, 8)}
	m.store.data.Entries = []LibraryEntry{importEntry("100000002", 200, 10)}
	if err := m.guest.persistLocked(m.guest.data); err != nil {
		t.Fatal(err)
	}
	s := &server{accounts: m, libraryStore: m.guest}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/account", s.account)
	mux.HandleFunc("/api/v1/account/", s.account)
	mux.HandleFunc("/api/v1/library", s.library)
	mux.HandleFunc("/fixture/mode", func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		defer m.mu.Unlock()
		switch r.URL.Query().Get("value") {
		case "guest":
			m.disk.Profile = nil
			m.store = m.guest
		case "account":
			m.disk.Profile = &accountProfile{UID: "123456789", Name: "合并测试账号"}
			m.store = importStore(t)
		case "failure":
			m.store.path = filepath.Join(m.store.path, "invalid")
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("/api/v1/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "version": "0.2.16-fixture", "data": map[string]any{"items": []any{}}})
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			body, _ := os.ReadFile("ui/index.html")
			init := `<script>window.__errors=[];window.addEventListener('error',function(e){window.__errors.push(e.message)});Object.defineProperty(navigator,'userAgent',{get:function(){return 'HongguoTV-Android Chromium44-fixture'}});NodeList.prototype.forEach=undefined;window.fetch=undefined;window.AbortController=undefined;window.URLSearchParams=undefined;window.CSS.supports=function(){return false};document.documentElement.className='legacy-grid legacy-aspect legacy-flex-gap';var legacyStyle=document.createElement('style');legacyStyle.textContent='.legacy-flex-gap *{gap:0!important;column-gap:0!important;row-gap:0!important}';document.head.appendChild(legacyStyle);var originalFocus=HTMLElement.prototype.focus;HTMLElement.prototype.focus=function(options){if(options)throw Error('old focus options');return originalFocus.call(this)};window.HongguoTVUpdates={getStatus:function(){return JSON.stringify({supported:true,current_version:'0.2.16',current_code:18,state:'current',message:'已是最新版本'})},setPromptAllowed:function(){},check:function(){}};</script>`
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(strings.Replace(string(body), `<script src="/compat.js">`, init+`<script src="/compat.js">`, 1)))
			return
		}
		http.FileServer(http.Dir("ui")).ServeHTTP(w, r)
	})
	t.Log("guest history UI fixture: http://127.0.0.1:19697/")
	t.Fatal(http.ListenAndServe("127.0.0.1:19697", s.withCORS(mux)))
}
