package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestPassportDeviceIndependentCryptoVector(t *testing.T) {
	b, err := os.ReadFile("testdata/passport-device-vector.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct{ Seed, DerivedKey, Plain, Ciphertext string }
	var raw map[string]string
	if json.Unmarshal(b, &raw) != nil {
		t.Fatal("vector invalid")
	}
	v.Seed, v.DerivedKey, v.Plain, v.Ciphertext = raw["seed"], raw["derived_key"], raw["plain"], raw["ciphertext"]
	seed := mustProtocolHex(v.Seed)
	key := passportDeviceKey(seed)
	if hex.EncodeToString(key[:]) != v.DerivedKey {
		t.Fatal("independent key derivation mismatch")
	}
	enc, _ := base64.StdEncoding.DecodeString(v.Ciphertext)
	plain, err := passportTTDecrypt(enc)
	if err != nil || string(plain) != v.Plain {
		t.Fatal("independent OpenSSL vector mismatch", err)
	}
	goEnc, err := passportTTEncrypt([]byte(v.Plain), seed)
	if err != nil {
		t.Fatal(err)
	}
	plain, err = passportTTDecrypt(goEnc)
	if err != nil || string(plain) != v.Plain {
		t.Fatal("TTEncrypt round trip failed")
	}
	goEnc[len(goEnc)-1] ^= 1
	if _, err = passportTTDecrypt(goEnc); err == nil {
		t.Fatal("corruption accepted")
	}
	for _, b := range [][]byte{nil, enc[:38], append(enc, 0)} {
		if _, err := passportTTDecrypt(b); err == nil {
			t.Fatal("malformed encrypted response accepted")
		}
	}
}

func TestPassportDeviceRegistersBeforeSMSAndPersistsAcrossRetryRestartLogout(t *testing.T) {
	var registrations, sms atomic.Int32
	var cdid string
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/service/2/device_register/" {
			registrations.Add(1)
			body, _ := io.ReadAll(r.Body)
			plain, err := passportTTDecrypt(body)
			if err != nil {
				t.Error(err)
				return
			}
			var p map[string]any
			if json.Unmarshal(plain, &p) != nil {
				t.Error("invalid registration payload")
				return
			}
			h, _ := asMap(p["header"])
			cdid = asString(h["cdid"])
			if cdid == "" || cdid != r.URL.Query().Get("cdid") || asString(h["openudid"]) != r.URL.Query().Get("openudid") || asString(h["aid"]) != "8662" {
				t.Error("registration profile/query mismatch")
			}
			if r.URL.Query().Get("device_id") != "" || r.URL.Query().Get("iid") != "" || strings.Contains(string(plain), "mobile") || r.Header.Get("X-Tt-Token") != "" || r.Header.Get("Cookie") != "" {
				t.Error("account data in registration")
			}
			hash := md5.Sum(body)
			if !strings.EqualFold(r.Header.Get("X-SS-STUB"), hex.EncodeToString(hash[:])) || r.Header.Get("X-Gorgon") == "" || r.Header.Get("X-Argus") == "" || r.Header.Get("Content-Type") != "application/octet-stream;tt-data=a" {
				t.Error("registration signing missing")
			}
			http.SetCookie(w, &http.Cookie{Name: "store-region", Value: "cn-tj"})
			accountFixtureResponse(w, r.URL.Path, false)
			return
		}
		sms.Add(1)
		if r.URL.Query().Get("device_id") != "7390000000000000001" || r.URL.Query().Get("iid") != "7390000000000000002" || r.URL.Query().Get("cdid") != cdid || r.Header.Get("Passport-Sdk-Version") != "5051452" {
			t.Error("SMS used unregistered/mismatched device")
		}
		w.WriteHeader(http.StatusForbidden)
	})
	for i := 0; i < 2; i++ {
		if err := m.sendCode(context.Background(), "13800000000"); err == nil {
			t.Fatal("403 accepted")
		}
		if !m.disk.Session.Registered || m.status().RetryAfter != 0 || m.status().Phase != "phone" {
			t.Fatal("identity lost or false resend countdown")
		}
	}
	if registrations.Load() != 1 || sms.Load() != 2 {
		t.Fatal("device not reused")
	}
	reloaded, err := newAccountManager(m.dir, m.guest, nil)
	if err != nil || !reloaded.disk.Session.Registered || reloaded.disk.Session.Device.CDID != cdid {
		t.Fatal("registration not persisted")
	}
	if err = m.logout(); err != nil || !m.disk.Session.Registered || m.disk.Session.Device.CDID != cdid {
		t.Fatal("logout discarded device identity")
	}
	if _, err := os.Stat(filepath.Join(m.dir, "account.json")); err != nil {
		t.Fatal(err)
	}
	// A client's response cookies must not mutate the manager's saved snapshot.
	c := newPassportClient(m.disk.Session)
	c.session.Cookies["sessionid"] = "private-fixture"
	if m.disk.Session.Cookies["sessionid"] != "" {
		t.Fatal("mutable session alias")
	}
}

