package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

var errVideoLikeUpstream = errors.New("红果未确认点赞操作")

// Mac v1.1.6: SetLike uses article_do_action, object_type=6 (video),
// action_category=1, action_type=3/4. Comment likes use a different API.
func (c *passportClient) SetVideoLike(ctx context.Context, series, vid string, value bool) error {
	if !validID(series) || series == "0" || !validID(vid) || vid == "0" {
		return errors.New("短剧或集 ID 无效")
	}
	action := 4
	if value {
		action = 3
	}
	body := map[string]any{"action_category": 1, "action_reason_remark": "like_click", "action_type": action, "object_id": vid, "object_type": 6, "business_param": map[string]any{"book_id": 0, "has_aigc_content": false, "modify_count": 0, "shark_param": playerShark(), "video_id": series}}
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	p, err := c.request(ctx, "/novel/articleapi/do_action/v1/", http.MethodPost, nil, b, "application/json; charset=utf-8")
	if err != nil {
		return fmt.Errorf("%w：请求失败，请稍后重试", errVideoLikeUpstream)
	}
	code, ok := p["code"]
	// The original client's ignoreAlreadyDone explicitly accepts these two
	// idempotent statuses. Never acknowledge missing code or nested rejection.
	if !ok || (asString(code) != "0" && asString(code) != "101045" && asString(code) != "101046") {
		return fmt.Errorf("%w（状态 %d）", errVideoLikeUpstream, asInt(code))
	}
	if nested := passportErrorCode(p); nested != "" && nested != "0" && nested != "101045" && nested != "101046" {
		return errVideoLikeUpstream
	}
	return nil
}

func (m *accountManager) changeVideoLike(ctx context.Context, change LibraryChange) (LibraryData, error) {
	if change.Action != "like" || change.Value == nil || !validID(change.Drama.SeriesID) || change.Drama.SeriesID == "0" || change.Drama.Title == "" || !validID(change.VideoID) || change.VideoID == "0" || change.Episode < 1 || change.Episode > 10000 {
		return LibraryData{}, errors.New("缺少当前短剧或播放集")
	}
	m.likeMu.Lock()
	defer m.likeMu.Unlock()
	m.mu.Lock()
	if m.disk.Profile == nil {
		m.mu.Unlock()
		return LibraryData{}, errListLogin
	}
	store, g := m.store, m.generation
	owner := store.snapshot().OwnerID
	if change.OwnerID == nil || *change.OwnerID != owner {
		m.mu.Unlock()
		return LibraryData{}, errAccountChanged
	}
	c := m.newClient(m.disk.Session)
	c.uid = m.disk.Profile.UID
	if !hasAccountCredentials(c.session) {
		m.mu.Unlock()
		return LibraryData{}, errListLogin
	}
	m.likeRevision++
	m.mu.Unlock()
	requestCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	err := c.SetVideoLike(requestCtx, change.Drama.SeriesID, change.VideoID, *change.Value)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.likeRevision++
	if g != m.generation || store != m.store {
		return LibraryData{}, errAccountChanged
	}
	if err != nil {
		return LibraryData{}, err
	}
	d, err := store.apply(change)
	if err != nil {
		m.signalSync()
		return LibraryData{}, err
	}
	return d, nil
}

