package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Every pageable list uses the same TV contract. Server cursors are not derived
// from the number of visible cards: calendar/search may contain non-video rows.
type ListResult struct {
	CategoryResult
	SearchID string          `json:"search_id,omitempty"`
	Passback string          `json:"passback,omitempty"`
	Calendar *CalendarSchema `json:"calendar,omitempty"`
	Ranks    []RankOption    `json:"ranks,omitempty"`
	Source   string          `json:"source,omitempty"`
	FeedCell string          `json:"feed_cell,omitempty"`
	FeedPlan string          `json:"feed_plan,omitempty"`
}
type CalendarSchema struct {
	Dates       []string `json:"dates"`
	DefaultDate string   `json:"default_date"`
	CurrentDate string   `json:"current_date"`
}
type RankOption struct {
	ID       string              `json:"id"`
	Label    string              `json:"label"`
	Selected bool                `json:"selected,omitempty"`
	Children []RankOption        `json:"children,omitempty"`
	Panels   []CategoryFilterRow `json:"panels,omitempty"`
}

var errListLogin = errors.New("请先登录红果账号")
var errAccountChanged = errors.New("账号已切换，请重新读取")

// Copy credentials under the account lock, then release it before networking.
// A response from a previous account must never populate the current screen.
func (m *accountManager) listClient(requireLogin bool) (*passportClient, uint64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if requireLogin && m.disk.Profile == nil {
		return nil, 0, errListLogin
	}
	c := m.newClient(m.disk.Session)
	if m.disk.Profile != nil {
		c.uid = m.disk.Profile.UID
	}
	return c, m.generation, nil
}
func (m *accountManager) sameGeneration(g uint64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return g == m.generation
}

