package main

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestSMSFailureRetainsReasonAndAppCodeInput(t *testing.T) {
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/passport/mobile/send_code/v1/" {
			ioJSON(w, `{"message":"error","data":{"error_code":1003,"description":"测试发码请求被拒绝"}}`)
			return
		}
		accountFixtureResponse(w, r.URL.Path, false)
	})
	err := m.sendCode(context.Background(), "+85261234567")
	s := m.status()
	if err == nil || err.Error() != "测试发码请求被拒绝（1003）" || s.Error != err.Error() || !s.AppCode {
		t.Fatalf("failure reason and App-code availability were not retained: %v %+v", err, s)
	}
}

func TestDeviceRegistrationFailureKeepsAppCodeLoginAvailable(t *testing.T) {
	var smsLoginCalls int
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/service/2/device_register/":
			w.WriteHeader(http.StatusBadGateway)
		case "/passport/mobile/sms_login/":
			smsLoginCalls++
			if err := r.ParseForm(); err != nil || r.PostForm.Get("mobile") != passportXOR("+8526123 4567") || r.PostForm.Get("code") != passportXOR("012345") {
				t.Error("App code login did not retain the selected country and entered code")
			}
			w.Header().Set("X-Tt-Token", "fixture-secret-token")
			http.SetCookie(w, &http.Cookie{Name: "sessionid", Value: "fixture-secret-cookie"})
			ioJSON(w, `{"message":"success","data":{"user_id_str":"123456789","screen_name":"App码用户"}}`)
		default:
			accountFixtureResponse(w, r.URL.Path, false)
		}
	})
	if err := m.sendCode(context.Background(), "+85261234567"); err == nil {
		t.Fatal("device registration failure was accepted")
	}
	status := m.status()
	if status.Error != "设备注册返回 HTTP 502" || !status.AppCode || status.LoggedIn {
		t.Fatalf("device-registration fallback was not exposed: %+v", status)
	}
	if err := m.loginSMS(context.Background(), "+85261234567", "012345"); err != nil {
		t.Fatal(err)
	}
	status = m.status()
	if !status.LoggedIn || status.AppCode || status.Phase != "logged_in" || smsLoginCalls != 1 {
		t.Fatalf("App-code login after registration failure did not complete cleanly: %+v", status)
	}
}

func TestPassportFailureReportsMissingReasonWithoutGuessing(t *testing.T) {
	for _, description := range []string{"", "https://example.test/?ticket=private", "private\nvalue", strings.Repeat("x", 121)} {
		err := passportFailure(map[string]any{"message": "error", "data": map[string]any{"error_code": 1003, "description": description}})
		if err.Error() != "红果未提供具体失败原因（1003）" {
			t.Fatalf("missing or unsafe description was not handled: %v", err)
		}
	}
}
