package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	defaultHongguoAPI = "https://api5-normal-sinfonlineb.fqnovel.com"
	defaultHongguoWeb = "https://hongguoduanju.com"
	defaultHongguoUA  = "com.phoenix.read/73532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)"
)

// Drama is the stable TV-facing model shared by category cards and details.
// The IDs remain strings because Hongguo uses 19-digit identifiers and a
// JavaScript number would round them.
type Drama struct {
	SeriesID             string    `json:"series_id"`
	Title                string    `json:"title"`
	Cover                string    `json:"cover"`
	Intro                string    `json:"intro"`
	Score                string    `json:"score,omitempty"`
	PlayCount            int64     `json:"play_count,omitempty"`
	EpisodeCount         int       `json:"episode_count,omitempty"`
	AccessibleEpisodeCnt int       `json:"accessible_episode_cnt,omitempty"`
	Vid                  string    `json:"vid,omitempty"`
	VidList              []string  `json:"vid_list,omitempty"`
	Tags                 []string  `json:"tags,omitempty"`
	Episodes             []Episode `json:"episodes,omitempty"`
}

type Episode struct {
	Index   int    `json:"index"`
	VideoID string `json:"video_id"`
	Title   string `json:"title,omitempty"`
	Locked  bool   `json:"locked"`
}

type CategoryRequest struct {
	Path      string
	Offset    int
	SessionID string
	Shown     []string
}

type CategoryResult struct {
	Items      []Drama `json:"items"`
	HasMore    bool    `json:"has_more"`
	NextOffset int     `json:"next_offset"`
	SessionID  string  `json:"session_id,omitempty"`
}

type SeriesDetailResult struct {
	Drama
	Related []Drama `json:"related,omitempty"`
}

type SearchResult struct {
	Items []Drama `json:"items"`
}

type PlayInfo struct {
	Path    string `json:"path"`
	Quality string `json:"quality,omitempty"`
	Vid     string `json:"vid"`
}

type hongguoClient struct {
	httpClient       *http.Client
	apiBase          string
	webBase          string
	userAgent        string
	internalPlayback func(context.Context, string, string) (PlayInfo, error)
}

