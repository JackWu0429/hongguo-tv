package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"
)

const searchHistoryLimit = 10
const searchQueryLimit = 100 // Same UTF-16 length as HTML maxlength and JS strings.

func normalizeSearchQuery(value string) (string, bool) {
	if !utf8.ValidString(value) {
		return "", false
	}
	value = strings.Join(strings.Fields(value), " ")
	if value == "" || len(utf16.Encode([]rune(value))) > searchQueryLimit {
		return "", false
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return "", false
		}
	}
	return value, true
}

type searchHistoryStore struct {
	mu    sync.Mutex
	path  string
	items []string
}

// Search text belongs to the device, independently of account/cloud libraries
// and the ephemeral WebView origin. Never migrate or alter viewing history.
func newSearchHistoryStore(dir string) (*searchHistoryStore, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	s := &searchHistoryStore{path: filepath.Join(dir, "search-history.json"), items: []string{}}
	f, err := os.Open(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var saved struct {
		Items []string `json:"items"`
	}
	// Damaged or oversized recent keywords must not prevent the app starting.
	if err := json.NewDecoder(io.LimitReader(f, 32768)).Decode(&saved); err != nil {
		return s, nil
	}
	for _, value := range saved.Items {
		query, valid := normalizeSearchQuery(value)
		if !valid {
			continue
		}
		duplicate := false
		for _, old := range s.items {
			if old == query {
				duplicate = true
				break
			}
		}
		if !duplicate {
			s.items = append(s.items, query)
		}
		if len(s.items) == searchHistoryLimit {
			break
		}
	}
	return s, nil
}

func (s *searchHistoryStore) snapshot() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string{}, s.items...)
}

func (s *searchHistoryStore) change(query string, clear bool) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := []string{}
	if !clear {
		value, valid := normalizeSearchQuery(query)
		if !valid {
			return nil, errors.New("请输入不超过100字的剧名或关键词")
		}
		next = append(next, value)
		for _, old := range s.items {
			if old != value && len(next) < searchHistoryLimit {
				next = append(next, old)
			}
		}
	}
	body, _ := json.Marshal(struct {
		Items []string `json:"items"`
	}{next})
	f, err := os.CreateTemp(filepath.Dir(s.path), ".search-history-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(body); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(f.Name(), s.path)
	}
	if err != nil {
		return nil, err
	}
	s.items = next
	return append([]string{}, next...), nil
}

func (s *server) searchHistory(w http.ResponseWriter, r *http.Request) {
	if s.searchHistoryStore == nil {
		writeError(w, 503, "最近搜索暂不可用")
		return
	}
	var items []string
	var err error
	switch r.Method {
	case http.MethodGet:
		items = s.searchHistoryStore.snapshot()
	case http.MethodPost:
		var request struct {
			Query string `json:"query"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 2048)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil {
			writeError(w, 400, "搜索关键词格式不正确")
			return
		}
		if _, valid := normalizeSearchQuery(request.Query); !valid {
			writeError(w, 400, "请输入不超过100字的剧名或关键词")
			return
		}
		items, err = s.searchHistoryStore.change(request.Query, false)
	case http.MethodDelete:
		items, err = s.searchHistoryStore.change("", true)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err != nil {
		writeError(w, 500, "保存最近搜索失败，请重试")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"items": items, "limit": searchHistoryLimit}})
}