func TestPassportDeviceInvalidRegistrationCannotSendSMS(t *testing.T) {
	for _, body := range []string{`{}`, `{"device_id":0,"install_id":123}`, `{"device_id_str":"1"}`, `{"device_id_str":"123","install_id_str":"456"} extra`} {
		t.Run(body, func(t *testing.T) {
			var sms atomic.Int32
			m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/service/2/device_register/" {
					ioJSON(w, body)
					return
				}
				sms.Add(1)
				accountFixtureResponse(w, r.URL.Path, false)
			})
			if err := m.sendCode(context.Background(), "13800000000"); err == nil {
				t.Fatal("bad registration accepted")
			}
			if sms.Load() != 0 || m.disk.Session.Registered || m.status().RetryAfter != 0 {
				t.Fatal("SMS attempted after failed registration")
			}
		})
	}
}

func TestPassportDeviceCanceledRegistrationCannotTriggerSMS(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var sms atomic.Int32
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/service/2/device_register/" {
			close(entered)
			<-release
			accountFixtureResponse(w, r.URL.Path, false)
			return
		}
		sms.Add(1)
		accountFixtureResponse(w, r.URL.Path, false)
	})
	done := make(chan error, 1)
	go func() { done <- m.sendCode(context.Background(), "13800000000") }()
	<-entered
	m.cancelLogin()
	close(release)
	if err := <-done; err == nil {
		t.Fatal("canceled registration succeeded")
	}
	if sms.Load() != 0 || m.disk.Session.Registered || m.status().RetryAfter != 0 {
		t.Fatal("late registration sent SMS or changed account")
	}
}

type passportErrorTransport struct{}

func (passportErrorTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("fixture timeout")
}

func TestPassportSendCodeCountdownReflectsOutcome(t *testing.T) {
	for _, tc := range []struct {
		name               string
		status             int
		body, retry, state string
		waiting, success   bool
	}{
		{"forbidden", 403, "", "", "rejected", false, false},
		{"server-rate-limit", 429, "", "120", "limited", true, false},
		{"business-reject", 200, `{"message":"error","data":{"error_code":1003}}`, "", "rejected", false, false},
		{"ambiguous-json", 200, `{"message":"error","data":{}}`, "", "uncertain", true, false},
		{"server-error", 503, "", "", "uncertain", true, false},
		{"success", 200, `{"message":"success","data":{"retry_time":60}}`, "", "sent", true, true},
		{"success-custom-wait", 200, `{"message":"success","data":{"retry_time":120}}`, "", "sent", true, true},
		{"timeout", 0, "", "", "uncertain", true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Retry-After", tc.retry)
				w.WriteHeader(tc.status)
				io.WriteString(w, tc.body)
			})
			m.disk.Session.Registered = true
			if tc.status == 0 {
				previous := m.newClient
				m.newClient = func(s accountSession) *passportClient {
					c := previous(s)
					c.http.Transport = passportErrorTransport{}
					return c
				}
			}
			err := m.sendCode(context.Background(), "13800000000")
			if (err == nil) != tc.success {
				t.Fatal("incorrect confirmation")
			}
			s := m.status()
			if s.SMSState != tc.state || (s.RetryAfter > 0) != tc.waiting {
				t.Fatalf("bad SMS state %q / wait %d", s.SMSState, s.RetryAfter)
			}
			if tc.name == "server-rate-limit" || tc.name == "success-custom-wait" {
				if s.RetryAfter < 119 || s.RetryAfter > 120 {
					t.Fatal("server cooldown ignored")
				}
			}
			m.mu.Lock()
			m.codeAfter = time.Now().Add(-time.Millisecond)
			m.mu.Unlock()
			if m.status().RetryAfter != 0 {
				t.Fatal("expired timer still displayed")
			}
		})
	}
}

func TestPassportDeviceEncryptedReplyAndExactNumericIDs(t *testing.T) {
	d, _ := newPassportDevice()
	for _, encrypted := range []bool{false, true} {
		m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
			b := []byte(`{"device_id":7391234567890123456,"install_id":7391234567890123457}`)
			if encrypted {
				b, _ = passportTTEncrypt(b, bytes.Repeat([]byte{1}, 32))
			}
			w.Write(b)
		})
		c := m.newClient(accountSession{Device: d})
		if err := c.registerDevice(context.Background()); err != nil {
			t.Fatal(err)
		}
		if c.session.DeviceID != "7391234567890123456" || c.session.InstallID != "7391234567890123457" {
			t.Fatal("registration ID precision lost")
		}
	}
}
