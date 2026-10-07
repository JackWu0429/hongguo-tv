package main

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestLiveAnonymousPassport(t *testing.T) {
	if os.Getenv("HONGGUO_LIVE_ACCOUNT_PROBE") != "1" {
		t.Skip("read-only live probe")
	}
	c := newPassportClient(accountSession{DeviceID: miniReelRandomID(), InstallID: miniReelRandomID(), Cookies: map[string]string{}})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	p, err := c.request(ctx, "/reading/user/info/v1/", http.MethodGet, nil, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("anonymous user-info: code=%q message=%q data-present=%t", asString(p["code"]), asString(p["message"]), p["data"] != nil)
}

func TestLiveAnonymousRegisteredPassport(t *testing.T) {
	if os.Getenv("HONGGUO_LIVE_DEVICE_PROBE") != "1" {
		t.Skip("anonymous registration and GET only; no SMS")
	}
	d, err := newPassportDevice()
	if err != nil {
		t.Fatal(err)
	}
	c := newPassportClient(accountSession{Device: d})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err = c.registerDevice(ctx); err != nil {
		t.Fatal(err)
	}
	if !c.session.Registered || !validID(c.session.DeviceID) || !validID(c.session.InstallID) {
		t.Fatal("registration missing identity")
	}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		var body []byte
		typ := ""
		if method == http.MethodPost {
			body = []byte("account_sdk_source=app&auto_read=0&mix_mode=1&passport_support_flow=captcha%2Cverify&type=3731&unbind_exist=34")
			typ = "application/x-www-form-urlencoded; charset=UTF-8"
		}
		p, err := c.request(ctx, "/passport/mobile/send_code/v1/", method, nil, body, typ)
		if err != nil {
			t.Fatal(err)
		}
		// No mobile/code/token/phone: even POST cannot address an SMS.
		if passportSuccess(p) || passportErrorCode(p) != "1003" {
			t.Fatalf("unexpected no-destination %s response code=%q", method, passportErrorCode(p))
		}
		t.Log("anonymous registered Passport", method, "HTTP 200 / error_code=1003; no SMS sent")
	}
}
