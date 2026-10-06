package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"time"
)

type NextSeasonResult struct {
	CurrentSeason int    `json:"current_season"`
	Next          *Drama `json:"next"`
}

type seasonRow struct {
	Drama
	Disabled bool
}

// plan/v omits the requested series. Confirm its season number in a sibling's
// reciprocal relation before choosing a successor; unknown is never season 1.
// This is deliberately requested after the last episode, without preparing
// or downloading any future media.
func (c *hongguoClient) NextSeason(ctx context.Context, seriesID string) (NextSeasonResult, error) {
	if !validID(seriesID) {
		return NextSeasonResult{}, errors.New("series_id 无效")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	rows, err := c.seasonRows(ctx, seriesID)
	if err != nil {
		return NextSeasonResult{}, err
	}
	result := NextSeasonResult{}
	var sibling *seasonRow
	for i := range rows {
		row := &rows[i]
		if row.SeriesID == seriesID {
			result.CurrentSeason = row.SeasonIndex
		} else if row.playable() && (sibling == nil || row.SeasonIndex < sibling.SeasonIndex) {
			sibling = row
		}
	}
	if sibling == nil {
		return result, nil
	}
	if result.CurrentSeason <= 0 {
		reciprocal, err := c.seasonRows(ctx, sibling.SeriesID)
		if err != nil {
			return NextSeasonResult{}, fmt.Errorf("确认当前季失败: %w", err)
		}
		for _, row := range reciprocal {
			if row.SeriesID == seriesID {
				if result.CurrentSeason != 0 && result.CurrentSeason != row.SeasonIndex {
					return NextSeasonResult{}, errors.New("官方季关系存在冲突")
				}
				result.CurrentSeason = row.SeasonIndex
			}
		}
	}
	if result.CurrentSeason <= 0 {
		return NextSeasonResult{}, errors.New("官方季关系未确认当前季，已停止自动跨季")
	}
	for _, row := range rows {
		if row.SeriesID != seriesID && row.playable() && row.SeasonIndex > result.CurrentSeason &&
			(result.Next == nil || row.SeasonIndex < result.Next.SeasonIndex) {
			next := row.Drama
			next.MultiSeason = true
			result.Next = &next
		}
	}
	return result, nil
}

func (r seasonRow) playable() bool {
	return !r.Disabled && r.EpisodeCount > 0 && validID(r.Vid) && r.SeasonIndex > 0
}

func (c *hongguoClient) seasonRows(ctx context.Context, seriesID string) ([]seasonRow, error) {
	params, _ := url.ParseQuery(c.appQuery())
	miniReelIdentity.Do(func() {
		miniReelIdentity.deviceID = miniReelRandomID()
		miniReelIdentity.installID = miniReelRandomID()
	})
	stamp := time.Now().UnixMilli()
	for key, value := range map[string]string{
		"device_id": miniReelIdentity.deviceID, "iid": miniReelIdentity.installID,
		"_rticket": strconv.FormatInt(stamp, 10), "scene": "10", "offset": "0", "limit": "0",
		"from": "series_short_play_info", "total_chapter_num": "0", "current_chapter_num": "0",
		"post_id": "0", "is_horizontal_screen": "false", "bookstore_tab": "0", "bookstore_tab_type": "0",
		"book_id": seriesID, "filter_ids": seriesID,
	} {
		params.Set(key, value)
	}
	query := params.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.apiBase+"/reading/bookapi/plan/v?"+query, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", c.userAgent)
	request.Header.Set("X-XS-From-Web", "0")
	request.Header.Set("Sdk-Version", "2")
	request.Header.Set("Accept", "application/json")
	for key, value := range miniReelSignRequest(query, "", stamp) {
		request.Header.Set(key, value)
	}
	payload, err := c.doJSON(request)
	if err != nil {
		return nil, err
	}
	// A missing status / malformed data is not a successful empty season list.
	if asString(payload["code"]) != "0" {
		return nil, errors.New("官方季关系响应缺少成功状态")
	}
	blocks, ok := payload["data"].([]any)
	if !ok {
		return nil, errors.New("官方季关系响应缺少列表")
	}
	rows := make([]seasonRow, 0)
	seen := make(map[string]int)
	for _, block := range blocks {
		object, ok := asMap(block)
		if !ok {
			return nil, errors.New("官方季关系区块无效")
		}
		videos, exists := object["video_data"]
		if !exists || videos == nil {
			continue
		}
		list, ok := videos.([]any)
		if !ok {
			return nil, errors.New("官方季关系剧集列表无效")
		}
		for _, video := range list {
			object, ok := asMap(video)
			if !ok {
				return nil, errors.New("官方季关系条目无效")
			}
			drama, ok := normalizeDrama(object)
			if !ok || !validID(drama.SeriesID) || drama.SeasonIndex <= 0 {
				continue
			}
			if index, exists := seen[drama.SeriesID]; exists {
				if rows[index].SeasonIndex != drama.SeasonIndex {
					return nil, errors.New("官方季关系存在重复季号冲突")
				}
				continue
			}
			seen[drama.SeriesID] = len(rows)
			rows = append(rows, seasonRow{Drama: drama, Disabled: asBool(object["disable_play"])})
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].SeasonIndex < rows[j].SeasonIndex })
	return rows, nil
}

func (s *server) nextSeason(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	seriesID := r.URL.Query().Get("series_id")
	if !validID(seriesID) {
		writeError(w, http.StatusBadRequest, "series_id 无效")
		return
	}
	result, err := s.hongguo.NextSeason(r.Context(), seriesID)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": result})
}
