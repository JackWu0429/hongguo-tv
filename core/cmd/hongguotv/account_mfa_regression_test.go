package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Wire values are read from Mac UpsmsVerify instructions and string lengths,
// not from neighboring characters in its disassembler's string preview.
func TestUpSMSVerificationMatchesReferenceWireContract(t *testing.T) {
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/passport/upsms/verify/" {
			accountFixtureResponse(w, r.URL.Path, false)
			return
		}
		if r.Method != http.MethodPost {
			t.Error("verification must use POST")
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		want := url.Values{
			"encrypt_uid": {"fixture-uid"}, "verify_ticket": {""},
			"verify_scene": {"sms_login"}, "verify_reason": {"ato"},
			"copywriting_key": {"sms_login"}, "ies_safety_diversion_tag": {"mfa"},
			"new_verify_flow": {""}, "new_authn_sdk_version": {"1.1.31"},
			"new_authn_sdk_verify_reason": {"ato"}, "new_authn_sdk_verify_scene": {"sms_login"},
			"request_tag_from": {"h5"}, "new_authn_sdk_log_id": {"fixture-log"},
		}
		for key, value := range want {
			if len(r.PostForm[key]) != 1 || r.PostForm.Get(key) != value[0] {
				t.Errorf("incorrect field %s", key)
			}
		}
		if len(r.PostForm) != len(want)+1 {
			t.Error("unexpected verification fields")
		}
		var biz map[string]string
		if json.Unmarshal([]byte(r.PostForm.Get("biz_params")), &biz) != nil || len(biz) != 2 || biz["sms_code_key"] != "fixture-key" || biz["passport_mfa_retry_tag"] != "1" {
			t.Error("invalid challenge business parameters")
		}
		ioJSON(w, `{"message":"error","data":{"error_code":1045}}`)
	})
	client := m.newClient(m.disk.Session)
	if _, err := client.verifyMFA(context.Background(), &accountMFA{EncryptUID: "fixture-uid", CodeKey: "fixture-key", LogID: "fixture-log"}, "13800000000"); err != nil {
		t.Fatal(err)
	}
}

func TestNewMFAHasItsOwnLifetimeAfterSMSCodeEntry(t *testing.T) {
	var verify atomic.Int32
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/passport/mobile/sms_login/":
			accountFixtureResponse(w, r.URL.Path, true)
		case "/passport/upsms/verify/":
			verify.Add(1)
			ioJSON(w, `{"message":"error","data":{"error_code":1045}}`)
		default:
			accountFixtureResponse(w, r.URL.Path, false)
		}
	})
	if err := m.sendCode(context.Background(), "13800000000"); err != nil {
		t.Fatal(err)
	}
	m.login.expires = time.Now().Add(2 * time.Second)
	if err := m.loginSMS(context.Background(), "13800000000", "123456"); err != nil {
		t.Fatal(err)
	}
	deadline := m.login.mfaExpires
	if time.Until(deadline) < 9*time.Minute {
		t.Fatal("new challenge inherited code entry time")
	}
	m.login.expires = time.Now().Add(-time.Minute)
	for i := 0; i < 2; i++ {
		if err := m.verifyLogin(context.Background()); err != nil {
			t.Fatal("code expiry invalidated an active MFA", err)
		}
		if m.login.mfaExpires != deadline || m.status().MFAExpires != deadline.UnixMilli() {
			t.Fatal("poll extended challenge lifetime")
		}
	}
	if verify.Load() != 2 {
		t.Fatal("verification was not queried")
	}
}

func TestUpstreamMFAExpiryClearsChallengeWithoutRepeatingSMS(t *testing.T) {
	var sends, verify atomic.Int32
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/passport/mobile/send_code/v1/":
			sends.Add(1)
			accountFixtureResponse(w, r.URL.Path, false)
		case "/passport/mobile/sms_login/":
			accountFixtureResponse(w, r.URL.Path, true)
		case "/passport/upsms/verify/":
			verify.Add(1)
			ioJSON(w, `{"message":"error","data":{"error_code":9001,"description":"长时间未操作，验证已过期"}}`)
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
	err := m.verifyLogin(context.Background())
	if err == nil || !strings.Contains(err.Error(), "红果已结束") || !strings.Contains(err.Error(), "9001") {
		t.Fatal("upstream rejection was not identified", err)
	}
	s := m.status()
	if s.Phase != "phone" || s.SMSQRCode != "" || s.MFAExpires != 0 || m.login != nil || m.busy || !strings.Contains(s.Error, "红果已结束") {
		t.Fatal("invalid challenge remains active")
	}
	_ = m.verifyLogin(context.Background())
	if sends.Load() != 1 || verify.Load() != 1 {
		t.Fatal("expiry repeated SMS or queried the rejected challenge")
	}
}

func TestLateExpiryCannotClearAReplacementLogin(t *testing.T) {
	m := &accountManager{generation: 2, phase: "mfa", login: &loginAttempt{mfaExpires: time.Now().Add(time.Minute)}}
	current := m.login
	_ = m.rejectExpiredMFA(1, map[string]any{"message": "error", "data": map[string]any{"error_code": 9001, "description": "验证已过期"}})
	if m.login != current || m.generation != 2 || m.phase != "mfa" {
		t.Fatal("stale expiry cleared new session")
	}
}

func TestTemporaryMFAFailureKeepsTheChallenge(t *testing.T) {
	m := &accountManager{generation: 1, phase: "mfa", login: &loginAttempt{mfaExpires: time.Now().Add(time.Minute)}}
	current := m.login
	if err := m.rejectExpiredMFA(1, map[string]any{"message": "error", "data": map[string]any{"error_code": 9002, "description": "请稍后重试"}}); err != nil {
		t.Fatal(err)
	}
	if m.login != current || m.phase != "mfa" {
		t.Fatal("temporary failure invalidated challenge")
	}
}
