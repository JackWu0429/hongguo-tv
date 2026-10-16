package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	radarRawBase    = "https://raw.githubusercontent.com/2252399314-cyber/hongguo-radar/main/data/derived"
	radarGhfastBase = "https://ghfast.top/https://raw.githubusercontent.com/2252399314-cyber/hongguo-radar/main/data/derived"
	radarMaxPayload = 5 << 20
)

type radarRankItem struct {
	ID         string   `json:"id"`
	Rank       int      `json:"rank"`
	Title      string   `json:"title"`
	StatusTags []string `json:"status_tags,omitempty"`
	Delta      *int     `json:"delta,omitempty"`
	Badge      string   `json:"badge,omitempty"`
	Streak     int      `json:"streak,omitempty"`
	BestRank   int      `json:"best_rank,omitempty"`
}

type radarRankBucket struct {
	RankDate     string          `json:"rank_date"`
	PrevRankDate string          `json:"prev_rank_date"`
	Items        []radarRankItem `json:"items"`
}

type radarRanksData struct {
	Hot   radarRankBucket `json:"hot"`
	Real  radarRankBucket `json:"real"`
	AI    radarRankBucket `json:"ai"`
	Comic radarRankBucket `json:"comic"`
}

type radarGrowthItem struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Tags  []string `json:"tags,omitempty"`
	Type  string   `json:"type"`
	Hot   int64    `json:"hot"`
	Fav   int64    `json:"fav"`
	Like  int64    `json:"like"`
	Score *float64 `json:"score,omitempty"`
	Gap   int      `json:"gap"`
	DHot  int64    `json:"d_hot"`
	DFav  int64    `json:"d_fav"`
	DLike int64    `json:"d_like"`
	RHot  float64  `json:"r_hot"`
	D7Hot *int64   `json:"d7_hot,omitempty"`
	D7Fav *int64   `json:"d7_fav,omitempty"`
}

type radarGrowthData struct {
	Date     string            `json:"date"`
	PrevDate string            `json:"prev_date"`
	Gap      int               `json:"gap"`
	Items    []radarGrowthItem `json:"items"`
}

type radarPersistedCache struct {
	Ranks         *radarRanksData  `json:"ranks,omitempty"`
	RanksFetched  time.Time        `json:"ranks_fetched_at,omitempty"`
	Growth        *radarGrowthData `json:"growth,omitempty"`
	GrowthFetched time.Time        `json:"growth_fetched_at,omitempty"`
}

type radarSnapshotResponse struct {
	Ranks         *radarRanksData  `json:"ranks,omitempty"`
	Growth        *radarGrowthData `json:"growth,omitempty"`
	RanksStale    bool             `json:"ranks_stale"`
	GrowthStale   bool             `json:"growth_stale"`
	RanksFetched  string           `json:"ranks_fetched_at,omitempty"`
	GrowthFetched string           `json:"growth_fetched_at,omitempty"`
}

type radarService struct {
	mu          sync.Mutex
	path        string
	client      *http.Client
	primaryBase string
	rawBase     string
	cache       radarPersistedCache
	loaded      bool
}

func newRadarService(dataDir string, client *http.Client) *radarService {
	if client == nil {
		client = &http.Client{Timeout: 6 * time.Second}
	}
	return &radarService{
		path:        filepath.Join(dataDir, "radar-cache.json"),
		client:      client,
		primaryBase: radarGhfastBase,
		rawBase:     radarRawBase,
	}
}

func (s *radarService) loadCache() {
	if s.loaded {
		return
	}
	s.loaded = true
	body, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var cache radarPersistedCache
	if json.Unmarshal(body, &cache) == nil {
		s.cache = cache
	}
}

func (s *radarService) fetchRemote(ctx context.Context, name string, validate func([]byte) error) ([]byte, error) {
	var failures []string
	for _, base := range []string{s.primaryBase, s.rawBase} {
		if base == "" {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/"+name+".json", nil)
		if err != nil {
			failures = append(failures, err.Error())
			continue
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "HongguoTV-Radar/1.0")
		resp, err := s.client.Do(req)
		if err != nil {
			failures = append(failures, err.Error())
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, radarMaxPayload+1))
		resp.Body.Close()
		if readErr != nil {
			failures = append(failures, readErr.Error())
			continue
		}
		if resp.StatusCode != http.StatusOK {
			failures = append(failures, fmt.Sprintf("HTTP %d", resp.StatusCode))
			continue
		}
		if len(body) == 0 || len(body) > radarMaxPayload {
			failures = append(failures, "响应大小无效")
			continue
		}
		if err := validate(body); err != nil {
			failures = append(failures, err.Error())
			continue
		}
		return body, nil
	}
	if len(failures) == 0 {
		return nil, errors.New("榜单雷达数据源未配置")
	}
	return nil, errors.New(strings.Join(failures, "; "))
}

func normalizeRadarBucket(bucket radarRankBucket) radarRankBucket {
	items := make([]radarRankItem, 0, len(bucket.Items))
	seen := make(map[string]bool, len(bucket.Items))
	for _, item := range bucket.Items {
		if !validID(item.ID) || strings.TrimSpace(item.Title) == "" || seen[item.ID] {
			continue
		}
		seen[item.ID] = true
		if item.Rank <= 0 {
			item.Rank = len(items) + 1
		}
		if len(item.StatusTags) > 8 {
			item.StatusTags = item.StatusTags[:8]
		}
		items = append(items, item)
	}
	bucket.Items = items
	return bucket
}

