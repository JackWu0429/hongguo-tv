package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func fixtureAccount(t *testing.T, h http.HandlerFunc) *accountManager {
	t.Helper()
	dir := t.TempDir()
	guest, err := newLibraryStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	m, err := newAccountManager(dir, guest, nil)
	if err != nil {
		t.Fatal(err)
	}
	remote := httptest.NewServer(h)
	t.Cleanup(remote.Close)
	m.newClient = func(s accountSession) *passportClient {
		c := newPassportClient(s)
		c.base = remote.URL
		c.deviceBase = remote.URL
		c.http = remote.Client()
		return c
	}
	return m
}

func TestPassportLoginIdentity(t *testing.T) {
	for _, tc := range []struct {
		name, response, want string
	}{
		{"string", `{"message":"success","data":{"user_id_str":"7391234567890123456"}}`, "7391234567890123456"},
		{"number", `{"message":"success","data":{"user_id":7391234567890123456}}`, "7391234567890123456"},
		{"both", `{"message":"success","data":{"user_id_str":"7391234567890123456","user_id":7391234567890123456}}`, "7391234567890123456"},
		{"zero", `{"message":"success","data":{"user_id":0}}`, ""},
		{"empty", `{"message":"success","data":{}}`, ""},
		{"disagree", `{"message":"success","data":{"user_id_str":"123456789","user_id":987654321}}`, ""},
		{"invalid number", `{"message":"success","data":{"user_id_str":"123456789","user_id":0}}`, ""},
		{"rejected", `{"message":"error","data":{"user_id_str":"123456789","error_code":1105}}`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var p map[string]any
			d := json.NewDecoder(bytes.NewBufferString(tc.response))
			d.UseNumber()
			if err := d.Decode(&p); err != nil {
				t.Fatal(err)
			}
			got, err := passportLoginUID(p)
			if got != tc.want || (err != nil) != (tc.want == "") {
				t.Fatalf("identity result=%q error=%v", got, err)
			}
		})
	}
}

func TestAccountLoginDoesNotUseReadingProfileAsIdentity(t *testing.T) {
	var profileCalls atomic.Int32
	var failCloud atomic.Bool
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/reading/user/info/v1/" {
			profileCalls.Add(1)
			ioJSON(w, `{"code":0,"data":{"user_id":0}}`)
			return
		}
		if failCloud.Load() {
			ioJSON(w, `{"code":401,"message":"expired"}`)
			return
		}
		accountFixtureResponse(w, r.URL.Path, false)
	})
	if err := m.sendCode(context.Background(), "13800000000"); err != nil {
		t.Fatal(err)
	}
	if err := m.loginSMS(context.Background(), "13800000000", "123456"); err != nil {
		t.Fatal(err)
	}
	if profileCalls.Load() != 0 || !m.status().LoggedIn || m.status().Error != "" {
		t.Fatal("valid Passport login vetoed by unrelated profile API")
	}
	// A cloud read failure must not consume another SMS code or undo login.
	failCloud.Store(true)
	m.synchronize(context.Background())
	if !m.status().LoggedIn || m.status().Error != "" || m.status().Sync.Error == "" {
		t.Fatal("cloud failure turned a successful login into an SMS error")
	}
}