func (c *passportClient) pullLikes(ctx context.Context) ([]LibraryEntry, error) {
	out := map[string]LibraryEntry{}
	offset := 0
	seenPages := map[[32]byte]bool{}
	for page := 0; page < 1000; page++ {
		// Real authenticated regression confirms type=3 contains video likes.
		// Mac's older type=1 query returns an empty list even after a confirmed
		// write and video_detail.user_digg=true; do not erase likes from it.
		p, err := c.cloudJSON(ctx, "/reading/ugc/action/mget/v", http.MethodGet, url.Values{"object_type_list": {"6,15,10"}, "action_type": {"3"}, "offset": {strconv.Itoa(offset)}, "count": {"100"}}, nil)
		if err != nil {
			return nil, err
		}
		d := passportData(p)
		value, present := d["mixed_data_list"]
		rows, ok := value.([]any)
		// Empty real accounts return mixed_data_list:null, has_more:false.
		if !present || (!ok && value != nil) || d["has_more"] == nil {
			return nil, errors.New("点赞响应缺少完整列表")
		}
		more := asBool(d["has_more"])
		if _, boolean := d["has_more"].(bool); !boolean {
			switch asString(d["has_more"]) {
			case "true", "false", "0", "1":
			default:
				return nil, errors.New("点赞分页状态无效")
			}
		}
		if len(rows) > 0 {
			b, _ := json.Marshal(rows)
			hash := sha256.Sum256(b)
			if seenPages[hash] {
				return nil, errors.New("点赞列表返回重复分页")
			}
			seenPages[hash] = true
		}
		for i, value := range rows {
			r, ok := asMap(value)
			if !ok {
				return nil, errors.New("点赞条目格式无效")
			}
			v, ok := asMap(r["video_data"])
			if !ok {
				continue
			} // Other object types are not dramas.
			id, vid := asString(v["series_id"]), asString(v["vid"])
			if !validID(id) || id == "0" || !validID(vid) || vid == "0" {
				return nil, errors.New("点赞条目身份无效")
			}
			detail, _ := asMap(v["video_detail"])
			if detail == nil {
				detail = map[string]any{}
			}
			if identity := firstNonEmpty(asString(detail["series_id_str"]), asString(detail["series_id"])); identity != "" && identity != id {
				return nil, errCloudMetadataIdentity
			}
			detail["series_id_str"] = id
			card, _ := normalizeDrama(detail)
			card.SeriesID = id
			if firstNonEmpty(asString(detail["series_title"]), asString(detail["title"])) == "" {
				card.Title = "剧集信息暂未加载"
				card.MetadataPending = true
			}
			if card.Cover == "" {
				card.Cover = asString(v["cover"])
			}
			card.EpisodeCount = max(card.EpisodeCount, asInt(v["episode_cnt"]))
			e := out[id]
			if e.Drama.SeriesID == "" {
				e.Drama = cleanLibraryDrama(card)
			}
			duplicate := false
			for _, old := range e.LikedVideos {
				if old.VideoID == vid {
					duplicate = true
					break
				}
			}
			if !duplicate {
				stamp := asInt64(v["user_digg_timestamp_ms"])
				if stamp <= 0 {
					stamp = time.Now().UnixMilli() - int64(page*100+i)
				}
				e.LikedVideos = append(e.LikedVideos, LikedVideo{VideoID: vid, Episode: asInt(v["vid_index"]), LikedAt: stamp})
				e.LikedAt = max(e.LikedAt, stamp)
			}
			out[id] = e
		}
		if !more {
			result := make([]LibraryEntry, 0, len(out))
			for _, entry := range out {
				result = append(result, entry)
			}
			return result, nil
		}
		if len(rows) == 0 {
			return nil, errors.New("点赞分页未完整读取")
		}
		next := asInt(d["next_offset"])
		if next <= offset {
			next = offset + 100
		} // Matches original Likes method.
		offset = next
	}
	return nil, errors.New("点赞分页未完整读取")
}

// Called only after a validated complete remote snapshot. Local-only hidden
// rows stay hidden; old local likes are not silently uploaded to the account.
func (s *libraryStore) mergeLikes(remote []LibraryEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := cloneLibrary(s.data)
	indices := map[string]int{}
	for i := range d.Entries {
		indices[d.Entries[i].Drama.SeriesID] = i
		d.Entries[i].LikedAt = 0
		d.Entries[i].LikedVideos = nil
	}
	for _, r := range remote {
		id := r.Drama.SeriesID
		if d.Cloud != nil && d.Cloud.Hidden["likes:"+id] > 0 {
			continue
		}
		i, ok := indices[id]
		if !ok {
			d.Entries = append(d.Entries, LibraryEntry{Drama: cleanLibraryDrama(r.Drama)})
			i = len(d.Entries) - 1
			indices[id] = i
		}
		e := &d.Entries[i]
		if e.Drama.Title == "" || e.Drama.MetadataPending {
			e.Drama = cleanLibraryDrama(r.Drama)
		}
		e.LikedAt, e.LikedVideos = r.LikedAt, r.LikedVideos
	}
	pruneLibraryEntries(&d)
	return s.persistLocked(d)
}
