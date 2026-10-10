package main

import (
	"context"
	"errors"
	"net/http"
	"net/url"
)

// FollowUpdateList is kept separate from reservations. The desktop client
// exposes this as a reading-progress subscription, while reservations use the
// uncover_subscribe endpoint.
func (c *passportClient) FollowUpdates(ctx context.Context, q url.Values) (ListResult, error) {
	params := url.Values{
		"cursor":   {q.Get("cursor")},
		"count":    {"20"},
		"tab_type": {"14"},
	}
	p, err := c.cloudJSON(ctx, "/reading/user/subscribe/list/v1/", http.MethodGet, params, nil)
	if err != nil {
		return ListResult{}, err
	}
	d, err := dataMap(p)
	if err != nil {
		return ListResult{}, err
	}
	// v1.1.8 macOS calls this response mix_data. Keep the older names as
	// compatibility fallbacks because the service has returned both shapes.
	rows, _ := d["mix_data"].([]any)
	if rows == nil {
		rows, _ = d["follow_update_list"].([]any)
	}
	if rows == nil {
		rows, _ = d["subscribe_items"].([]any)
	}
	nextCursor := firstNonEmpty(asString(d["cursor"]), asString(d["next_cursor"]))
	hasMore := asBool(d["has_more"])
	if info, ok := asMap(d["follow_list_info"]); ok {
		nextCursor = firstNonEmpty(nextCursor, asString(info["cursor"]))
		hasMore = hasMore || asBool(info["has_more"])
	}
	if info, ok := asMap(d["comment_list_info"]); ok {
		nextCursor = firstNonEmpty(nextCursor, asString(info["cursor"]))
		hasMore = hasMore || asBool(info["has_more"])
	}
	out := ListResult{CategoryResult: CategoryResult{Items: []Drama{}, HasMore: hasMore, SessionID: asString(d["session_id"])}, NextCursor: nextCursor, Source: "follow_updates"}
	for _, raw := range rows {
		if item, ok := followDrama(raw); ok {
			out.Items = append(out.Items, item)
		}
	}
	if out.NextCursor == "" || out.NextCursor == q.Get("cursor") {
		out.HasMore = false
	}
	return out, nil
}

func followDrama(raw any) (Drama, bool) {
	m, ok := asMap(raw)
	if !ok {
		return Drama{}, false
	}
	if nested, exists := m["video_data"]; exists {
		if value, nestedOK := asMap(nested); nestedOK {
			m = value
		}
	}
	// The macOS client receives rawFollowUpdate as common + expand. Its
	// model uses video_id as the stable series id and overlays progress fields
	// from expand onto the common card fields.
	if common, exists := m["common"]; exists {
		if commonMap, commonOK := asMap(common); commonOK {
			merged := map[string]any{}
			for key, value := range commonMap {
				merged[key] = value
			}
			if expand, expandOK := asMap(m["expand"]); expandOK {
				for key, value := range expand {
					merged[key] = value
				}
				if extra, extraOK := asMap(expand["extra"]); extraOK {
					for key, value := range extra {
						merged[key] = value
					}
				}
				if updateInfo, updateOK := asMap(expand["update_info"]); updateOK {
					for key, value := range updateInfo {
						merged[key] = value
					}
				}
			}
			for _, key := range []string{"series_id", "series_id_str", "seriesId", "book_id", "id"} {
				if asString(merged[key]) == "" {
					merged[key] = firstNonEmpty(m[key], m["video_id"], m["video_id_str"])
				}
			}
			m = merged
		}
	}
	d, ok := normalizeDrama(m)
	if !ok {
		return Drama{}, false
	}
	d.FollowingUpdate = true
	d.Followed = true
	if d.LatestWatchedEpisode == 0 {
		d.LatestWatchedEpisode = firstPositive(asInt(m["latest_watched_index"]), asInt(m["latest_watched_vid_index"]))
	}
	return d, true
}

func (c *passportClient) SetFollowUpdate(ctx context.Context, seriesID string, enabled bool) error {
	if !validID(seriesID) || seriesID == "0" {
		return errors.New("追更项目无效")
	}
	// v1.1.8 exposes one subscribe mutation route. The operation is selected by
	// op_type; there is no add route string in the desktop binary. Keep this
	// separate from uncover_subscribe, which is the reservation API.
	path := "/reading/user/subscribe/delete/v"
	body := map[string]any{
		"series_id": seriesID,
		"book_id":   seriesID,
		"book_type": 2,
		"op_type":   map[bool]int{true: 1, false: 2}[enabled],
	}
	_, err := c.cloudJSON(ctx, path, http.MethodPost, nil, body)
	return err
}
