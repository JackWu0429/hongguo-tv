package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// The UI is embedded so Android, desktop and development browser builds use
// the same page and the same local HTTP contract.
//
//go:embed ui
var uiFiles embed.FS

const version = "0.2.0-dev"

type server struct {
	startedAt    time.Time
	hongguo      *hongguoClient
	libraryStore *libraryStore
	accounts     *accountManager
}

type statusResponse struct {
	OK             bool     `json:"ok"`
	Service        string   `json:"service"`
	Version        string   `json:"version"`
	Implementation string   `json:"implementation"`
	StartedAt      string   `json:"started_at"`
	Capabilities   []string `json:"capabilities"`
}

func main() {
	port := flag.Int("port", 8797, "local HTTP port")
	dataDir := flag.String("data-dir", defaultLibraryDir(), "persistent local library directory")
	flag.Parse()

	root, err := fs.Sub(uiFiles, "ui")
	if err != nil {
		log.Fatalf("prepare UI: %v", err)
	}

	library, err := newLibraryStore(*dataDir)
	if err != nil {
		log.Fatalf("prepare local library: %v", err)
	}
	s := &server{startedAt: time.Now().UTC(), hongguo: newHongguoClient(), libraryStore: library}
	s.accounts, err = newAccountManager(*dataDir, library, s.hongguo)
	if err != nil {
		log.Fatalf("prepare account: %v", err)
	}
	go s.accounts.run(context.Background())
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/health", s.health)
	mux.HandleFunc("/api/v1/status", s.status)
	mux.HandleFunc("/api/v1/library", s.library)
	mux.HandleFunc("/api/v1/account", s.account)
	mux.HandleFunc("/api/v1/account/", s.account)
	mux.HandleFunc("/api/v1/category", s.category)
	mux.HandleFunc("/api/v1/Category", s.category)
	mux.HandleFunc("/api/v1/rank", s.rank)
	mux.HandleFunc("/api/v1/Rank", s.rank)
	mux.HandleFunc("/api/v1/series/detail", s.seriesDetail)
	mux.HandleFunc("/api/v1/SeriesDetail", s.seriesDetail)
	mux.HandleFunc("/api/v1/series/next-season", s.nextSeason)
	mux.HandleFunc("/api/v1/search", s.search)
	mux.HandleFunc("/api/v1/lists/", s.lists)
	mux.HandleFunc("/api/v1/reservation", s.reservation)
	mux.HandleFunc("/api/v1/comments", s.discussion)
	mux.HandleFunc("/api/v1/danmaku", s.discussion)
	mux.HandleFunc("/api/v1/Search", s.search)
	mux.HandleFunc("/api/v1/play/info", s.playInfo)
	mux.HandleFunc("/api/v1/PlayInfo", s.playInfo)
	// The TV APK owns the MiniReel resolver and media cache.  These routes are
	// served by the same process so the UI never needs a second playback host.
	mux.HandleFunc("/minireel-proxy/resolve", handleMiniReelResolve)
	mux.HandleFunc("/minireel-proxy/media/", handleMiniReelMedia)
	mux.Handle("/", http.FileServer(http.FS(root)))

	addr := "127.0.0.1:" + strconv.Itoa(*port)
	log.Printf("hongguo-tv core %s listening on %s", version, addr)
	if err := http.ListenAndServe(addr, s.withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func (s *server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/account") || strings.HasPrefix(r.URL.Path, "/api/v1/lists/") || r.URL.Path == "/api/v1/reservation" || r.URL.Path == "/api/v1/comments" || r.URL.Path == "/api/v1/danmaku" || r.URL.Path == "/api/v1/library" {
			if !privateLocalRequest(r) {
				writeError(w, http.StatusForbidden, "只允许应用本身访问账号和记录")
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Range")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,HEAD,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func privateLocalRequest(r *http.Request) bool {
	requestURL, err := url.Parse("http://" + r.Host)
	if err != nil || requestURL.User != nil {
		return false
	}
	requestHost := requestURL.Hostname()
	requestIP := net.ParseIP(requestHost)
	if requestHost != "localhost" && (requestIP == nil || !requestIP.IsLoopback()) {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return false
	}
	if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" {
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Scheme != "http" || u.Host != r.Host {
			return false
		}
	}
	if ref := r.Header.Get("Referer"); ref != "" {
		u, err := url.Parse(ref)
		if err != nil || u.Host != r.Host {
			return false
		}
	}
	return true
}

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *server) status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, statusResponse{
		OK:             true,
		Service:        "hongguo-tv-core",
		Version:        version,
		Implementation: "go-api-adapter+embedded-playback",
		StartedAt:      s.startedAt.Format(time.RFC3339),
		Capabilities:   []string{"tv-ui", "local-http", "focus-state-machine", "category", "rank", "search", "series-detail", "play-info", "embedded-playback", "cenc-mp4", "range-media", "local-history", "local-favorites", "local-likes", "resume-playback", "next-episode", "next-season", "account-login", "account-mfa", "cloud-library", "new-series", "release-calendar", "reservations", "recommend-feed", "comments", "danmaku", "infinite-scroll"},
	})
}

func (s *server) category(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	request := CategoryRequest{
		Path:      r.URL.Query().Get("path"),
		Offset:    parseQueryInt(r, "offset"),
		SessionID: r.URL.Query().Get("session_id"),
		Shown:     splitQueryList(r.URL.Query().Get("shown")),
		Selectors: r.URL.Query().Get("selectors") == "1",
		Filters:   map[string]string{},
	}
	for kind := range categoryFilterNames {
		if r.URL.Query().Has(kind) {
			request.Filters[kind] = r.URL.Query().Get(kind)
		}
	}
	if _, err := categorySelection(request); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.hongguo.Category(r.Context(), request)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": result})
}

func (s *server) rank(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	result, err := s.hongguo.Rank(r.Context(), RankRequest{Path: r.URL.Query().Get("path")})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": result})
}

func (s *server) seriesDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	seriesID := r.URL.Query().Get("series_id")
	result, err := s.hongguo.SeriesDetail(r.Context(), seriesID)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": result})
}

func (s *server) search(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	result, err := s.hongguo.Search(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": result})
}

func (s *server) playInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	result, err := s.hongguo.PlayInfo(r.Context(), r.URL.Query().Get("series_id"), r.URL.Query().Get("vid"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": result})
}

func parseQueryInt(r *http.Request, name string) int {
	value, _ := strconv.Atoi(r.URL.Query().Get(name))
	return value
}

func splitQueryList(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	result := make([]string, 0)
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write JSON: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": message})
}

func routeDescription(r *http.Request) string {
	return fmt.Sprintf("%s %s", r.Method, strings.TrimSpace(r.URL.Path))
}