func decodeRadarRanks(body []byte) (radarRanksData, error) {
	var raw map[string]radarRankBucket
	if err := json.Unmarshal(body, &raw); err != nil {
		return radarRanksData{}, err
	}
	data := radarRanksData{
		Hot: normalizeRadarBucket(raw["hot"]), Real: normalizeRadarBucket(raw["real"]),
		AI: normalizeRadarBucket(raw["ai"]), Comic: normalizeRadarBucket(raw["comic"]),
	}
	if len(data.Hot.Items) == 0 || len(data.Real.Items) == 0 || len(data.AI.Items) == 0 || len(data.Comic.Items) == 0 {
		return radarRanksData{}, errors.New("榜单数据不完整")
	}
	for _, date := range []string{data.Hot.RankDate, data.Real.RankDate, data.AI.RankDate, data.Comic.RankDate} {
		if _, err := time.Parse("2006-01-02", date); err != nil {
			return radarRanksData{}, errors.New("榜单日期无效")
		}
	}
	return data, nil
}

func decodeRadarGrowth(body []byte) (radarGrowthData, error) {
	var data radarGrowthData
	if err := json.Unmarshal(body, &data); err != nil {
		return radarGrowthData{}, err
	}
	if data.Date == "" || len(data.Items) == 0 {
		return radarGrowthData{}, errors.New("飙升榜数据不完整")
	}
	if _, err := time.Parse("2006-01-02", data.Date); err != nil {
		return radarGrowthData{}, errors.New("飙升榜日期无效")
	}
	items := make([]radarGrowthItem, 0, len(data.Items))
	seen := make(map[string]bool, len(data.Items))
	for _, item := range data.Items {
		if !validID(item.ID) || strings.TrimSpace(item.Title) == "" || seen[item.ID] {
			continue
		}
		if item.Type != "real" && item.Type != "ai" && item.Type != "comic" && item.Type != "unknown" {
			continue
		}
		seen[item.ID] = true
		if len(item.Tags) > 8 {
			item.Tags = item.Tags[:8]
		}
		items = append(items, item)
	}
	if len(items) == 0 {
		return radarGrowthData{}, errors.New("飙升榜没有可用剧集")
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].DHot > items[j].DHot })
	data.Items = items
	return data, nil
}

func (s *radarService) fetchRanks(ctx context.Context) (*radarRanksData, error) {
	var decoded radarRanksData
	_, err := s.fetchRemote(ctx, "ranks_latest", func(body []byte) error {
		var decodeErr error
		decoded, decodeErr = decodeRadarRanks(body)
		return decodeErr
	})
	if err != nil {
		return nil, err
	}
	return &decoded, nil
}

func (s *radarService) fetchGrowth(ctx context.Context) (*radarGrowthData, error) {
	var decoded radarGrowthData
	_, err := s.fetchRemote(ctx, "growth_latest", func(body []byte) error {
		var decodeErr error
		decoded, decodeErr = decodeRadarGrowth(body)
		return decodeErr
	})
	if err != nil {
		return nil, err
	}
	return &decoded, nil
}

func (s *radarService) snapshot(ctx context.Context) (radarSnapshotResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.loadCache()

	type fetchResult struct {
		ranks  *radarRanksData
		growth *radarGrowthData
		err    error
	}
	results := make(chan fetchResult, 2)
	go func() { data, err := s.fetchRanks(ctx); results <- fetchResult{ranks: data, err: err} }()
	go func() { data, err := s.fetchGrowth(ctx); results <- fetchResult{growth: data, err: err} }()

	var ranksFresh, growthFresh bool
	now := time.Now().UTC()
	for range 2 {
		result := <-results
		if result.ranks != nil {
			s.cache.Ranks = result.ranks
			s.cache.RanksFetched = now
			ranksFresh = true
		}
		if result.growth != nil {
			s.cache.Growth = result.growth
			s.cache.GrowthFetched = now
			growthFresh = true
		}
	}
	if ranksFresh || growthFresh {
		_ = atomicPrivateJSON(s.path, s.cache)
	}
	if s.cache.Ranks == nil && s.cache.Growth == nil {
		return radarSnapshotResponse{}, errors.New("榜单雷达暂时无法获取，请稍后重试")
	}
	response := radarSnapshotResponse{
		Ranks: s.cache.Ranks, Growth: s.cache.Growth,
		RanksStale: !ranksFresh, GrowthStale: !growthFresh,
	}
	if !s.cache.RanksFetched.IsZero() {
		response.RanksFetched = s.cache.RanksFetched.Format(time.RFC3339)
	}
	if !s.cache.GrowthFetched.IsZero() {
		response.GrowthFetched = s.cache.GrowthFetched.Format(time.RFC3339)
	}
	return response, nil
}

func (s *server) radarSnapshot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.radar == nil {
		writeError(w, http.StatusServiceUnavailable, "榜单雷达暂不可用")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 13*time.Second)
	defer cancel()
	data, err := s.radar.snapshot(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}