func TestAccountLoginRejectsMissingCredentials(t *testing.T) {
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/passport/mobile/sms_login/" {
			ioJSON(w, `{"message":"success","data":{"user_id_str":"123456789"}}`)
			return
		}
		accountFixtureResponse(w, r.URL.Path, false)
	})
	if err := m.sendCode(context.Background(), "13800000000"); err != nil {
		t.Fatal(err)
	}
	if err := m.loginSMS(context.Background(), "13800000000", "123456"); err == nil {
		t.Fatal("login without session accepted")
	}
	if m.status().LoggedIn || m.librarySnapshot().OwnerID != "" {
		t.Fatal("invalid login changed account")
	}
}
func accountFixtureResponse(w http.ResponseWriter, path string, mfa bool) {
	switch path {
	case "/reading/ugc/action/mget/v":
		ioJSON(w, `{"code":0,"data":{"mixed_data_list":null,"has_more":false}}`)
	case "/service/2/device_register/":
		ioJSON(w, `{"device_id_str":"7390000000000000001","install_id_str":"7390000000000000002"}`)
	case "/passport/mobile/send_code/v1/":
		ioJSON(w, `{"message":"success","data":{"mobile_ticket":"fixture","retry_time":60}}`)
	case "/passport/mobile/sms_login/":
		if mfa {
			ioJSON(w, `{"message":"error","data":{"error_code":2046,"encrypt_uid":"fixture-encrypted","sms_code_key":"fixture-code-key","event_params":{"log_id":"fixture-log"},"verify_ways":[{"verify_way":"upsms","sms_content":"ONLY-FIXTURE","channel_mobile":"1060000"}]}}`)
		} else {
			w.Header().Set("X-Tt-Token", "fixture-secret-token")
			http.SetCookie(w, &http.Cookie{Name: "sessionid", Value: "fixture-secret-cookie"})
			ioJSON(w, `{"message":"success","data":{"user_id_str":"123456789","screen_name":"测试用户"}}`)
		}
	case "/reading/user/info/v1/":
		ioJSON(w, `{"code":0,"data":{"user_id":"123456789"}}`)
	default:
		ioJSON(w, `{"code":0,"data":{}}`)
	}
}
func ioJSON(w http.ResponseWriter, s string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(s))
}

func TestAccountLoginPersistenceIsolationAndNoCredentialExposure(t *testing.T) {
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/service/2/device_register/" {
			accountFixtureResponse(w, r.URL.Path, false)
			return
		}
		for _, h := range []string{"X-Gorgon", "X-Helios", "X-Medusa", "X-Khronos"} {
			if r.Header.Get(h) == "" {
				t.Errorf("missing %s", h)
			}
		}
		accountFixtureResponse(w, r.URL.Path, false)
	})
	guestOwner := ""
	guestFavorite := true
	if _, err := m.changeLibrary(LibraryChange{OwnerID: &guestOwner, Action: "favorite", Drama: Drama{SeriesID: "999997", Title: "登录前的本机收藏"}, Value: &guestFavorite}); err != nil {
		t.Fatal(err)
	}
	if err := m.sendCode(context.Background(), "13800000000"); err != nil {
		t.Fatal(err)
	}
	if err := m.loginSMS(context.Background(), "13800000000", "123456"); err != nil {
		t.Fatal(err)
	}
	s := m.status()
	if !s.LoggedIn || s.Profile.UID != "123456789" || s.Profile.Phone != "138****0000" {
		t.Fatalf("bad status %+v", s)
	}
	b, _ := json.Marshal(s)
	if strings.Contains(string(b), "secret") || strings.Contains(string(b), "13800000000") {
		t.Fatal("credentials leaked to UI")
	}
	stat, err := os.Stat(filepath.Join(m.dir, "account.json"))
	if err != nil || runtime.GOOS != "windows" && stat.Mode().Perm() != 0600 {
		t.Fatal("account file must be private")
	}
	owner := "123456789"
	yes := true
	_, err = m.changeLibrary(LibraryChange{OwnerID: &owner, Action: "favorite", Drama: Drama{SeriesID: "999999", Title: "账号收藏"}, Value: &yes})
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := newAccountManager(m.dir, m.guest, nil)
	if err != nil || !reloaded.status().LoggedIn || len(reloaded.librarySnapshot().Entries) != 1 {
		t.Fatal("session/library restart failed")
	}
	if err = m.logout(); err != nil {
		t.Fatal(err)
	}
	if got := m.librarySnapshot(); len(got.Entries) != 1 || got.Entries[0].Drama.SeriesID != "999997" {
		t.Fatal("guest records lost or account records leaked")
	}
	if _, err = m.changeLibrary(LibraryChange{OwnerID: &owner, Action: "favorite", Drama: Drama{SeriesID: "999998", Title: "迟到的操作"}, Value: &yes}); err == nil {
		t.Fatal("old-owner write accepted")
	}
	b, _ = os.ReadFile(filepath.Join(m.dir, "account.json"))
	if strings.Contains(string(b), "secret") {
		t.Fatal("logout retained credentials")
	}
}

