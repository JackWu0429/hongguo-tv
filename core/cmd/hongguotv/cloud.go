package main

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

type cloudMutation struct {
	Sequence uint64       `json:"sequence"`
	Kind     string       `json:"kind"`
	SeriesID string       `json:"series_id"`
	Value    bool         `json:"value,omitempty"`
	Entry    LibraryEntry `json:"entry"`
}
type cloudLibraryState struct {
	Sequence uint64           `json:"sequence"`
	Pending  []cloudMutation  `json:"pending,omitempty"`
	Hidden   map[string]int64 `json:"hidden,omitempty"`
	LastSync int64            `json:"last_sync,omitempty"`
}
type syncStatus struct {
	State    string `json:"state"`
	Pending  int    `json:"pending"`
	LastSync int64  `json:"last_sync,omitempty"`
	Error    string `json:"error,omitempty"`
}

func recordCloudChange(data *LibraryData, c LibraryChange, before LibraryData) error {
	if data.Cloud == nil {
		data.Cloud = &cloudLibraryState{}
	}
	cloud := data.Cloud
	if cloud.Hidden == nil {
		cloud.Hidden = map[string]int64{}
	}
	kind := c.Action
	id := c.Drama.SeriesID
	if c.Action == "clear" || c.Action == "remove" {
		for _, e := range before.Entries {
			if c.Action == "clear" || e.Drama.SeriesID == c.SeriesID {
				cloud.Hidden[c.Kind+":"+e.Drama.SeriesID] = time.Now().UnixMilli()
			}
		}
		trimCloudHidden(cloud)
		if c.Action == "clear" || c.Kind != "favorites" {
			return nil
		}
		kind = "favorite"
		id = c.SeriesID
	}
	if kind != "progress" && kind != "favorite" {
		return nil
	}
	var entry LibraryEntry
	for _, e := range data.Entries {
		if e.Drama.SeriesID == id {
			entry = e
			break
		}
	}
	if entry.Drama.SeriesID == "" {
		for _, e := range before.Entries {
			if e.Drama.SeriesID == id {
				entry = e
				break
			}
		}
	}
	value := kind == "favorite" && c.Action != "remove" && c.Value != nil && *c.Value
	if kind == "progress" {
		delete(cloud.Hidden, "history:"+id)
	} else if c.Action != "remove" {
		delete(cloud.Hidden, "favorites:"+id)
	}
	cloud.Sequence++
	op := cloudMutation{Sequence: cloud.Sequence, Kind: kind, SeriesID: id, Value: value, Entry: entry}
	for i, p := range cloud.Pending {
		if p.Kind == kind && p.SeriesID == id {
			cloud.Pending[i] = op
			return nil
		}
	}
	if len(cloud.Pending) >= 2000 {
		return errors.New("待同步记录过多，请先恢复网络并同步")
	}
	cloud.Pending = append(cloud.Pending, op)
	return nil
}

// Bound local-only exclusions, including records removed over many sessions.
func trimCloudHidden(cloud *cloudLibraryState) {
	for len(cloud.Hidden) > 2000 {
		var oldest string
		var stamp int64
		for key, value := range cloud.Hidden {
			if oldest == "" || value < stamp {
				oldest, stamp = key, value
			}
		}
		delete(cloud.Hidden, oldest)
	}
}
func storeCloudLastSync(s *libraryStore) int64 {
	d := s.snapshot()
	if d.Cloud != nil {
		return d.Cloud.LastSync
	}
	return 0
}
func (m *accountManager) syncStatusLocked() syncStatus {
	s := syncStatus{State: "idle", LastSync: m.lastSync, Error: m.syncError}
	d := m.store.snapshot()
	if d.Cloud != nil {
		s.Pending = len(d.Cloud.Pending)
	}
	if m.syncing {
		s.State = "syncing"
	} else if m.syncError != "" {
		s.State = "error"
	} else if s.Pending > 0 {
		s.State = "pending"
	}
	return s
}