func listQuery(r *http.Request) (url.Values, error) {
	q := r.URL.Query()
	offset, err := strconv.Atoi(firstNonEmpty(q.Get("offset"), "0"))
	if err != nil || offset < 0 || offset > 100000 {
		return nil, errors.New("分页位置无效")
	}
	for _, k := range []string{"session_id", "passback", "search_id", "shown", "rank", "rank_sub", "rank_panel"} {
		if len(q.Get(k)) > 12000 {
			return nil, errors.New("分页参数过长")
		}
	}
	return q, nil
}
func listCursor(d map[string]any) CategoryResult {
	return CategoryResult{Items: []Drama{}, HasMore: asBool(d["has_more"]), NextOffset: asInt(d["next_offset"]), SessionID: asString(d["session_id"])}
}
func stopStalledPage(result *ListResult, offset int) {
	if result.NextOffset <= offset {
		result.HasMore = false
	}
}
func dataMap(p map[string]any) (map[string]any, error) {
	d, ok := asMap(p["data"])
	if !ok {
		return nil, errors.New("红果列表响应缺少 data")
	}
	return d, nil
}
func appendDramas(rows any, items *[]Drama) {
	values, _ := rows.([]any)
	for _, v := range values {
		if d, ok := normalizeDrama(v); ok && validID(d.SeriesID) {
			*items = append(*items, d)
		}
	}
}
func categoryTags(v any) []string {
	var out []string
	rows, _ := v.([]any)
	for _, row := range rows {
		m, _ := asMap(row)
		if s := asString(m["content"]); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func (c *passportClient) NewSeries(ctx context.Context, q url.Values) (ListResult, error) {
	params := url.Values{"change_type": {"1"}, "selected_items": {"firstonlinetime_new"}, "client_req_type": {"1"}, "cell_id": {"7431550523368554558"}, "limit": {"20"}, "offset": {firstNonEmpty(q.Get("offset"), "0")}, "cell_gender": {firstNonEmpty(q.Get("gender"), "2")}, "session_id": {q.Get("session_id")}}
	p, e := c.cloudJSON(ctx, "/reading/bookapi/bookmall/cell/change/v1/", http.MethodGet, params, nil)
	if e != nil {
		return ListResult{}, e
	}
	d, e := dataMap(p)
	if e != nil {
		return ListResult{}, e
	}
	cv, _ := asMap(d["cell_view"])
	out := ListResult{CategoryResult: listCursor(d)}
	appendDramas(cv["video_data"], &out.Items)
	stopStalledPage(&out, asInt(q.Get("offset")))
	return out, nil
}

// The Mac feed uses a dedicated cell, not the hot-drama ranking. The cursor
// counts feed cells, including ads; only video_detail records become TV cards.
func feedDramas(cells []any) []Drama {
	out := []Drama{}
	for _, value := range cells {
		cell, _ := asMap(value)
		videos, _ := cell["video_data"].([]any)
		for _, value := range videos {
			video, _ := asMap(value)
			detail, _ := asMap(video["video_detail"])
			if asBool(video["disable_play"]) {
				continue
			}
			drama, ok := normalizeDrama(detail)
			if !ok || !validID(drama.SeriesID) || drama.EpisodeCount < 1 {
				continue
			}
			drama.Vid = firstNonEmpty(asString(detail["first_vid"]), drama.Vid)
			out = append(out, drama)
		}
		if nested, ok := cell["cell_data"].([]any); ok {
			out = append(out, feedDramas(nested)...)
		}
	}
	return out
}
func (c *passportClient) Recommendations(ctx context.Context, q url.Values) (ListResult, error) {
	tab := firstNonEmpty(q.Get("channel"), "16")
	if tab != "16" && tab != "36" && tab != "39" && tab != "45" {
		return ListResult{}, errors.New("推荐频道无效")
	}
	cell, plan := q.Get("feed_cell"), q.Get("feed_plan")
	if tab == "16" {
		cell = "7294257141911650341"
		plan = "7294257258253254693"
	}
	if cell != "" && plan != "" {
		if !validID(cell) || !validID(plan) || len(cell) > 30 || len(plan) > 30 {
			return ListResult{}, errors.New("推荐分页标识无效")
		}
		params := url.Values{"bottom_tab_type": {"7"}, "client_req_type": {"2"}, "client_template": {"7"}, "change_type": {"0"}, "category_id": {"0"}, "cell_sub_id": {"0"}, "limit": {"0"}, "need_personal_recommend": {"1"}, "video_type_preferences_str": {"[]"}, "cell_id": {cell}, "plan_id": {plan}, "tab_type": {tab}, "offset": {firstNonEmpty(q.Get("offset"), "0")}, "session_id": {q.Get("session_id")}, "filter_ids": {q.Get("shown")}}
		p, e := c.cloudJSON(ctx, "/reading/bookapi/bookmall/cell/change/v", http.MethodGet, params, nil)
		if e != nil {
			return ListResult{}, e
		}
		d, e := dataMap(p)
		if e != nil {
			return ListResult{}, e
		}
		cv, _ := asMap(d["cell_view"])
		cells, _ := cv["cell_data"].([]any)
		out := ListResult{CategoryResult: listCursor(d), FeedCell: cell, FeedPlan: plan}
		out.Items = feedDramas(cells)
		stopStalledPage(&out, asInt(q.Get("offset")))
		return out, nil
	}
	// Non-default channels start with tab/v. The returned cell/plan then enter
	// cell/change with offset zero, matching the original feedCursor phase switch.
	params := url.Values{"bottom_tab_type": {"7"}, "landing_bottom_tab_type": {"7"}, "need_personal_recommend": {"1"}, "device_level": {"3"}, "screen_width_px": {"1078"}, "is_horizontal_screen": {"false"}, "disable_digg_stat": {"false"}, "auth_aweme": {"true"}, "auth_backward": {"true"}, "has_video_cache": {"false"}, "last_tab_type": {"0"}, "last_tab_index": {"0"}, "tab_index": {"0"}, "req_rank_category_id": {"0"}, "video_type_preferences_str": {"[]"}, "tab_type": {tab}, "offset": {"0"}, "session_id": {""}, "client_req_type": {"1"}}
	p, e := c.cloudJSON(ctx, "/reading/bookapi/bookmall/tab/v", http.MethodGet, params, nil)
	if e != nil {
		return ListResult{}, e
	}
	d, e := dataMap(p)
	if e != nil {
		return ListResult{}, e
	}
	tabs, _ := d["tab_item"].([]any)
	for _, value := range tabs {
		t, _ := asMap(value)
		if asString(t["tab_type"]) != tab {
			continue
		}
		cells, _ := t["cell_data"].([]any)
		out := ListResult{CategoryResult: CategoryResult{Items: feedDramas(cells), SessionID: asString(t["session_id"])}, FeedPlan: asString(t["bookstore_id"])}
		for _, value := range cells {
			cell, _ := asMap(value)
			id := firstNonEmpty(asString(cell["cell_id_str"]), asString(cell["cell_id"]))
			if id == "0" || !validID(id) {
				continue
			}
			// Follow cells are followed content (648), never the suggested actors (647).
			if tab == "45" && asInt(cell["show_type"]) != 648 {
				continue
			}
			out.FeedCell = id
			out.HasMore = asBool(t["bottom_unlimited"])
			if tab == "45" {
				out.HasMore = asBool(cell["has_more"])
				out.NextOffset = asInt(cell["next_offset"])
				out.Items = feedDramas([]any{cell})
			}
			break
		}
		return out, nil
	}
	return ListResult{}, errors.New("推荐响应没有对应频道")
}

func rankOptions(selector any) []RankOption {
	m, _ := asMap(selector)
	row, _ := asMap(m["outer_row"])
	rows, _ := row["items"].([]any)
	var out []RankOption
	for _, v := range rows {
		x, _ := asMap(v)
		id, label := asString(x["selector_item_id"]), asString(x["show_name"])
		if label == "" {
			continue
		}
		r := RankOption{ID: id, Label: label, Selected: asBool(x["is_selected"]), Children: rankOptions(x["sub_cell_selector"])}
		panel, _ := asMap(x["panel_selector"])
		inners, _ := panel["inner_rows"].([]any)
		for _, v := range inners {
			row, _ := asMap(v)
			f := CategoryFilterRow{Type: asString(row["type"]), Label: asString(row["row_name"])}
			options, _ := row["items"].([]any)
			for _, v := range options {
				x, _ := asMap(v)
				if label := asString(x["show_name"]); label != "" {
					f.Options = append(f.Options, CategoryFilterOption{ID: asString(x["selector_item_id"]), Label: label})
				}
			}
			r.Panels = append(r.Panels, f)
		}
		out = append(out, r)
	}
	return out
}
func (c *passportClient) RankList(ctx context.Context, q url.Values) (ListResult, error) {
	tab := "26"
	if asInt(q.Get("offset")) > 0 {
		tab = "18"
	}
	params := url.Values{"tab_type": {tab}, "client_req_type": {"2"}, "client_template": {"2"}, "background_selected_items": {""}, "category_id": {"0"}, "limit": {"20"}, "cell_sub_id": {"0"}, "gender": {"2"}, "cell_id": {"7470092475068071998"}, "selected_items": {q.Get("rank")}, "sub_selected_items": {q.Get("rank_sub")}, "panel_selected_items": {q.Get("rank_panel")}, "offset": {firstNonEmpty(q.Get("offset"), "0")}, "session_id": {q.Get("session_id")}, "filter_ids": {q.Get("shown")}, "unlimited_selector_change_type": {"0"}}
	p, e := c.cloudJSON(ctx, "/reading/bookapi/bookmall/cell/change/v", http.MethodGet, params, nil)
	if e != nil {
		return ListResult{}, e
	}
	d, e := dataMap(p)
	if e != nil {
		return ListResult{}, e
	}
	cv, _ := asMap(d["cell_view"])
	out := ListResult{CategoryResult: listCursor(d), Ranks: rankOptions(cv["cell_selector"])}
	rows, _ := cv["cell_data"].([]any)
	for _, v := range rows {
		cell, _ := asMap(v)
		videos := cell["video_data"]
		if m, ok := asMap(videos); ok {
			videos = []any{m}
		}
		appendDramas(videos, &out.Items)
		actors, _ := cell["ugc_user_data"].([]any)
		for _, v := range actors {
			a, _ := asMap(v)
			u, _ := asMap(a["user_info"])
			b, _ := asMap(u["base_info"])
			id := asString(b["actor_id_str"])
			if !validID(id) {
				continue
			}
			rec, _ := asMap(a["rec_text_item"])
			out.Items = append(out.Items, Drama{SeriesID: "actor-" + id, ActorID: id, Title: asString(b["user_name"]), Cover: asString(b["user_avatar"]), Intro: asString(a["intro"]), Heat: asString(rec["RecommendText"]), Tags: categoryTags(a["sub_title_list"])})
		}
	}
	if _, exists := d["next_offset"]; !exists {
		out.CategoryResult.HasMore = asBool(cv["has_more"])
		out.NextOffset = asInt(cv["next_offset"])
		out.SessionID = asString(cv["session_id"])
	}
	stopStalledPage(&out, asInt(q.Get("offset")))
	return out, nil
}

func reservationDrama(v any) (Drama, bool) {
	x, ok := asMap(v)
	if !ok {
		return Drama{}, false
	}
	sub, _ := asMap(x["subscribe_data"])
	itemID := asString(x["item_id"])
	d, ok := normalizeDrama(sub)
	if !ok {
		if !validID(itemID) {
			return Drama{}, false
		}
		d = Drama{SeriesID: itemID, Title: asString(x["name"]), Cover: asString(x["cover"]), Intro: asString(x["item_desc"])}
	}
	if d.Title == "" {
		return Drama{}, false
	}
	d.ReservationID = itemID
	if !validID(itemID) || itemID == "0" {
		d.ReservationID = ""
	}
	d.Upcoming = !asBool(x["is_online"])
	d.Reserved = asBool(x["has_subscribed"])
	d.PublishTime = asInt64(x["schedule_publish_time"])
	if d.PublishTime == 0 {
		d.PublishTime = asInt64(x["expected_publish_time"])
	}
	d.PublishText = firstNonEmpty(asString(x["sub_info"]), asString(x["expected_rec_text"]))
	d.Tags = asStringSlice(x["categories"])
	if len(d.Tags) == 0 {
		d.Tags = categoryTags(x["sub_title_list"])
	}
	d.CoverFallback = browserCoverFallback(d.Cover)
	return d, true
}
func (c *passportClient) SubscriptionList(ctx context.Context, q url.Values, calendar bool) (ListResult, error) {
	params := url.Values{"offset": {firstNonEmpty(q.Get("offset"), "0")}, "subscribe_offset": {firstNonEmpty(q.Get("offset"), "0")}, "session_id": {q.Get("session_id")}}
	if calendar {
		params.Set("tab_type", "5")
		params.Set("tab_style", "2")
		params.Set("active_panel", "6")
		params.Set("gender_type", firstNonEmpty(q.Get("gender"), "2"))
		params.Set("need_calendar_schema", "true")
		if date := q.Get("date"); date != "" {
			if _, err := time.Parse("20060102", date); err != nil {
				return ListResult{}, errors.New("日历日期无效")
			}
			params.Set("target_date", date)
		}
	} else {
		params.Set("tab_type", "13")
		params.Set("subscribe_order_type", "0")
		params.Set("swipe_type", "0")
		params.Set("need_calendar_schema", "false")
		params.Set("limit", "20")
		params.Set("is_online", strconv.FormatBool(q.Get("mode") != "upcoming"))
	}
	p, e := c.cloudJSON(ctx, "/reading/user/subscribe/list/v1/", http.MethodGet, params, nil)
	if e != nil {
		return ListResult{}, e
	}
	d, e := dataMap(p)
	if e != nil {
		return ListResult{}, e
	}
	out := ListResult{CategoryResult: listCursor(d)}
	rows, _ := d["subscribe_items"].([]any)
	for _, v := range rows {
		if item, ok := reservationDrama(v); ok {
			if !calendar {
				item.Reserved = true
			}
			out.Items = append(out.Items, item)
		}
	}
	if x, ok := asMap(d["calendar_schema"]); ok {
		out.Calendar = &CalendarSchema{Dates: asStringSlice(x["date_list"]), DefaultDate: asString(x["default_date"]), CurrentDate: asString(x["current_date"])}
	}
	stopStalledPage(&out, asInt(q.Get("offset")))
	return out, nil
}
func (c *passportClient) SetReservation(ctx context.Context, id string, reserve bool) error {
	if !validID(id) || id == "0" {
		return errors.New("预约项目无效")
	}
	op := 2
	if reserve {
		op = 1
	}
	body := map[string]any{"item_id": id, "item_type": int64(1), "op_type": op, "shark_param": map[string]any{"enter_from": "BulletActivity", "previous_page": "MainFragmentActivity", "page_list": "MainFragmentActivity,BulletActivity"}, "wish_list_all_del": 0}
	_, e := c.cloudJSON(ctx, "/reading/bookapi/search/uncover_subscribe/v", http.MethodPost, nil, body)
	return e
}

func (c *passportClient) SearchList(ctx context.Context, q url.Values) (ListResult, error) {
	query := strings.TrimSpace(q.Get("q"))
	if query == "" || len([]rune(query)) > 80 {
		return ListResult{}, errors.New("搜索关键词无效")
	}
	params := url.Values{"bookshelf_search_plan": {"4"}, "use_correct": {"true"}, "query": {query}, "count": {"100"}, "offset": {firstNonEmpty(q.Get("offset"), "0")}, "tab_type": {"11"}, "search_id": {q.Get("search_id")}, "passback": {q.Get("passback")}}
	p, e := c.cloudJSON(ctx, "/reading/bookapi/search/tab/v", http.MethodGet, params, nil)
	if e != nil {
		return ListResult{}, e
	}
	return parseSearchList(p, asInt(q.Get("offset")))
}
func parseSearchList(p map[string]any, offset int) (ListResult, error) {
	d, _ := asMap(p["data"])
	tabs, _ := d["search_tabs"].([]any)
	if tabs == nil {
		tabs, _ = p["search_tabs"].([]any)
	}
	for _, v := range tabs {
		tab, _ := asMap(v)
		if asInt(tab["tab_type"]) != 11 {
			continue
		}
		out := ListResult{CategoryResult: listCursor(tab), SearchID: asString(tab["search_id"]), Passback: asString(tab["passback"]), Source: "app"}
		rows, _ := tab["data"].([]any)
		// Search cells may group dramas or carry JSON encoded Lynx content.
		var expand func(any, int)
		expand = func(v any, depth int) {
			if depth > 5 {
				return
			}
			switch x := v.(type) {
			case []any:
				for _, v := range x {
					expand(v, depth+1)
				}
			case map[string]any:
				if values, ok := x["video_data"].([]any); ok {
					appendDramas(values, &out.Items)
				} else if d, ok := normalizeDrama(x); ok && validID(d.SeriesID) && d.EpisodeCount > 0 {
					out.Items = append(out.Items, d)
				}
				for _, k := range []string{"cell_data", "data", "items"} {
					if v := x[k]; v != nil {
						expand(v, depth+1)
					}
				}
				if raw := asString(x["lynx_data"]); raw != "" {
					dec := json.NewDecoder(strings.NewReader(raw))
					dec.UseNumber()
					var v any
					if dec.Decode(&v) == nil {
						expand(v, depth+1)
					}
				}
			}
		}
		expand(rows, 0)
		stopStalledPage(&out, offset)
		return out, nil
	}
	return ListResult{}, errors.New("搜索响应没有短剧分区")
}

func (s *server) lists(w http.ResponseWriter, r *http.Request) {
	kind := strings.TrimPrefix(r.URL.Path, "/api/v1/lists/")
	if r.Method != http.MethodGet {
		writeError(w, 405, "method not allowed")
		return
	}
	q, e := listQuery(r)
	if e != nil {
		writeError(w, 400, e.Error())
		return
	}
	if g := q.Get("gender"); g != "" && g != "0" && g != "1" && g != "2" {
		writeError(w, 400, "频道参数无效")
		return
	}
	client, g, e := s.accounts.listClient(kind == "reservations" || kind == "recommend" && q.Get("channel") == "45")
	if e != nil {
		writeError(w, 401, e.Error())
		return
	}
	var out ListResult
	switch kind {
	case "recommend":
		out, e = client.Recommendations(r.Context(), q)
	case "new":
		out, e = client.NewSeries(r.Context(), q)
	case "rank":
		out, e = client.RankList(r.Context(), q)
	case "calendar", "reservations":
		out, e = client.SubscriptionList(r.Context(), q, kind == "calendar")
	case "search":
		out, e = client.SearchList(r.Context(), q)
		// The anonymous app search may return an empty HTTP 200 body. Preserve the
		// working website search at page one; do not invent a remote next cursor.
		if e != nil && asInt(q.Get("offset")) == 0 && q.Get("source") != "app" {
			var web SearchResult
			web, e = s.hongguo.Search(r.Context(), q.Get("q"))
			out = ListResult{CategoryResult: CategoryResult{Items: web.Items}, Source: "web"}
		}
	default:
		writeError(w, 404, "没有这个列表")
		return
	}
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
func (s *server) reservation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method not allowed")
		return
	}
	var body struct {
		ItemID   string `json:"item_id"`
		Reserved *bool  `json:"reserved"`
	}
	if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&body); e != nil || body.Reserved == nil {
		writeError(w, 400, "预约参数无效")
		return
	}
	c, g, e := s.accounts.listClient(true)
	if e != nil {
		writeError(w, 401, e.Error())
		return
	}
	e = c.SetReservation(r.Context(), body.ItemID, *body.Reserved)
	if !s.accounts.sameGeneration(g) {
		writeError(w, 409, errAccountChanged.Error())
		return
	}
	if e != nil {
		writeError(w, 502, e.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