func TestAccountMFATicketRetryAndWaiting(t *testing.T) {
	var verify, login atomic.Int32
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/passport/mobile/sms_login/":
			if login.Add(1) == 1 {
				accountFixtureResponse(w, r.URL.Path, true)
				return
			}
			_ = r.ParseForm()
			if r.PostForm.Get("sms_code_key") != passportXOR("confirmed-ticket") || r.PostForm.Get("passport_mfa_retry_tag") != "1" {
				t.Error("MFA ticket not used")
			}
			accountFixtureResponse(w, r.URL.Path, false)
		case "/passport/upsms/verify/":
			if verify.Add(1) == 1 {
				ioJSON(w, `{"message":"error","data":{"error_code":1045}}`)
			} else {
				ioJSON(w, `{"message":"success","data":{"ticket":"confirmed-ticket"}}`)
			}
		default:
			accountFixtureResponse(w, r.URL.Path, false)
		}
	})
	if err := m.sendCode(context.Background(), "13800000000"); err != nil {
		t.Fatal(err)
	}
	if err := m.loginSMS(context.Background(), "13800000000", "123456"); err != nil {
		t.Fatal(err)
	}
	if m.status().Phase != "mfa" || m.status().LoggedIn {
		t.Fatal("MFA falsely reported logged in")
	}
	if err := m.verifyLogin(context.Background()); err != nil || m.status().Phase != "mfa" {
		t.Fatal("1045 should stay waiting")
	}
	if err := m.verifyLogin(context.Background()); err != nil || !m.status().LoggedIn {
		t.Fatalf("MFA retry failed: %v", err)
	}
}

func TestAccountCanceledLoginCannotRestoreSession(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/passport/mobile/sms_login/" {
			close(entered)
			<-release
		}
		accountFixtureResponse(w, r.URL.Path, false)
	})
	if err := m.sendCode(context.Background(), "13800000000"); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- m.loginSMS(context.Background(), "13800000000", "123456") }()
	<-entered
	m.cancelLogin()
	close(release)
	if err := <-done; err == nil {
		t.Fatal("canceled login succeeded")
	}
	if m.status().LoggedIn {
		t.Fatal("late login restored canceled session")
	}
}

func TestAccountRejectsMalformedSuccessAndRateLimitsCode(t *testing.T) {
	var calls atomic.Int32
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/service/2/device_register/" {
			accountFixtureResponse(w, r.URL.Path, false)
			return
		}
		calls.Add(1)
		ioJSON(w, `{"message":"error","data":{}}`)
	})
	if err := m.sendCode(context.Background(), "13800000000"); err == nil {
		t.Fatal("error response accepted")
	}
	if err := m.sendCode(context.Background(), "13800000000"); err == nil || calls.Load() != 1 {
		t.Fatal("SMS cooldown bypassed")
	}
	if passportSuccess(map[string]any{"message": "success"}) {
		t.Fatal("missing data accepted")
	}
}

func TestAccountAppCodeFallbackAllowsLoginAfterSMSFailure(t *testing.T) {
	var smsLoginCalls atomic.Int32
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/service/2/device_register/":
			accountFixtureResponse(w, r.URL.Path, false)
		case "/passport/mobile/send_code/v1/":
			ioJSON(w, `{"message":"error","data":{"error_code":1003}}`)
		case "/passport/mobile/sms_login/":
			smsLoginCalls.Add(1)
			w.Header().Set("X-Tt-Token", "fixture-secret-token")
			http.SetCookie(w, &http.Cookie{Name: "sessionid", Value: "fixture-secret-cookie"})
			ioJSON(w, `{"message":"success","data":{"user_id_str":"123456789","screen_name":"App码用户"}}`)
		default:
			accountFixtureResponse(w, r.URL.Path, false)
		}
	})
	if err := m.sendCode(context.Background(), "13800000000"); err == nil {
		t.Fatal("SMS failure was accepted")
	}
	status := m.status()
	if !status.AppCode || status.Phase != "phone" || status.LoggedIn {
		t.Fatalf("app-code fallback not exposed: %+v", status)
	}
	if err := m.loginSMS(context.Background(), "13800000000", "654321"); err != nil {
		t.Fatal(err)
	}
	status = m.status()
	if !status.LoggedIn || status.AppCode || status.Phase != "logged_in" || smsLoginCalls.Load() != 1 {
		t.Fatalf("app-code login did not finish cleanly: %+v", status)
	}
}