func (m *accountManager) run(ctx context.Context) {
	ticker := time.NewTicker(90 * time.Second)
	defer ticker.Stop()
	if m.status().LoggedIn {
		m.signalSync()
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-m.wake:
		}
		// Coalesce playback saves without delaying the TV UI.
		timer := time.NewTimer(2 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		m.synchronize(ctx)
	}
}
func (m *accountManager) synchronize(parent context.Context) {
	m.mu.Lock()
	if m.disk.Profile == nil || m.syncing {
		m.mu.Unlock()
		return
	}
	g, store, uid := m.generation, m.store, m.disk.Profile.UID
	client := m.newClient(m.disk.Session)
	client.uid = uid
	m.syncing = true
	ctx, cancel := context.WithTimeout(parent, 3*time.Minute)
	m.cancelSync = cancel
	m.mu.Unlock()
	defer cancel()
	// Pull first: stale offline progress must not overwrite another device's
	// newer watch position. Merge reconciles only matching progress mutations.
	var err error
	if !validID(uid) || uid == "0" || store.snapshot().OwnerID != uid {
		err = errors.New("账号记录身份不匹配，请重新登录")
	} else if !hasAccountCredentials(client.session) {
		err = errors.New("账号会话凭证缺失，请重新登录")
	}
	var remote []LibraryEntry
	if err == nil {
		remote, err = client.pullLibrary(ctx, uid, store.snapshot(), m.details)
	}
	if err == nil {
		m.mu.Lock()
		if g != m.generation || m.store != store {
			m.mu.Unlock()
			return
		}
		err = store.mergeCloud(remote, 0)
		m.mu.Unlock()
	}
	if err == nil {
		err = m.flushCloud(ctx, g, store, client)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if g != m.generation || m.disk.Profile == nil {
		return
	}
	m.syncing = false
	m.cancelSync = nil
	if err == nil {
		disk := m.disk
		disk.Session = client.session
		err = m.saveDisk(disk)
		if err == nil {
			m.disk = disk
			err = store.markCloudSynced(time.Now().UnixMilli())
			if err == nil {
				m.lastSync = storeCloudLastSync(store)
			}
		}
	}
	if err != nil {
		m.syncError = err.Error()
	} else {
		m.syncError = ""
	}
}

func (s *libraryStore) markCloudSynced(stamp int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := cloneLibrary(s.data)
	if d.Cloud == nil {
		d.Cloud = &cloudLibraryState{}
	}
	d.Cloud.LastSync = stamp
	return s.persistLocked(d)
}
func (m *accountManager) flushCloud(ctx context.Context, g uint64, store *libraryStore, c *passportClient) error {
	for i := 0; i < 2000; i++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		m.mu.Lock()
		if g != m.generation || m.store != store {
			m.mu.Unlock()
			return context.Canceled
		}
		data := store.snapshot()
		m.mu.Unlock()
		if data.Cloud == nil || len(data.Cloud.Pending) == 0 {
			return nil
		}
		op := data.Cloud.Pending[0]
		if err := c.uploadMutation(ctx, op); err != nil {
			return err
		}
		m.mu.Lock()
		if g != m.generation || m.store != store {
			m.mu.Unlock()
			return context.Canceled
		}
		err := store.ackCloud(op.Sequence)
		m.mu.Unlock()
		if err != nil {
			return err
		}
	}
	return errors.New("待同步记录较多，将在下一轮继续")
}
func (s *libraryStore) ackCloud(seq uint64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data := cloneLibrary(s.data)
	if data.Cloud == nil {
		return nil
	}
	kept := data.Cloud.Pending[:0]
	for _, p := range data.Cloud.Pending {
		if p.Sequence != seq {
			kept = append(kept, p)
		}
	}
	data.Cloud.Pending = kept
	return s.persistLocked(data)
}