func newHongguoClient() *hongguoClient {
	apiBase := strings.TrimRight(envOr("HONGGUO_API_BASE", defaultHongguoAPI), "/")
	webBase := strings.TrimRight(envOr("HONGGUO_WEB_BASE", defaultHongguoWeb), "/")
	return &hongguoClient{
		httpClient:       &http.Client{Timeout: 80 * time.Second},
		apiBase:          apiBase,
		webBase:          webBase,
		userAgent:        envOr("HONGGUO_USER_AGENT", defaultHongguoUA),
		internalPlayback: embeddedMiniReelPlayInfo,
	}
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func (c *hongguoClient) appQuery() string {
	values := url.Values{
		"app_name":              {"novelread"},
		"os_version":            {"16"},
		"ac":                    {"wifi"},
		"version_code":          {"73532"},
		"update_version_code":   {"73532"},
		"manifest_version_code": {"73532"},
		"aid":                   {"8662"},
		"os_api":                {"36"},
		"resolution":            {"1280*2772"},
		"ssmix":                 {"a"},
		"language":              {"zh"},
		"device_brand":          {"Redmi"},
		"device_type":           {"25053RT47C"},
		"dpi":                   {"520"},
		"version_name":          {"7.3.5.32"},
		"device_platform":       {"android"},
		"channel":               {"update_64"},
		"os":                    {"android"},
	}
	return values.Encode()
}

type categorySpec struct {
	scene string
	genre string
}

func categorySpecFor(path string) categorySpec {
	switch path {
	case "/category/comic-drama":
		return categorySpec{scene: "comic_series", genre: "comic_series"}
	case "/category/ai-drama":
		return categorySpec{scene: "ai_series", genre: "ai_series"}
	case "/category/comic":
		return categorySpec{scene: "comic", genre: "comic"}
	default:
		// This is also the feed used by the Mac client's default short-drama
		// shelf and by the web hot-drama route.
		return categorySpec{scene: "default", genre: "short_play"}
	}
}

func (c *hongguoClient) Category(ctx context.Context, request CategoryRequest) (CategoryResult, error) {
	spec := categorySpecFor(request.Path)
	shown := strings.Join(request.Shown, ",")
	body := map[string]any{
		"filter_ids":          shown,
		"req_scene":           spec.scene,
		"offset":              maxInt(request.Offset, 0),
		"need_selector_panel": false,
		"limit":               15,
		"select_items": map[string]any{
			"category_dim_epoch": []string{},
			"online_time":        []string{},
			"gender":             []string{},
			"category_dim_role":  []string{},
			"genre":              []string{spec.genre},
			"sort":               []string{"hot_score"},
			"category_dim_theme": []string{},
		},
		"session_id":      request.SessionID,
		"req_type":        "only_content",
		"client_req_type": 3,
	}
	payload, err := c.postJSON(ctx, c.apiBase+"/reading/distribution/category/landpage/v/?"+c.appQuery(), body)
	if err != nil {
		return CategoryResult{}, err
	}
	data, ok := asMap(payload["data"])
	if !ok {
		return CategoryResult{}, errors.New("分类响应缺少 data")
	}
	rows, _ := data["video_data"].([]any)
	result := CategoryResult{
		HasMore:    asBool(data["has_more"]),
		NextOffset: asInt(data["next_offset"]),
		SessionID:  asString(data["session_id"]),
		Items:      make([]Drama, 0, len(rows)),
	}
	for _, row := range rows {
		if drama, ok := normalizeDrama(row); ok {
			result.Items = append(result.Items, drama)
		}
	}
	if result.NextOffset == 0 && result.HasMore {
		result.NextOffset = maxInt(request.Offset, 0) + len(result.Items)
	}
	return result, nil
}

func (c *hongguoClient) SeriesDetail(ctx context.Context, seriesID string) (SeriesDetailResult, error) {
	if !validID(seriesID) {
		return SeriesDetailResult{}, errors.New("series_id 无效")
	}
	body, err := c.getBytes(ctx, c.webBase+"/detail?series_id="+url.QueryEscape(seriesID), "text/html")
	if err != nil {
		return SeriesDetailResult{}, err
	}
	router, err := extractRouterData(body)
	if err != nil {
		return SeriesDetailResult{}, err
	}
	detailMap, ok := findObjectByKey(router, "seriesDetail")
	if !ok {
		return SeriesDetailResult{}, errors.New("详情响应缺少 seriesDetail")
	}
	drama, ok := normalizeDrama(detailMap)
	if !ok || drama.SeriesID == "" {
		return SeriesDetailResult{}, errors.New("详情响应缺少剧集信息")
	}
	if drama.SeriesID == "" {
		drama.SeriesID = seriesID
	}
	if drama.EpisodeCount == 0 {
		drama.EpisodeCount = len(drama.VidList)
	}
	if drama.AccessibleEpisodeCnt <= 0 || drama.AccessibleEpisodeCnt > len(drama.VidList) {
		drama.AccessibleEpisodeCnt = len(drama.VidList)
	}
	drama.Episodes = make([]Episode, 0, len(drama.VidList))
	for index, vid := range drama.VidList {
		drama.Episodes = append(drama.Episodes, Episode{
			Index: index + 1, VideoID: vid,
			Title:  fmt.Sprintf("第%d集", index+1),
			Locked: index >= drama.AccessibleEpisodeCnt,
		})
	}
	return SeriesDetailResult{Drama: drama}, nil
}

func (c *hongguoClient) Search(ctx context.Context, query string) (SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return SearchResult{}, errors.New("搜索关键词为空")
	}
	if len([]rune(query)) > 80 {
		return SearchResult{}, errors.New("搜索关键词过长")
	}
	body, err := c.getBytes(ctx, c.webBase+"/search/"+url.PathEscape(query), "text/html")
	if err != nil {
		return SearchResult{}, err
	}
	router, err := extractRouterData(body)
	if err != nil {
		return SearchResult{}, err
	}
	rows, ok := findArrayByKey(router, "searchList")
	if !ok {
		return SearchResult{Items: []Drama{}}, nil
	}
	result := SearchResult{Items: make([]Drama, 0, len(rows))}
	seen := make(map[string]bool)
	for _, row := range rows {
		drama, valid := normalizeDrama(row)
		if !valid || drama.SeriesID == "" || seen[drama.SeriesID] {
			continue
		}
		seen[drama.SeriesID] = true
		result.Items = append(result.Items, drama)
	}
	return result, nil
}