func TestAccountAppCodeFallbackCancelClearsPendingAttempt(t *testing.T) {
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/passport/mobile/send_code/v1/" {
			ioJSON(w, `{"message":"error","data":{"error_code":1003}}`)
			return
		}
		accountFixtureResponse(w, r.URL.Path, false)
	})
	if err := m.sendCode(context.Background(), "13800000000"); err == nil {
		t.Fatal("SMS failure was accepted")
	}
	if !m.status().AppCode {
		t.Fatal("app-code fallback missing before cancel")
	}
	m.cancelLogin()
	status := m.status()
	if status.AppCode || status.Phase != "phone" || status.Phone != "" {
		t.Fatalf("cancel retained app-code attempt: %+v", status)
	}
}

func TestAccountCloudAckFailureAndReplacement(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "bookshelf/video/update") {
			if fail.Load() {
				ioJSON(w, `{"code":100,"data":{}}`)
			} else {
				ioJSON(w, `{"code":0,"data":{}}`)
			}
		} else {
			accountFixtureResponse(w, r.URL.Path, false)
		}
	})
	if err := m.sendCode(context.Background(), "13800000000"); err != nil {
		t.Fatal(err)
	}
	if err := m.loginSMS(context.Background(), "13800000000", "123456"); err != nil {
		t.Fatal(err)
	}
	owner := "123456789"
	yes, no := true, false
	change := LibraryChange{OwnerID: &owner, Action: "favorite", Drama: Drama{SeriesID: "999999", Title: "待同步"}, Value: &yes}
	if _, err := m.changeLibrary(change); err != nil {
		t.Fatal(err)
	}
	c := m.newClient(m.disk.Session)
	err := m.flushCloud(context.Background(), m.generation, m.store, c)
	if err == nil || len(m.store.snapshot().Cloud.Pending) != 1 {
		t.Fatal("failed update cleared pending")
	}
	old := m.store.snapshot().Cloud.Pending[0].Sequence
	change.Value = &no
	if _, err := m.changeLibrary(change); err != nil {
		t.Fatal(err)
	}
	if err := m.store.ackCloud(old); err != nil {
		t.Fatal(err)
	}
	if len(m.store.snapshot().Cloud.Pending) != 1 {
		t.Fatal("old ack cleared replacement")
	}
	fail.Store(false)
	if err := m.flushCloud(context.Background(), m.generation, m.store, c); err != nil || len(m.store.snapshot().Cloud.Pending) != 0 {
		t.Fatal("ack did not clear exact pending")
	}
}

func TestAccountProtectedRoutes(t *testing.T) {
	s := &server{}
	h := s.withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, tt := range []struct {
		remote, origin string
		status         int
	}{{"127.0.0.1:8000", "http://127.0.0.1:8797", 204}, {"127.0.0.1:8000", "https://other.example", 403}, {"192.168.1.2:8000", "", 403}} {
		r := httptest.NewRequest("POST", "http://127.0.0.1:8797/api/v1/account/login", nil)
		r.RemoteAddr = tt.remote
		r.Header.Set("Origin", tt.origin)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tt.status {
			t.Fatalf("origin boundary failed: %d", w.Code)
		}
		if w.Header().Get("Access-Control-Allow-Origin") == "*" {
			t.Fatal("credential endpoint exposed wildcard CORS")
		}
	}
}

func TestCloudMergeKeepsLocalChangesAndLocalClear(t *testing.T) {
	s, err := newLibraryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s.data.OwnerID = "123456789"
	yes := true
	drama := Drama{SeriesID: "999999", Title: "测试剧"}
	if _, err = s.apply(LibraryChange{Action: "favorite", Drama: drama, Value: &yes}); err != nil {
		t.Fatal(err)
	}
	if err = s.mergeCloud([]LibraryEntry{}, time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if s.snapshot().Entries[0].FavoriteAt == 0 {
		t.Fatal("remote empty overwrote unsynced favorite")
	}
	if err = s.ackCloud(s.snapshot().Cloud.Pending[0].Sequence); err != nil {
		t.Fatal(err)
	}
	if _, err = s.apply(LibraryChange{Action: "clear", Kind: "favorites"}); err != nil {
		t.Fatal(err)
	}
	if err = s.mergeCloud([]LibraryEntry{{Drama: drama, FavoriteAt: 1}}, time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if len(s.snapshot().Entries) != 0 {
		t.Fatal("local clear reappeared on next pull")
	}
}
