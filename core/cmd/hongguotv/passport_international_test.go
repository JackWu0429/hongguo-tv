package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestInternationalPassportPackageVectors(t *testing.T) {
	data, err := os.ReadFile("testdata/passport-international-v124.json")
	if err != nil {
		t.Fatal(err)
	}
	var evidence struct {
		Regions []struct {
			Code, Name, Local, Wire string
			Min, Max                int
		}
		Vectors []struct {
			Query, Body, Gorgon, Argus, Ladon string
			TS                                uint32
			Nonce                             uint16
		}
	}
	if err := json.Unmarshal(data, &evidence); err != nil {
		t.Fatal(err)
	}
	if len(evidence.Regions) != len(accountPhoneCountries) {
		t.Fatal("country list differs from the inspected package")
	}
	for _, region := range evidence.Regions {
		t.Run(region.Code, func(t *testing.T) {
			country, ok := accountPhoneCountryForCode(region.Code)
			if !ok || country.Name != region.Name || country.Min != region.Min || country.Max != region.Max {
				t.Fatalf("country policy differs from package: %+v", country)
			}
			canonical, err := normalizeAccountPhone(region.Code, region.Local)
			if err != nil || canonical != region.Code+region.Local {
				t.Fatal("internal identity must remain compact E.164", err)
			}
			if got := passportWirePhone(canonical); got != region.Wire {
				t.Errorf("wire number %q, expected %q", got, region.Wire)
			}
			if got := passportForm(canonical).Get("mobile"); got != passportXOR(region.Wire) {
				t.Error("wire formatting was not applied before XOR")
			}
		})
	}
	for _, vector := range evidence.Vectors {
		if got := passportInternationalGorgon(vector.Query, []byte(vector.Body), vector.TS, vector.Nonce); got != vector.Gorgon {
			t.Errorf("standard RC4 signature differs from independent vector: %s != %s", got, vector.Gorgon)
		}
		q, _ := url.ParseQuery(vector.Query)
		raw, headers, err := signInternationalPassportRequest(q, []byte(vector.Body), int64(vector.TS)*1000+123)
		if err != nil {
			t.Fatal(err)
		}
		if headers.Get("X-Argus") != vector.Argus || headers.Get("X-Ladon") != vector.Ladon || headers.Get("X-Medusa") != "" {
			t.Fatal("mode-4 header set or timestamp byte order differs from package")
		}
		assertInternationalPassportHeaders(t, raw, []byte(vector.Body), headers)
	}
}

func assertInternationalPassportHeaders(t *testing.T, raw string, body []byte, headers http.Header) {
	t.Helper()
	for _, key := range []string{"X-Khronos", "X-Gorgon", "X-Helios", "X-Argus", "X-Ladon", "X-SS-Req-Ticket", "X-TT-Trace-Id"} {
		if headers.Get(key) == "" {
			t.Errorf("international login missing header %s", key)
		}
	}
	if headers.Get("X-Medusa") != "" {
		t.Error("international request inherited the full-mode Medusa header")
	}
	stamp, err := strconv.ParseUint(headers.Get("X-Khronos"), 10, 32)
	if err != nil {
		t.Fatal(err)
	}
	ts := uint32(stamp)
	argus, _ := base64.StdEncoding.DecodeString(headers.Get("X-Argus"))
	ladon, _ := base64.StdEncoding.DecodeString(headers.Get("X-Ladon"))
	if len(argus) != 4 || len(ladon) != 4 || binary.LittleEndian.Uint32(argus) != ts || binary.BigEndian.Uint32(ladon) != ts {
		t.Error("signature timestamps disagree")
	}
	gorgon, err := hex.DecodeString(headers.Get("X-Gorgon"))
	if err != nil || len(gorgon) != 26 {
		t.Fatal("invalid Gorgon header")
	}
	nonce := binary.LittleEndian.Uint16(gorgon[2:4])
	if passportInternationalGorgon(raw, body, ts, nonce) != headers.Get("X-Gorgon") {
		t.Error("signature did not bind to the actual URL and request body")
	}
	if len(body) > 0 {
		stub := md5.Sum(body)
		if headers.Get("X-SS-STUB") != strings.ToUpper(hex.EncodeToString(stub[:])) {
			t.Error("body checksum differs from the transmitted form")
		}
	} else if headers.Get("X-SS-STUB") != "" {
		t.Error("empty body acquired a checksum header")
	}
	q, _ := url.ParseQuery(raw)
	if headers.Get("X-SS-Req-Ticket") != q.Get("_rticket") {
		t.Error("header ticket differs from signed query ticket")
	}
}