func (c *hongguoClient) PlayInfo(ctx context.Context, seriesID, vid string) (PlayInfo, error) {
	if !validID(seriesID) || !validID(vid) {
		return PlayInfo{}, errors.New("播放参数无效")
	}
	if c.internalPlayback == nil {
		return PlayInfo{}, errors.New("内置播放服务未初始化")
	}
	result, err := c.internalPlayback(ctx, seriesID, vid)
	if err != nil {
		return PlayInfo{}, fmt.Errorf("内置播放解析失败: %w", err)
	}
	if result.Path == "" {
		return PlayInfo{}, errors.New("内置播放服务没有返回地址")
	}
	if result.Vid == "" {
		result.Vid = vid
	}
	return result, nil
}

func embeddedMiniReelPlayInfo(ctx context.Context, seriesID, vid string) (PlayInfo, error) {
	value, err := resolveMiniReelMedia(ctx, seriesID, vid)
	if err != nil {
		return PlayInfo{}, err
	}
	return PlayInfo{
		Path:    asString(value["path"]),
		Quality: asString(value["quality"]),
		Vid:     firstNonEmpty(value["vid"], vid),
	}, nil
}

func (c *hongguoClient) postJSON(ctx context.Context, endpoint string, body any) (map[string]any, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", c.userAgent)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	return c.doJSON(request)
}

func (c *hongguoClient) doJSON(request *http.Request) (map[string]any, error) {
	body, err := c.readResponse(request, "application/json")
	if err != nil {
		return nil, err
	}
	var value map[string]any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("解析 JSON 失败: %w", err)
	}
	if code := asInt(value["code"]); code != 0 {
		return nil, fmt.Errorf("红果接口返回错误 code=%d message=%s", code, asString(value["message"]))
	}
	return value, nil
}

func (c *hongguoClient) getBytes(ctx context.Context, endpoint, accept string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "Mozilla/5.0 (Android TV; HongguoTV)")
	request.Header.Set("Accept", accept)
	return c.readResponse(request, accept)
}

func (c *hongguoClient) readResponse(request *http.Request, accept string) ([]byte, error) {
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("上游 HTTP %d", response.StatusCode)
	}
	if contentType := response.Header.Get("Content-Type"); accept == "application/json" && contentType != "" && !strings.Contains(contentType, "json") {
		// Some local playback bridges omit Content-Type; only reject an obvious
		// HTML response here so a valid JSON body is still accepted.
		if strings.Contains(contentType, "html") {
			return nil, errors.New("播放服务返回了 HTML")
		}
	}
	limited := io.LimitReader(response.Body, 12<<20)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(body) == 0 {
		return nil, errors.New("上游响应为空")
	}
	return body, nil
}

func extractRouterData(html []byte) (any, error) {
	marker := []byte("_ROUTER_DATA")
	position := bytes.Index(html, marker)
	if position < 0 {
		return nil, errors.New("页面缺少 _ROUTER_DATA")
	}
	start := position + len(marker)
	for start < len(html) && (html[start] == ' ' || html[start] == '\t' || html[start] == '\r' || html[start] == '\n' || html[start] == '=') {
		start++
	}
	for start < len(html) && html[start] != '{' && html[start] != '[' {
		start++
	}
	if start >= len(html) {
		return nil, errors.New("_ROUTER_DATA JSON 起点无效")
	}
	end, err := balancedJSONEnd(html, start)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(html[start:end]))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("解析 _ROUTER_DATA 失败: %w", err)
	}
	return value, nil
}

func balancedJSONEnd(data []byte, start int) (int, error) {
	depth := 0
	inString := false
	escaped := false
	for index := start; index < len(data); index++ {
		char := data[index]
		if inString {
			if escaped {
				escaped = false
			} else if char == '\\' {
				escaped = true
			} else if char == '"' {
				inString = false
			}
			continue
		}
		switch char {
		case '"':
			inString = true
		case '{', '[':
			depth++
		case '}', ']':
			depth--
			if depth == 0 {
				return index + 1, nil
			}
		}
	}
	return 0, errors.New("_ROUTER_DATA JSON 未闭合")
}

