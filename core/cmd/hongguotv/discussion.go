package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
)

type DiscussionItem struct {
	CommentID string `json:"comment_id"`
	Text      string `json:"text"`
	Author    string `json:"author,omitempty"`
	Avatar    string `json:"avatar,omitempty"`
	Created   int64  `json:"created,omitempty"`
	Likes     int    `json:"likes,omitempty"`
	Replies   int    `json:"replies,omitempty"`
	OffsetMS  int64  `json:"offset_ms"`
}
type DiscussionResult struct {
	Items      []DiscussionItem `json:"items"`
	HasMore    bool             `json:"has_more"`
	NextCursor string           `json:"next_cursor,omitempty"`
	Total      int              `json:"total"`
	WindowEnd  int64            `json:"window_end,omitempty"`
}

func (c *passportClient) Discussion(ctx context.Context, q url.Values, danmaku bool) (DiscussionResult, error) {
	series, vid := q.Get("series_id"), q.Get("vid")
	if !validID(series) || !validID(vid) || series == "0" || vid == "0" {
		return DiscussionResult{}, errors.New("缺少短剧或集的视频 ID")
	}
	if len(q.Get("cursor")) > 4000 {
		return DiscussionResult{}, errors.New("评论游标过长")
	}
	business, _ := json.Marshal(map[string]any{"need_count": true, "book_id": series, "req_type": 0})
	params := url.Values{"comment_source": {"4"}, "server_channel": {"18"}, "group_id": {vid}, "group_type": {"30"}, "comment_type": {"4"}, "sort": {"1"}, "need_count": {"true"}, "book_id": {series}, "req_type": {"0"}, "business_param": {string(business)}, "count": {"20"}, "cursor": {firstNonEmpty(q.Get("cursor"), "0")}, "aid": {"8662"}, "compliance_status": {"0"}}
	if danmaku {
		start, e := strconv.ParseInt(firstNonEmpty(q.Get("start"), "0"), 10, 64)
		if e != nil || start < 0 || start > 86400000 {
			return DiscussionResult{}, errors.New("弹幕时间无效")
		}
		duration, e := strconv.ParseInt(firstNonEmpty(q.Get("duration"), "600000"), 10, 64)
		if e != nil || duration < 1 || duration > 86400000 {
			return DiscussionResult{}, errors.New("视频时长无效")
		}
		params.Set("comment_source", "601")
		params.Set("server_channel", "1000")
		params.Set("comment_type", "20")
		params.Set("start_offset_time", strconv.FormatInt(start, 10))
		params.Set("playlet_item_duration", strconv.FormatInt(duration, 10))
		params.Set("need_danmaku_guide_type", "24")
		params.Set("count", "90")
		params.Set("cursor", "0")
	}
	// VID belongs in the URL. A comment-type number in this position returns a
	// valid-looking empty response, which would hide real comments.
	p, e := c.cloudJSON(ctx, "/novel/commentapi/comment/list/"+vid+"/v1/", http.MethodGet, params, nil)
	if e != nil {
		return DiscussionResult{}, e
	}
	d, e := dataMap(p)
	if e != nil {
		return DiscussionResult{}, e
	}
	info, ok := asMap(d["common_list_info"])
	if !ok {
		return DiscussionResult{}, errors.New("评论响应缺少分页信息")
	}
	out := DiscussionResult{Items: []DiscussionItem{}, HasMore: asBool(info["has_more"]), NextCursor: asString(info["cursor"]), Total: asInt(info["total"])}
	rows, ok := d["data_list"].([]any)
	if !ok {
		return DiscussionResult{}, errors.New("评论列表格式无效")
	}
	for _, value := range rows {
		row, _ := asMap(value)
		comment, _ := asMap(row["comment"])
		common, _ := asMap(comment["common"])
		content, _ := asMap(common["content"])
		expand, _ := asMap(comment["expand"])
		stat, _ := asMap(comment["stat"])
		user, _ := asMap(common["user_info"])
		base, _ := asMap(user["base_info"])
		id, text := asString(comment["comment_id"]), asString(content["text"])
		if id == "" || text == "" {
			continue
		}
		out.Items = append(out.Items, DiscussionItem{CommentID: id, Text: text, Author: asString(base["user_name"]), Avatar: firstNonEmpty(asString(base["expand_user_avatar"]), asString(base["user_avatar"])), Created: asInt64(common["create_timestamp"]), Likes: asInt(stat["digg_count"]), Replies: asInt(stat["reply_count"]), OffsetMS: asInt64(expand["offset_time"])})
	}
	if out.NextCursor == "" || out.NextCursor == q.Get("cursor") {
		out.HasMore = false
	}
	if danmaku {
		var cursor map[string]any
		json.Unmarshal([]byte(out.NextCursor), &cursor)
		out.WindowEnd = asInt64(cursor["end_offset_time"])
	}
	return out, nil
}

func (s *server) discussion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, 405, "method not allowed")
		return
	}
	c, g, e := s.accounts.listClient(false)
	if e != nil {
		writeError(w, 401, e.Error())
		return
	}
	out, e := c.Discussion(r.Context(), r.URL.Query(), r.URL.Path == "/api/v1/danmaku")
	if !s.accounts.sameGeneration(g) {
		writeError(w, 409, errAccountChanged.Error())
		return
	}
	if e != nil {
		writeError(w, 502, e.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": out})
}
