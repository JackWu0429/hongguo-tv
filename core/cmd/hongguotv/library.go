package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const historyLimit = 200
const savedLimit = 300

var errLibrarySave = errors.New("保存本地记录失败")

type LibraryEntry struct {
	Drama        Drama   `json:"drama"`
	Episode      int     `json:"episode,omitempty"`
	VideoID      string  `json:"video_id,omitempty"`
	Position     float64 `json:"position,omitempty"`
	Duration     float64 `json:"duration,omitempty"`
	Completed    bool    `json:"completed,omitempty"`
	LastPlayedAt int64   `json:"last_played_at,omitempty"`
	FavoriteAt   int64   `json:"favorite_at,omitempty"`
	LikedAt      int64   `json:"liked_at,omitempty"`
}

type LibraryData struct {
	Version int            `json:"version"`
	Entries []LibraryEntry `json:"entries"`
}

type LibraryChange struct {
	Action    string  `json:"action"`
	Kind      string  `json:"kind,omitempty"`
	SeriesID  string  `json:"series_id,omitempty"`
	Drama     Drama   `json:"drama"`
	Value     *bool   `json:"value,omitempty"`
	Episode   int     `json:"episode,omitempty"`
	VideoID   string  `json:"video_id,omitempty"`
	Position  float64 `json:"position,omitempty"`
	Duration  float64 `json:"duration,omitempty"`
	Completed bool    `json:"completed,omitempty"`
}

type libraryStore struct {
	mu   sync.Mutex
	path string
	data LibraryData
}

func defaultLibraryDir() string {
	if dir := os.Getenv("HONGGUO_TV_DATA_DIR"); dir != "" {
		return dir
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "hongguo-tv")
}

func newLibraryStore(dir string) (*libraryStore, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	s := &libraryStore{path: filepath.Join(dir, "library.json"), data: LibraryData{Version: 1, Entries: []LibraryEntry{}}}
	body, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(body, &s.data); err != nil || s.data.Version != 1 {
		return nil, fmt.Errorf("本地记录文件无效: %s", s.path)
	}
	if s.data.Entries == nil {
		s.data.Entries = []LibraryEntry{}
	}
	for i := range s.data.Entries {
		s.data.Entries[i].Drama = cleanLibraryDrama(s.data.Entries[i].Drama)
	}
	return s, nil
}

func (s *libraryStore) snapshot() LibraryData {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneLibrary(s.data)
}

func cloneLibrary(data LibraryData) LibraryData {
	// Drama contains slices; a serialized copy prevents callers sharing them.
	body, _ := json.Marshal(data)
	var copy LibraryData
	_ = json.Unmarshal(body, &copy)
	return copy
}

func clearLibraryKind(entry *LibraryEntry, kind string) {
	switch kind {
	case "history":
		entry.LastPlayedAt, entry.Episode, entry.VideoID = 0, 0, ""
		entry.Position, entry.Duration, entry.Completed = 0, 0, false
	case "favorites":
		entry.FavoriteAt = 0
	case "likes":
		entry.LikedAt = 0
	}
}

func libraryTimestamp(entry LibraryEntry, kind string) int64 {
	switch kind {
	case "history":
		return entry.LastPlayedAt
	case "favorites":
		return entry.FavoriteAt
	case "likes":
		return entry.LikedAt
	}
	return 0
}

func trimLibrary(data *LibraryData) {
	for _, kind := range []string{"history", "favorites", "likes"} {
		indices := []int{}
		for i, entry := range data.Entries {
			if libraryTimestamp(entry, kind) > 0 {
				indices = append(indices, i)
			}
		}
		sort.SliceStable(indices, func(i, j int) bool {
			return libraryTimestamp(data.Entries[indices[i]], kind) > libraryTimestamp(data.Entries[indices[j]], kind)
		})
		limit := savedLimit
		if kind == "history" {
			limit = historyLimit
		}
		for _, index := range indices[min(len(indices), limit):] {
			clearLibraryKind(&data.Entries[index], kind)
		}
	}
	kept := make([]LibraryEntry, 0, len(data.Entries))
	for _, entry := range data.Entries {
		if entry.LastPlayedAt > 0 || entry.FavoriteAt > 0 || entry.LikedAt > 0 {
			kept = append(kept, entry)
		}
	}
	data.Entries = kept
}

