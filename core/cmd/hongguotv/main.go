package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// The UI is embedded so Android, desktop and development browser builds use
// the same page and the same local HTTP contract.
//
//go:embed ui
var uiFiles embed.FS

const version = "0.1.0-dev"

type server struct {
	startedAt time.Time
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
	flag.Parse()

	root, err := fs.Sub(uiFiles, "ui")
	if err != nil {
		log.Fatalf("prepare UI: %v", err)
	}

	s := &server{startedAt: time.Now().UTC()}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/health", s.health)
	mux.HandleFunc("/api/v1/status", s.status)
	mux.Handle("/", http.FileServer(http.FS(root)))

	addr := ":" + strconv.Itoa(*port)
	log.Printf("hongguo-tv core %s listening on %s", version, addr)
	if err := http.ListenAndServe(addr, s.withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func (s *server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
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
		Implementation: "skeleton",
		StartedAt:      s.startedAt.Format(time.RFC3339),
		Capabilities:   []string{"tv-ui", "local-http", "focus-state-machine"},
	})
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