func findObjectByKey(value any, key string) (map[string]any, bool) {
	switch typed := value.(type) {
	case map[string]any:
		if candidate, ok := typed[key].(map[string]any); ok {
			return candidate, true
		}
		for _, nested := range typed {
			if found, ok := findObjectByKey(nested, key); ok {
				return found, true
			}
		}
	case []any:
		for _, nested := range typed {
			if found, ok := findObjectByKey(nested, key); ok {
				return found, true
			}
		}
	}
	return nil, false
}

func findArrayByKey(value any, key string) ([]any, bool) {
	switch typed := value.(type) {
	case map[string]any:
		if candidate, ok := typed[key].([]any); ok {
			return candidate, true
		}
		for _, nested := range typed {
			if found, ok := findArrayByKey(nested, key); ok {
				return found, true
			}
		}
	case []any:
		for _, nested := range typed {
			if found, ok := findArrayByKey(nested, key); ok {
				return found, true
			}
		}
	}
	return nil, false
}

func normalizeDrama(value any) (Drama, bool) {
	object, ok := asMap(value)
	if !ok {
		return Drama{}, false
	}
	if nested, exists := object["video_data"]; exists {
		if nestedObject, nestedOK := asMap(nested); nestedOK {
			object = nestedObject
		}
	}
	id := firstNonEmpty(asString(object["series_id"]), asString(object["seriesId"]), asString(object["book_id"]), asString(object["id"]))
	title := firstNonEmpty(asString(object["series_title"]), asString(object["series_name"]), asString(object["title"]), "未命名短剧")
	if id == "" {
		return Drama{}, false
	}
	drama := Drama{
		SeriesID:             id,
		Title:                title,
		Cover:                firstNonEmpty(asString(object["series_cover"]), asString(object["cover"]), asString(object["cover_url"])),
		Intro:                firstNonEmpty(asString(object["series_intro"]), asString(object["video_desc"]), asString(object["description"])),
		Score:                firstNonEmpty(asString(object["score"]), asString(object["rating"])),
		PlayCount:            asInt64(object["play_cnt"]),
		EpisodeCount:         firstPositive(asInt(object["episode_cnt"]), asInt(object["episode_total_cnt"])),
		AccessibleEpisodeCnt: firstPositive(asInt(object["accessible_episode_cnt"]), 0),
		Vid:                  firstNonEmpty(asString(object["vid"]), asString(object["video_id"])),
		Tags:                 asStringSlice(object["tags"]),
		VidList:              asStringSlice(object["vid_list"]),
	}
	if drama.EpisodeCount == 0 {
		if info, ok := asMap(object["series_episode_info"]); ok {
			drama.EpisodeCount = firstPositive(asInt(info["episode_cnt"]), asInt(info["episode_total_cnt"]))
		}
	}
	return drama, true
}

func asMap(value any) (map[string]any, bool) {
	result, ok := value.(map[string]any)
	return result, ok
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	case int:
		return strconv.Itoa(typed)
	default:
		return ""
	}
}

func asInt(value any) int {
	valueString := asString(value)
	result, _ := strconv.Atoi(valueString)
	return result
}

func asInt64(value any) int64 {
	valueString := asString(value)
	result, _ := strconv.ParseInt(valueString, 10, 64)
	return result
}

func asBool(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return typed == "true" || typed == "1"
	case json.Number:
		return typed.String() == "1"
	default:
		return false
	}
}

func asStringSlice(value any) []string {
	array, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(array))
	for _, entry := range array {
		if object, ok := asMap(entry); ok {
			entry = firstNonEmpty(object["name"], object["title"], object["content"])
		}
		if text := asString(entry); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func firstNonEmpty(values ...any) string {
	for _, value := range values {
		if text := asString(value); text != "" {
			return text
		}
	}
	return ""
}

func firstPositive(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

var seriesIDPattern = regexp.MustCompile(`^[0-9]{1,32}$`)

func validID(value string) bool {
	return seriesIDPattern.MatchString(value)
}
