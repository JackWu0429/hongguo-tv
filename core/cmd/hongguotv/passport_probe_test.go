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
