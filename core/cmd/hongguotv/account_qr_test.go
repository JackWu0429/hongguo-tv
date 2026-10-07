package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSMSQRDataURL(t *testing.T) {
	if got := smsQRPayload("1060000", "ONLY-FIXTURE"); got != "SMSTO:1060000:ONLY-FIXTURE" {
		t.Fatalf("unexpected SMS payload %q", got)
	}
	for _, x := range [][2]string{{"10600\n00", "YZ"}, {"https://example.invalid", "YZ"}, {"1060000", ""}, {"1060000", "YZ\nOTHER"}, {"1060000", strings.Repeat("x", 257)}} {
		if smsQRDataURL(x[0], x[1]) != "" {
			t.Fatal("unsafe scanner payload allowed")
		}
	}
	data := smsQRDataURL("1060000", "ONLY-FIXTURE")
	b, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(data, "data:image/png;base64,"))
	if err != nil {
		t.Fatal(err)
	}
	im, err := png.Decode(bytes.NewReader(b))
	if err != nil || im.Bounds().Dx() != 240 || im.Bounds().Dy() != 240 {
		t.Fatal("invalid QR PNG", err)
	}
	if dir := os.Getenv("HONGGUO_QR_PROBE_DIR"); dir != "" {
		if err := os.WriteFile(filepath.Join(dir, "sms-fixture-qr.png"), b, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMFASessionDeadlineIsIndependentAndClearsQRCode(t *testing.T) {
	deadline := time.Now().Add(5 * time.Minute)
	m := &accountManager{phase: "mfa", login: &loginAttempt{phone: "13800000000", expires: time.Now().Add(-time.Minute), mfaExpires: deadline, mfa: &accountMFA{Number: "1060000", Content: "ONLY-FIXTURE"}, smsQRCode: smsQRDataURL("1060000", "ONLY-FIXTURE")}}
	for i := 0; i < 3; i++ {
		s := m.status()
		if s.MFAExpires != deadline.UnixMilli() || s.SMSQRCode == "" {
			t.Fatal("session changed or QR missing")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.login.cancelRequest = cancel
	m.login.mfaExpires = time.Now().Add(-time.Second)
	s := m.status()
	if ctx.Err() == nil {
		t.Fatal("expired session did not cancel its pending query")
	}
	if s.Phase != "phone" || s.MFAExpires != 0 || s.SMSQRCode != "" || s.SMSNumber != "" || s.SMSContent != "" || m.login != nil || s.Error == "" {
		t.Fatal("expired session retained login/QR data")
	}
	if err := m.verifyLogin(context.Background()); err == nil {
		t.Fatal("expired session accepted verification")
	}
}