func (c *passportClient) uploadMutation(ctx context.Context, p cloudMutation) error {
	if !validID(p.SeriesID) {
		return errors.New("云同步记录身份无效")
	}
	e := p.Entry
	if p.Kind == "favorite" {
		op := 0
		if !p.Value {
			op = 1
		}
		_, err := c.cloudJSON(ctx, "/reading/bookapi/bookshelf/video/update/v", http.MethodPost, nil, map[string]any{"is_cancelled": false, "shark_extra": map[string]any{"enter_from": "0", "previous_page": "0", "page_list": "0", "is_active_behavior": "1", "inactive_type": "0"}, "update_bookshelf_video_list": []any{map[string]any{"book_id": p.SeriesID, "book_type": 2, "modify_time": time.Now().UnixMilli(), "video_shelf_operate_type": op}}})
		return err
	}
	if p.Kind != "progress" || e.Episode < 1 || !validID(e.VideoID) {
		return errors.New("云端播放进度无效")
	}
	stamp := e.LastPlayedAt
	row := map[string]any{"book_id": cloudNumericID(p.SeriesID), "book_type": 2, "vid": cloudNumericID(e.VideoID), "vid_index": e.Episode, "chapter_index": 0, "current_play_position": cloudMillis(e.Position), "player_accumulate_total_time": cloudMillis(e.Position), "read_timestamp_ms": stamp, "update_timestamp_ms": stamp, "is_delete": false, "is_interactive_game": false, "is_listen_mode": false, "is_multi_season": e.Drama.MultiSeason, "season_index": e.Drama.SeasonIndex, "duration": cloudMillis(e.Duration), "episode_cnt": e.Drama.EpisodeCount, "digged_count": 0, "user_digg": 0, "origin_novel_book_id": 0, "recent_reads": 0, "retain_video_play_time": 0, "series_play_cnt": 0, "tone_id": 0, "use_soft_delete": false, "meet_guide_comment_tag": 0, "user_playlet_comment_flag": 0}
	if _, err := c.cloudJSON(ctx, "/reading/bookapi/read_history/update/v", http.MethodPost, nil, map[string]any{"update_datas": []any{row}}); err != nil {
		return err
	}
	progress := map[string]any{"book_id": p.SeriesID, "book_type": 2, "item_id": e.VideoID, "vid_index": e.Episode, "current_play_time": cloudMillis(e.Position), "player_cumulative_total_duration": cloudMillis(e.Position), "read_timestamp_ms": stamp, "progress_type": 0, "channel_id": 0, "cur_channel_id": 0, "check_timestamp": stamp, "is_listen_mode": false, "is_local_book": false, "listen_and_read": false, "page_index": 0, "page_progress_rate": 0, "paragraph_offset": 0, "tone_id": 0}
	_, err := c.cloudJSON(ctx, "/reading/bookapi/read_progress/upload/v", http.MethodPost, nil, map[string]any{"books": []any{progress}})
	return err
}

