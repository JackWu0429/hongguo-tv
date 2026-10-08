package main

import (
	"bytes"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Opt-in offline acceptance server. Its QR form/storage are the real code;
// catalog/search are deterministic and cannot access accounts or media.
func TestSearchBrowserFixture(t *testing.T) {
	if os.Getenv("HONGGUO_SEARCH_UI_FIXTURE") != "1" {
		t.Skip("isolated search fixture")
	}
	history, err := newSearchHistoryStore(os.Getenv("HONGGUO_SEARCH_FIXTURE_DATA"))
	if err != nil {
		t.Fatal(err)
	}
	s := &server{numberInputs: newNumberInputManager(), searchHistoryStore: history}
	defer s.numberInputs.close()
	mux := http.NewServeMux()
	var failSearch atomic.Bool
	failSearch.Store(true)
	mux.HandleFunc("/fixture/control", func(w http.ResponseWriter, r *http.Request) {
		failSearch.Store(r.URL.Query().Get("fail") == "1")
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("/api/v1/number-input", s.numberInput)
	mux.HandleFunc("/api/v1/search-history", s.searchHistory)
	mux.HandleFunc("/api/v1/lists/search", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		if q == "慢查询" {
			time.Sleep(2 * time.Second)
		}
		if q == "失败查询" && failSearch.Load() {
			writeError(w, 503, "测试搜索失败")
			return
		}
		items := []Drama{}
		if q != "无结果" {
			for i := 1; i <= 3; i++ {
				items = append(items, Drama{SeriesID: strconv.Itoa(900000 + i), Title: fmt.Sprint(q, " · 短剧", i), EpisodeCount: 20})
			}
		}
		writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"items": items, "has_more": false}})
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		data := map[string]any{"items": []Drama{}, "has_more": false}
		switch r.URL.Path {
		case "/api/v1/library":
			data = map[string]any{"entries": []LibraryEntry{}}
		case "/api/v1/account":
			data = map[string]any{"logged_in": false, "phase": "phone", "sync": map[string]any{"state": "idle"}}
		case "/api/v1/status":
			data = map[string]any{"version": "search-fixture"}
		case "/api/v1/category":
			data["filters"] = []CategoryFilterRow{{Type: "sort", Label: "排序", Options: []CategoryFilterOption{{ID: "hot_score", Label: "最高热度"}, {ID: "new", Label: "最新"}}}}
		}
		writeJSON(w, 200, map[string]any{"ok": true, "data": data})
	})
	root, _ := fs.Sub(uiFiles, "ui")
	files := http.FileServer(http.FS(root))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			files.ServeHTTP(w, r)
			return
		}
		body, _ := fs.ReadFile(root, "index.html")
		if r.URL.Query().Get("legacy") == "1" {
			shim := `<script>window.__errors=[];window.addEventListener('error',function(e){window.__errors.push(e.message)});Object.defineProperty(navigator,'userAgent',{get:function(){return 'HongguoTV-Android Chromium44-fixture'}});NodeList.prototype.forEach=undefined;window.fetch=undefined;window.AbortController=undefined;window.URLSearchParams=undefined;document.documentElement.className='legacy-grid legacy-aspect legacy-flex-gap';var s=document.createElement('style');s.textContent='.legacy-flex-gap *{gap:0!important;column-gap:0!important;row-gap:0!important}';document.head.appendChild(s);var focus=HTMLElement.prototype.focus;HTMLElement.prototype.focus=function(options){if(options)throw Error('old focus options');return focus.call(this)};</script>`
			body = bytes.Replace(body, []byte("<head>"), []byte("<head>"+shim), 1)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(body)
	})
	addr := os.Getenv("HONGGUO_UI_FIXTURE_ADDR")
	if addr == "" {
		addr = "127.0.0.1:20697"
	}
	if !strings.HasPrefix(addr, "127.0.0.1:") {
		t.Fatal("fixture must bind loopback")
	}
	t.Log("search fixture http://" + addr)
	t.Fatal(http.ListenAndServe(addr, mux))
}