func cleanLibraryDrama(drama Drama) Drama {
	drama.VidList, drama.Episodes = nil, nil
	// Current-episode identity lives in VideoID. A saved card must resolve its
	// target episode from details, especially when restarting a completed show.
	drama.Vid = ""
	drama.Intro = string([]rune(drama.Intro)[:min(len([]rune(drama.Intro)), 1000)])
	if len(drama.Tags) > 8 {
		drama.Tags = drama.Tags[:8]
	}
	return drama
}

func (s *libraryStore) apply(change LibraryChange) (LibraryData, error) {
	if change.Action == "clear" || change.Action == "remove" {
		if change.Kind != "history" && change.Kind != "favorites" && change.Kind != "likes" {
			return LibraryData{}, errors.New("记录类型无效")
		}
		if change.Action == "remove" && !validID(change.SeriesID) {
			return LibraryData{}, errors.New("series_id 无效")
		}
	} else {
		if change.Action != "progress" && change.Action != "favorite" && change.Action != "like" {
			return LibraryData{}, errors.New("记录操作无效")
		}
		if !validID(change.Drama.SeriesID) || change.Drama.Title == "" {
			return LibraryData{}, errors.New("短剧信息无效")
		}
		if change.Action != "progress" && change.Value == nil {
			return LibraryData{}, errors.New("缺少收藏/点赞状态")
		}
		if change.Action == "progress" && (change.Episode < 1 || change.Episode > 10000 || !validID(change.VideoID) || math.IsNaN(change.Position) || math.IsInf(change.Position, 0) || change.Position < 0 || change.Position > 86400 || math.IsNaN(change.Duration) || math.IsInf(change.Duration, 0) || change.Duration < 0 || change.Duration > 86400) {
			return LibraryData{}, errors.New("播放进度无效")
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	data := cloneLibrary(s.data)
	if change.Action == "clear" || change.Action == "remove" {
		for i := range data.Entries {
			if change.Action == "clear" || data.Entries[i].Drama.SeriesID == change.SeriesID {
				clearLibraryKind(&data.Entries[i], change.Kind)
			}
		}
	} else {
		index := -1
		for i := range data.Entries {
			if data.Entries[i].Drama.SeriesID == change.Drama.SeriesID {
				index = i
				break
			}
		}
		if index < 0 {
			data.Entries = append(data.Entries, LibraryEntry{})
			index = len(data.Entries) - 1
		}
		entry := &data.Entries[index]
		entry.Drama = cleanLibraryDrama(change.Drama)
		now := time.Now().UnixMilli()
		switch change.Action {
		case "progress":
			entry.Episode, entry.VideoID, entry.Position, entry.Duration = change.Episode, change.VideoID, change.Position, change.Duration
			entry.Completed, entry.LastPlayedAt = change.Completed, now
		case "favorite":
			if *change.Value {
				entry.FavoriteAt = now
			} else {
				entry.FavoriteAt = 0
			}
		case "like":
			if *change.Value {
				entry.LikedAt = now
			} else {
				entry.LikedAt = 0
			}
		}
	}
	trimLibrary(&data)
	body, err := json.Marshal(data)
	if err != nil {
		return LibraryData{}, err
	}
	file, err := os.CreateTemp(filepath.Dir(s.path), ".library-*.tmp")
	if err != nil {
		return LibraryData{}, fmt.Errorf("%w: %v", errLibrarySave, err)
	}
	temp := file.Name()
	defer os.Remove(temp)
	if _, err = file.Write(body); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temp, s.path)
	}
	if err != nil {
		return LibraryData{}, fmt.Errorf("%w: %v", errLibrarySave, err)
	}
	s.data = data // Publish only after persistence succeeds.
	return cloneLibrary(data), nil
}

func (s *server) library(w http.ResponseWriter, r *http.Request) {
	if s.libraryStore == nil {
		writeError(w, http.StatusServiceUnavailable, "本地记录尚未就绪")
		return
	}
	if r.Method == http.MethodGet {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": s.libraryStore.snapshot()})
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768))
	decoder.DisallowUnknownFields()
	var change LibraryChange
	if err := decoder.Decode(&change); err != nil {
		writeError(w, http.StatusBadRequest, "记录请求无效")
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeError(w, http.StatusBadRequest, "记录请求包含多余内容")
		return
	}
	data, err := s.libraryStore.apply(change)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errLibrarySave) {
			status = http.StatusInternalServerError
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}