func (c *passportClient) pullLibrary(ctx context.Context, uid string, local LibraryData, details *hongguoClient) ([]LibraryEntry, error) {
	entries := map[string]LibraryEntry{}
	for _, e := range local.Entries {
		entries[e.Drama.SeriesID] = e
	}
	remote := map[string]LibraryEntry{}
	offset := 0
	for page := 0; page < 5; page++ {
		q := url.Values{"limit": {"100"}, "offset": {strconv.Itoa(offset)}, "book_type": {"2"}, "full_field": {"false"}, "query_soft_deleted": {"false"}, "last_min_read_timestamp_ms": {"0"}, "is_first_load": {strconv.FormatBool(offset == 0)}}
		p, err := c.cloudJSON(ctx, "/reading/bookapi/read_history/list/v", http.MethodGet, q, nil)
		if err != nil {
			return nil, err
		}
		d := passportData(p)
		rows, ok := d["data_list"].([]any)
		if !ok {
			return nil, errors.New("云端历史响应缺少列表")
		}
		for _, value := range rows {
			r, ok := asMap(value)
			if !ok {
				return nil, errors.New("云端历史条目无效")
			}
			id := asString(r["book_id_str"])
			if !validID(id) {
				return nil, errors.New("云端历史条目身份无效")
			}
			if asBool(r["is_delete"]) {
				continue
			}
			e := LibraryEntry{Drama: Drama{SeriesID: id, Title: asString(r["book_name"]), Cover: asString(r["thumb_url"]), EpisodeCount: asInt(r["episode_cnt"])}, VideoID: asString(r["vid"]), Episode: asInt(r["vid_index"]), Position: accountSeconds(r["current_play_position"]) / 1000, Duration: accountSeconds(r["duration"]) / 1000, LastPlayedAt: accountEpoch(r["read_timestamp_ms"])}
			if e.Episode < 1 || e.Episode > 10000 || e.Position < 0 || e.Position > 86400 || e.LastPlayedAt <= 0 {
				continue
			}
			if old, ok := entries[id]; ok {
				if e.Drama.Title == "" {
					e.Drama = old.Drama
				}
				if e.Duration == 0 && old.Episode == e.Episode {
					e.Duration = old.Duration
				}
			}
			if old, ok := remote[id]; !ok || e.LastPlayedAt > old.LastPlayedAt {
				remote[id] = e
			}
		}
		if !asBool(d["has_more"]) {
			break
		}
		next := asInt(d["next_offset"])
		if next <= offset || page == 4 {
			return nil, errors.New("云端历史分页未完整读取")
		}
		offset = next
	}
	p, err := c.cloudJSON(ctx, "/reading/bookapi/bookshelf/video/list/v", http.MethodGet, urlValues("target_user_id", uid), nil)
	if err != nil {
		return nil, err
	}
	rows, ok := passportData(p)["video_shelf_info"].([]any)
	if !ok {
		return nil, errors.New("云端收藏响应缺少列表")
	}
	missing := []string{}
	for i, value := range rows {
		r, ok := asMap(value)
		if !ok {
			return nil, errors.New("云端收藏条目无效")
		}
		id := asString(r["series_id"])
		if !validID(id) {
			return nil, errors.New("云端收藏条目身份无效")
		}
		e := remote[id]
		if e.Drama.SeriesID == "" {
			e = entries[id]
		} else if e.Drama.Title == "" && entries[id].Drama.Title != "" {
			e.Drama = entries[id].Drama
		}
		if e.Drama.SeriesID == "" || e.Drama.Title == "" {
			e.Drama.SeriesID = id
			missing = append(missing, id)
		}
		e.FavoriteAt = int64(len(rows) - i)
		remote[id] = e
	}
	missingIDs := map[string]bool{}
	for _, id := range missing {
		missingIDs[id] = true
	}
	for id, e := range remote {
		if e.Drama.Title == "" && !missingIDs[id] {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		if details == nil {
			return nil, errors.New("云端收藏详情服务未就绪")
		}
		// Limit concurrency while avoiding hundreds of serial detail requests.
		var mu sync.Mutex
		var firstErr error
		var workers sync.WaitGroup
		jobs := make(chan string)
		for i := 0; i < 4; i++ {
			workers.Add(1)
			go func() {
				defer workers.Done()
				for id := range jobs {
					detail, err := details.SeriesDetail(ctx, id)
					mu.Lock()
					if err != nil || detail.Drama.Title == "" {
						firstErr = errors.New("部分云端收藏详情暂时无法读取，请重试")
					} else {
						e := remote[id]
						e.Drama = cleanLibraryDrama(detail.Drama)
						remote[id] = e
					}
					mu.Unlock()
				}
			}()
		}
		for _, id := range missing {
			select {
			case jobs <- id:
			case <-ctx.Done():
				break
			}
		}
		close(jobs)
		workers.Wait()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if firstErr != nil {
			return nil, firstErr
		}
	}
	ids := []any{}
	for id := range remote {
		ids = append(ids, cloudNumericID(id))
	}
	if len(ids) > 0 {
		p, err = c.cloudJSON(ctx, "/reading/bookapi/read_progress/get/v", http.MethodPost, nil, map[string]any{"book_ids": map[string]any{"2": ids}})
		if err != nil {
			return nil, err
		}
		list, ok := p["video_data"].([]any)
		if !ok {
			list, ok = passportData(p)["video_data"].([]any)
		}
		if !ok {
			return nil, errors.New("云端进度响应缺少列表")
		}
		for _, value := range list {
			r, ok := asMap(value)
			if !ok {
				continue
			}
			id := asString(r["series_id"])
			e, exists := remote[id]
			if !exists {
				continue
			}
			count := asInt(r["episode_count"])
			if count > e.Drama.EpisodeCount {
				e.Drama.EpisodeCount = count
			}
			index := asInt(r["vid_index"])
			watchTime := accountEpoch(r["last_watch_time"])
			if watchTime > 0 && watchTime < 100000000000 {
				watchTime *= 1000
			}
			if index > 0 && index <= 10000 && (e.Episode == 0 || watchTime > e.LastPlayedAt) {
				if e.Episode != index {
					e.VideoID, e.Position, e.Duration, e.Completed = "", 0, 0, false
				}
				e.Episode = index
				if watchTime > e.LastPlayedAt {
					e.LastPlayedAt = watchTime
				}
			}
			remote[id] = e
		}
	}
	out := make([]LibraryEntry, 0, len(remote))
	for _, e := range remote {
		if e.Drama.Title != "" {
			out = append(out, e)
		}
	}
	return out, nil
}

func (s *libraryStore) mergeCloud(remote []LibraryEntry, stamp int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := cloneLibrary(s.data)
	if d.Cloud == nil {
		d.Cloud = &cloudLibraryState{}
	}
	byID := map[string]LibraryEntry{}
	for _, r := range remote {
		byID[r.Drama.SeriesID] = r
	}
	kept := d.Cloud.Pending[:0]
	for _, p := range d.Cloud.Pending {
		r := byID[p.SeriesID]
		if p.Kind == "progress" && r.LastPlayedAt > p.Entry.LastPlayedAt && d.Cloud.Hidden["history:"+p.SeriesID] == 0 {
			continue
		}
		kept = append(kept, p)
	}
	d.Cloud.Pending = kept
	pending := map[string]bool{}
	for _, p := range d.Cloud.Pending {
		pending[p.Kind+":"+p.SeriesID] = true
	}
	seen := map[string]bool{}
	indices := map[string]int{}
	for i, e := range d.Entries {
		indices[e.Drama.SeriesID] = i
	}
	for _, r := range remote {
		id := r.Drama.SeriesID
		seen[id] = true
		i, ok := indices[id]
		if !ok {
			d.Entries = append(d.Entries, LibraryEntry{Drama: cleanLibraryDrama(r.Drama)})
			i = len(d.Entries) - 1
			indices[id] = i
		}
		e := &d.Entries[i]
		if !pending["progress:"+id] && d.Cloud.Hidden["history:"+id] == 0 && r.LastPlayedAt > e.LastPlayedAt {
			fav, like := e.FavoriteAt, e.LikedAt
			*e = r
			e.Drama = cleanLibraryDrama(r.Drama)
			e.FavoriteAt = fav
			e.LikedAt = like
		}
		if !pending["favorite:"+id] && d.Cloud.Hidden["favorites:"+id] == 0 {
			if r.FavoriteAt > 0 && e.FavoriteAt == 0 {
				e.FavoriteAt = stamp - savedLimit + r.FavoriteAt
			} else if r.FavoriteAt == 0 {
				e.FavoriteAt = 0
			}
		}
	}
	// Only a fully validated cloud snapshot can remove remote favorites. Local
	// history and likes are never erased just because a remote page is empty.
	for i, e := range d.Entries {
		if !seen[e.Drama.SeriesID] && !pending["favorite:"+e.Drama.SeriesID] {
			d.Entries[i].FavoriteAt = 0
		}
	}
	if stamp > 0 {
		d.Cloud.LastSync = stamp
	}
	trimLibrary(&d)
	return s.persistLocked(d)
}
