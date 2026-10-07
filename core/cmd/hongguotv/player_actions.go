package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
)

// Protocol values are recovered from the Mac client's comment/reply methods.
// No account writes are made during probing or browser fixture verification.
type PlayerAction struct {
	Action    string `json:"action"`
	SeriesID  string `json:"series_id"`
	Vid       string `json:"vid"`
	CommentID string `json:"comment_id,omitempty"`
	Text      string `json:"text,omitempty"`
	OffsetMS  int64  `json:"offset_ms,omitempty"`
	Value     *bool  `json:"value,omitempty"`
}

func (a PlayerAction) validate() error {
	if !validID(a.SeriesID) || a.SeriesID == "0" || !validID(a.Vid) || a.Vid == "0" {
		return errors.New("缺少当前短剧或视频 ID")
	}
	switch a.Action {
	case "comment", "reply", "danmaku":
		limit := 500
		if a.Action == "danmaku" {
			limit = 100
		}
		if strings.TrimSpace(a.Text) == "" || !utf8.ValidString(a.Text) || utf8.RuneCountInString(a.Text) > limit {
			return errors.New("内容为空或超过字数限制")
		}
	case "comment-like":
		if a.Value == nil {
			return errors.New("缺少点赞状态")
		}
	case "comment-delete":
	default:
		return errors.New("播放操作无效")
	}
	if a.Action == "reply" || a.Action == "comment-like" || a.Action == "comment-delete" {
		if !validID(a.CommentID) || a.CommentID == "0" {
			return errors.New("评论 ID 无效")
		}
	}
	if a.OffsetMS < 0 || a.OffsetMS > 86400000 {
		return errors.New("弹幕时间无效")
	}
	return nil
}

func playerShark() map[string]any {
	return map[string]any{"enter_from": "MainFragmentActivity", "previous_page": "", "page_list": "MainFragmentActivity"}
}

func (c *passportClient) PlayerAction(ctx context.Context, a PlayerAction) (*DiscussionItem, error) {
	if err := a.validate(); err != nil {
		return nil, err
	}
	business := map[string]any{"ignore_urge_rule": false, "book_id": a.SeriesID, "shark_param": playerShark()}
	path := "/novel/commentapi/comment/add/v1/"
	var body map[string]any
	if a.Action == "comment-like" {
		action := 9
		if *a.Value {
			action = 8
		}
		body = map[string]any{"object_id": a.CommentID, "object_type": 8, "action_type": action, "comment_type": 4, "business_param": map[string]any{"shark_param": playerShark()}}
		path = "/novel/commentapi/comment/do_action/v1/"
	} else if a.Action == "comment-delete" {
		body = map[string]any{"comment_id": a.CommentID, "service_id": 4, "data_type": 4}
		path = "/novel/commentapi/comment/del/v1/"
	} else {
		dataType, commit := 4, 3
		business["offset"] = 0
		if a.Action == "danmaku" {
			dataType, commit = 20, 1500
			business["offset"] = a.OffsetMS
			shark := business["shark_param"].(map[string]any)
			shark["type"], shark["aid"] = "short_play", "8662"
		} else {
			business["text_feature"] = map[string]any{}
			business["has_aigc_content"] = false
			business["log_extra"] = map[string]any{}
		}
		if a.Action == "comment" {
			business["preset_text_id"] = ""
		}
		if a.Action == "reply" {
			commit = 9
			path = "/novel/commentapi/reply/add/v1/"
		}
		body = map[string]any{"commit_source": commit, "group_id": a.Vid, "group_type": 30, "data_type": dataType, "text": strings.TrimSpace(a.Text), "business_param": business, "aid": 8662}
		if a.Action == "reply" {
			body["reply_to_comment_id"] = a.CommentID
		}
	}
	p, err := c.cloudJSON(ctx, path, http.MethodPost, nil, body)
	if err != nil {
		return nil, err
	}
	if a.Action == "comment-like" || a.Action == "comment-delete" {
		return nil, nil
	}
	d, err := dataMap(p)
	if err != nil {
		return nil, err
	}
	info, _ := asMap(d["comment_info"])
	id := asString(info["comment_id"])
	if a.Action == "reply" {
		info, _ = asMap(d["reply"])
		id = asString(info["reply_id"])
	}
	if !validID(id) || id == "0" {
		return nil, errors.New("服务未返回发布结果，请刷新查看，避免重复发送")
	}
	return &DiscussionItem{CommentID: id, Text: strings.TrimSpace(a.Text), OffsetMS: a.OffsetMS, Own: true}, nil
}

func (s *server) playerAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method not allowed")
		return
	}
	var a PlayerAction
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&a); err != nil {
		writeError(w, 400, "播放操作参数无效")
		return
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		writeError(w, 400, "播放操作参数无效")
		return
	}
	if err := a.validate(); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	c, generation, err := s.accounts.listClient(true)
	if err != nil {
		writeError(w, 401, err.Error())
		return
	}
	out, err := c.PlayerAction(r.Context(), a)
	if !s.accounts.sameGeneration(generation) {
		writeError(w, 409, errAccountChanged.Error())
		return
	}
	if err != nil {
		writeError(w, 502, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": out})
}

func (c *passportClient) Replies(ctx context.Context, q url.Values) (DiscussionResult, error) {
	series, vid, id := q.Get("series_id"), q.Get("vid"), q.Get("comment_id")
	for _, v := range []string{series, vid, id} {
		if !validID(v) || v == "0" {
			return DiscussionResult{}, errors.New("回复参数无效")
		}
	}
	if len(q.Get("cursor")) > 4000 {
		return DiscussionResult{}, errors.New("回复游标过长")
	}
	params := map[string]any{"comment_source": 504, "server_channel": 18, "comment_id": id, "comment_type": 4, "group_id": vid, "group_type": 30, "business_param": map[string]any{"need_count": true, "book_id": series}, "count": 10, "cursor": firstNonEmpty(q.Get("cursor"), "0"), "aid": 8662, "compliance_status": 0}
	// The upstream list method is a read-only POST with a JSON body. Sending
	// these values as GET query parameters returns "book_id or comment_id invalid".
	p, err := c.cloudJSON(ctx, "/novel/commentapi/reply/list/"+id+"/v1/", http.MethodPost, nil, params)
	if err != nil {
		return DiscussionResult{}, err
	}
	d, err := dataMap(p)
	if err != nil {
		return DiscussionResult{}, err
	}
	info, ok := asMap(d["comment_list_info"])
	if !ok {
		return DiscussionResult{}, errors.New("回复响应缺少分页信息")
	}
	rows, ok := d["reply_list"].([]any)
	if !ok {
		return DiscussionResult{}, errors.New("回复列表格式无效")
	}
	out := DiscussionResult{Items: []DiscussionItem{}, HasMore: asBool(info["has_more"]), NextCursor: asString(info["cursor"]), Total: asInt(info["total"])}
	for _, value := range rows {
		row, _ := asMap(value)
		if reply, ok := asMap(row["reply"]); ok {
			row = reply
		}
		item := discussionItem(row, true, c.uid)
		if item.CommentID != "" && item.Text != "" {
			out.Items = append(out.Items, item)
		}
	}
	if out.NextCursor == "" || out.NextCursor == q.Get("cursor") {
		out.HasMore = false
	}
	return out, nil
}
