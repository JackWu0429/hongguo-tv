package main

// Opt-in local browser fixture. This handler never connects to the real SMS or
// cloud services and is excluded from the APK binary.
import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"
)

func TestAccountBrowserFixture(t *testing.T) {
	if os.Getenv("HONGGUO_ACCOUNT_UI_FIXTURE") != "1" {
		t.Skip("local browser fixture only")
	}
	var mu sync.Mutex
	var verifyCount int
	var failDeviceRegistration bool
	rows := []map[string]any{{"book_id_str": fixtureSeries, "book_name": "云端测试短剧", "vid": fixtureVideo, "vid_index": 7, "current_play_position": 12500, "read_timestamp_ms": 1700000000000, "episode_cnt": 80}}
	favorites := []map[string]any{{"series_id": fixtureSeries}}
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/service/2/device_register/":
			if failDeviceRegistration {
				w.WriteHeader(http.StatusBadGateway)
				return
			}
			accountFixtureResponse(w, r.URL.Path, false)
		case "/passport/mobile/send_code/v1/":
			_ = r.ParseForm()
			switch r.PostForm.Get("mobile") {
			case passportXOR("+8613800000002"):
				w.WriteHeader(http.StatusForbidden)
			case passportXOR("+8613800000003"):
				ioJSON(w, `{"message":"error","data":{}}`)
			case passportXOR("+8613800000004"):
				w.Header().Set("Retry-After", "120")
				w.WriteHeader(http.StatusTooManyRequests)
			case passportXOR("+8613800000005"), passportXOR("+8526123 4567"):
				ioJSON(w, `{"message":"error","data":{"error_code":1003,"description":"测试发码请求被拒绝"}}`)
			default:
				accountFixtureResponse(w, r.URL.Path, false)
			}
		case "/passport/mobile/sms_login/":
			_ = r.ParseForm()
			if r.PostForm.Get("code") != passportXOR("123456") {
				ioJSON(w, `{"message":"error","data":{"error_code":1105,"description":"测试验证码错误"}}`)
				return
			}
			if r.PostForm.Get("mobile") == passportXOR("+8526123 4568") {
				w.Header().Set("X-Tt-Token", "fixture-secret-token")
				http.SetCookie(w, &http.Cookie{Name: "sessionid", Value: "fixture-secret-cookie"})
				ioJSON(w, `{"message":"success","data":{"user_id_str":"123456789","screen_name":"演示用户"}}`)
				return
			}
			if r.PostForm.Get("mobile") == passportXOR("+8613800000001") && r.PostForm.Get("sms_code_key") == "" {
				verifyCount = 0
				accountFixtureResponse(w, r.URL.Path, true)
				return
			}
			accountFixtureResponse(w, r.URL.Path, false)
		case "/passport/upsms/verify/":
			verifyCount++
			if verifyCount < 3 {
				ioJSON(w, `{"message":"error","data":{"error_code":1045}}`)
			} else {
				ioJSON(w, `{"message":"success","data":{"ticket":"fixture-ticket"}}`)
			}
		case "/reading/bookapi/read_history/list/v":
			writeJSON(w, 200, map[string]any{"code": 0, "data": map[string]any{"data_list": rows, "has_more": false}})
		case "/reading/bookapi/bookshelf/video/list/v":
			writeJSON(w, 200, map[string]any{"code": 0, "data": map[string]any{"video_shelf_info": favorites}})
		case "/reading/bookapi/read_progress/get/v":
			ioJSON(w, `{"code":0,"video_data":[]}`)
		default:
			accountFixtureResponse(w, r.URL.Path, false)
		}
	})
	// Short test cooldown allows changing fixture phone numbers quickly.
	go m.run(context.Background())
	s := &server{accounts: m, libraryStore: m.guest}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/account", s.account)
	mux.HandleFunc("/api/v1/account/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/account/send-code" {
			body, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 2048))
			r.Body = io.NopCloser(bytes.NewReader(body))
			var input struct {
				Phone       string `json:"phone"`
				CountryCode string `json:"country_code"`
			}
			_ = json.Unmarshal(body, &input)
			mu.Lock()
			failDeviceRegistration = input.CountryCode == "+852" && input.Phone == "61234568"
			mu.Unlock()
		}
		if r.URL.Path == "/api/v1/account/send-code" {
			m.mu.Lock()
			m.codeAfter = m.codeAfter.Add(-time.Minute)
			m.mu.Unlock()
		}
		s.account(w, r)
	})
	mux.HandleFunc("/api/v1/library", s.library)
	mux.HandleFunc("/api/v1/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "data": map[string]any{"items": []any{}}})
	})
	mux.Handle("/", http.FileServer(http.Dir("ui")))
	t.Log("account browser fixture listening at http://127.0.0.1:18797/")
	t.Fatal(http.ListenAndServe("127.0.0.1:18797", s.withCORS(mux)))
}
