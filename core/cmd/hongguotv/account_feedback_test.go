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

func TestPassportFailureReportsMissingReasonWithoutGuessing(t *testing.T) {
	for _, description := range []string{"", "https://example.test/?ticket=private", "private\nvalue", strings.Repeat("x", 121)} {
		err := passportFailure(map[string]any{"message": "error", "data": map[string]any{"error_code": 1003, "description": description}})
		if err.Error() != "红果未提供具体失败原因（1003）" {
			t.Fatalf("missing or unsafe description was not handled: %v", err)
		}
	}
}
