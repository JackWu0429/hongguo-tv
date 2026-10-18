package main

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func TestSearchHistoryPersistsAndDeduplicatesBoundedDeviceKeywords(t *testing.T) {
	dir := t.TempDir()
	s, err := newSearchHistoryStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 15; i++ {
		if _, err := s.change(fmt.Sprint("剧名", i), false); err != nil {
			t.Fatal(err)
		}
	}
	items, err := s.change("  剧名7 \n ", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 10 || items[0] != "剧名7" || items[1] != "剧名14" || items[9] != "剧名5" {
		t.Fatal(items)
	}
	items[0] = "changed"
	reloaded, err := newSearchHistoryStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s.snapshot(), reloaded.snapshot()) {
		t.Fatal("restart lost keywords")
	}
	info, _ := os.Stat(s.path)
	// Windows uses the user profile directory ACL rather than Unix mode bits.
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
	if _, err = s.change("", true); err != nil {
		t.Fatal(err)
	}
	reloaded, _ = newSearchHistoryStore(dir)
	if len(reloaded.snapshot()) != 0 {
		t.Fatal("clear did not persist")
	}
}

func TestSearchQueryValidationAndSearchMobileRoundTrip(t *testing.T) {
	for _, value := range []string{"", " \t ", strings.Repeat("剧", 101), "bad\x00text", strings.Repeat("😀", 51)} {
		if validNumberInput("search", value) {
			t.Fatal("invalid query", value)
		}
	}
	m, result, address := inputFixture(t, "search")
	if status, body := postInput(t, m, address, " \n魏家逆子 BOSS 2 & 季\t"); status != 200 || !strings.Contains(body, "查看搜索结果") {
		t.Fatal(status, body)
	}
	if got := m.poll(result.Session, false); got.Kind != "search" || got.Value != "魏家逆子 BOSS 2 & 季" {
		t.Fatal(got)
	}
	if got := m.poll(result.Session, false); got.Value != "" || got.State != "expired" {
		t.Fatal(got)
	}
	for _, kind := range []string{"phone", "code"} {
		if validNumberInput(kind, "魏家逆子") {
			t.Fatal("number validation loosened")
		}
	}
}

func TestSearchHistoryHTTPAndFailedSavePreserveState(t *testing.T) {
	s, err := newSearchHistoryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &server{searchHistoryStore: s}
	for _, item := range []struct {
		method, body string
		status       int
	}{{"POST", `{"query":"万妖图录传"}`, 200}, {"POST", `{"query":" "}`, 400}, {"POST", `{"query":"test","owner_id":"cloud"}`, 400}, {"GET", "", 200}, {"PUT", "", 405}} {
		w := httptest.NewRecorder()
		server.searchHistory(w, httptest.NewRequest(item.method, "/api/v1/search-history", strings.NewReader(item.body)))
		if w.Code != item.status {
			t.Fatal(item, w.Code)
		}
	}
	original := s.snapshot()
	s.path = filepath.Join(s.path, "cannot-write")
	if _, err = s.change("new", false); err == nil {
		t.Fatal("save should fail")
	}
	if !reflect.DeepEqual(original, s.snapshot()) {
		t.Fatal("failed save changed items")
	}
}

func TestSearchHistoryCorruptionAndConcurrentWrites(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "search-history.json"), []byte("broken"), 0600)
	s, err := newSearchHistoryStore(dir)
	if err != nil || len(s.snapshot()) != 0 {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if _, err := s.change(fmt.Sprint(i), false); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	if len(s.snapshot()) != 10 {
		t.Fatal(s.snapshot())
	}
	body, err := os.ReadFile(s.path)
	if err != nil || !json.Valid(body) {
		t.Fatal("non-atomic data", err)
	}
	reloaded, err := newSearchHistoryStore(dir)
	if err != nil || !reflect.DeepEqual(s.snapshot(), reloaded.snapshot()) {
		t.Fatal(err)
	}
}
