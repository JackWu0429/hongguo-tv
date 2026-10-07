package main

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"sort"
)

type guestHistoryStatus struct {
	Total     int `json:"total"`
	Available int `json:"available"`
}
type guestHistoryResult struct {
	Imported  int `json:"imported"`
	Remaining int `json:"remaining"`
}

// Keep the original watch timestamp: importing is not a new playback event.
// Deduplicate old files too, and never enqueue unusable playback identities.
func guestHistoryEntries(data LibraryData) []LibraryEntry {
	byID := map[string]LibraryEntry{}
	for _, e := range data.Entries {
		if !validID(e.Drama.SeriesID) || e.Drama.SeriesID == "0" || e.Drama.Title == "" || !validID(e.VideoID) || e.VideoID == "0" || e.Episode < 1 || e.Episode > 10000 || e.LastPlayedAt <= 0 || math.IsNaN(e.Position) || math.IsInf(e.Position, 0) || e.Position < 0 || e.Position > 86400 || math.IsNaN(e.Duration) || math.IsInf(e.Duration, 0) || e.Duration < 0 || e.Duration > 86400 {
			continue
		}
		if old, ok := byID[e.Drama.SeriesID]; !ok || e.LastPlayedAt > old.LastPlayedAt {
			byID[e.Drama.SeriesID] = e
		}
	}
	ids := make([]string, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	entries := make([]LibraryEntry, 0, len(ids))
	for _, id := range ids {
		entries = append(entries, byID[id])
	}
	return entries
}

func historyImportCandidates(guest, account LibraryData) []LibraryEntry {
	if account.OwnerID == "" {
		return nil
	}
	latest := map[string]int64{}
	for _, e := range account.Entries {
		latest[e.Drama.SeriesID] = max(latest[e.Drama.SeriesID], e.LastPlayedAt)
	}
	var out []LibraryEntry
	for _, e := range guestHistoryEntries(guest) {
		id := e.Drama.SeriesID
		if e.LastPlayedAt <= latest[id] {
			continue
		}
		if account.Cloud != nil && (e.LastPlayedAt <= account.Cloud.GuestHistory[id] || e.LastPlayedAt <= account.Cloud.Hidden["history:"+id]) {
			continue
		}
		out = append(out, e)
	}
	return out
}
func historyImportStatus(guest, account LibraryData) guestHistoryStatus {
	return guestHistoryStatus{Total: len(guestHistoryEntries(guest)), Available: len(historyImportCandidates(guest, account))}
}

func (s *libraryStore) mergeGuestHistory(guest LibraryData) (guestHistoryResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.OwnerID == "" {
		return guestHistoryResult{}, errors.New("请先登录")
	}
	d := cloneLibrary(s.data)
	if d.Cloud == nil {
		d.Cloud = &cloudLibraryState{}
	}
	if d.Cloud.GuestHistory == nil {
		d.Cloud.GuestHistory = map[string]int64{}
	}
	indices := map[string]int{}
	for i, e := range d.Entries {
		indices[e.Drama.SeriesID] = i
	}
	candidates := historyImportCandidates(guest, d)
	result := guestHistoryResult{}
	for _, source := range candidates {
		id := source.Drama.SeriesID
		// A full outbox can still replace the same drama's pending progress.
		hasSlot := len(d.Cloud.Pending) < 2000
		for _, p := range d.Cloud.Pending {
			if p.Kind == "progress" && p.SeriesID == id {
				hasSlot = true
				break
			}
		}
		if !hasSlot {
			result.Remaining++
			continue
		}
		i, ok := indices[id]
		if !ok {
			d.Entries = append(d.Entries, LibraryEntry{})
			i = len(d.Entries) - 1
			indices[id] = i
		}
		target := &d.Entries[i]
		fav, liked, videos := target.FavoriteAt, target.LikedAt, target.LikedVideos
		*target = source
		target.Drama = cleanLibraryDrama(source.Drama)
		target.FavoriteAt, target.LikedAt, target.LikedVideos = fav, liked, videos
		if err := recordCloudChange(&d, LibraryChange{Action: "progress", Drama: target.Drama}, s.data); err != nil {
			return guestHistoryResult{}, err
		}
		d.Cloud.GuestHistory[id] = source.LastPlayedAt
		result.Imported++
	}
	if result.Imported == 0 {
		if result.Remaining > 0 {
			return guestHistoryResult{}, errors.New("待同步记录已满，请先完成同步，再合并登录前记录")
		}
		return result, nil
	}
	// Record, outbox and watermark commit together. Guest storage is untouched.
	if err := s.persistLocked(d); err != nil {
		return guestHistoryResult{}, err
	}
	return result, nil
}

func (m *accountManager) mergeGuestHistory(owner string) (guestHistoryResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.disk.Profile == nil {
		return guestHistoryResult{}, errors.New("请先登录")
	}
	if owner == "" || owner != m.disk.Profile.UID || m.store.snapshot().OwnerID != owner {
		return guestHistoryResult{}, errors.New("账号已切换，请重新打开页面")
	}
	result, err := m.store.mergeGuestHistory(m.guest.snapshot())
	if err == nil && result.Imported > 0 {
		m.signalSync()
	}
	return result, err
}

func (s *server) importGuestHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method not allowed")
		return
	}
	var input struct {
		OwnerID string `json:"owner_id"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || d.Decode(&struct{}{}) != io.EOF {
		writeError(w, 400, "合并请求无效")
		return
	}
	result, err := s.accounts.mergeGuestHistory(input.OwnerID)
	if err != nil {
		message := err.Error()
		if errors.Is(err, errLibrarySave) {
			message = "本机记录未保存，请稍后重试；原记录仍保留"
		}
		writeJSON(w, 400, map[string]any{"ok": false, "error": message, "data": s.accounts.status()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": s.accounts.status(), "import_history": result})
}