func TestPassportSignatureSelectionIsPerRequest(t *testing.T) {
	var captured int
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/passport/") {
			accountFixtureResponse(w, r.URL.Path, false)
			return
		}
		captured++
		body, _ := io.ReadAll(r.Body)
		form, _ := url.ParseQuery(string(body))
		phone := "+85261234567"
		if captured >= 4 && captured <= 6 {
			phone = "+8613800000000"
		}
		if captured >= 7 {
			phone = "+8109012345678"
		}
		if r.URL.Path != "/passport/upsms/verify/" && form.Get("mobile") != passportXOR(passportWirePhone(phone)) {
			t.Error("wire phone lost selected region or formatting")
		}
		if accountPhoneCountryCode(phone) != "+86" {
			assertInternationalPassportHeaders(t, r.URL.RawQuery, body, r.Header)
		} else if r.Header.Get("X-Medusa") == "" || r.Header.Get("X-Argus") != "" || r.Header.Get("X-Ladon") != "" {
			t.Error("mainland request inherited international signing")
		}
		accountFixtureResponse(w, r.URL.Path, false)
	})
	c := m.newClient(m.disk.Session)
	ctx := context.Background()
	for _, phone := range []string{"+85261234567", "+8613800000000", "+8109012345678"} {
		if _, err := c.sendCode(ctx, phone); err != nil {
			t.Fatal(err)
		}
		if _, err := c.smsLogin(ctx, phone, "012345", "fixture-ticket"); err != nil {
			t.Fatal(err)
		}
		if _, err := c.verifyMFA(ctx, &accountMFA{EncryptUID: "fixture-encrypted", CodeKey: "fixture-key"}, phone); err != nil {
			t.Fatal(err)
		}
	}
	if captured != 9 {
		t.Fatalf("captured %d requests, expected 9", captured)
	}
}

func TestInternationalAppCodeFallbackAndMFAKeepSignatureMode(t *testing.T) {
	var steps []string
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/passport/") {
			accountFixtureResponse(w, r.URL.Path, false)
			return
		}
		body, _ := io.ReadAll(r.Body)
		r.Body = io.NopCloser(bytes.NewReader(body))
		_ = r.ParseForm()
		assertInternationalPassportHeaders(t, r.URL.RawQuery, body, r.Header)
		steps = append(steps, r.URL.Path)
		switch r.URL.Path {
		case "/passport/mobile/send_code/v1/":
			ioJSON(w, `{"message":"error","data":{"error_code":1003}}`)
		case "/passport/mobile/sms_login/":
			if r.PostForm.Get("mobile") != passportXOR("+8526123 4567") || r.PostForm.Get("code") != passportXOR("012345") {
				t.Error("login discarded phone region or code's leading zero")
			}
			accountFixtureResponse(w, r.URL.Path, r.PostForm.Get("sms_code_key") == "")
		case "/passport/upsms/verify/":
			ioJSON(w, `{"message":"success","data":{"ticket":"fixture-ticket"}}`)
		}
	})
	ctx := context.Background()
	if err := m.sendCode(ctx, "+85261234567"); err == nil || !m.status().AppCode {
		t.Fatal("SMS failure did not leave App-code input available")
	}
	if err := m.loginSMS(ctx, "+85261234567", "012345"); err != nil || m.status().Phase != "mfa" {
		t.Fatal("App-code login did not enter the verification challenge", err)
	}
	if err := m.verifyLogin(ctx); err != nil || !m.status().LoggedIn {
		t.Fatal("verification did not complete fixture login", err)
	}
	if len(steps) != 4 || steps[2] != "/passport/upsms/verify/" || steps[3] != "/passport/mobile/sms_login/" {
		t.Fatalf("unexpected login/challenge sequence: %v", steps)
	}
}
