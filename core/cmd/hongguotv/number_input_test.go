package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"
)

func inputFixture(t *testing.T, kind string) (*numberInputManager, numberInputResult, string) {
	t.Helper()
	m := newNumberInputManager()
	m.selectIP = func() (net.IP, error) { return net.ParseIP("127.0.0.1"), nil }
	t.Cleanup(m.close)
	result, err := m.start(kind)
	if err != nil {
		t.Fatal(err)
	}
	return m, result, "http://" + m.active.host + "/input/" + result.Session
}

func postInput(t *testing.T, m *numberInputManager, address, value string) (int, string) {
	t.Helper()
	m.mu.Lock()
	key := m.active.formKey
	m.mu.Unlock()
	response, err := http.PostForm(address, url.Values{"value": {value}, "form_key": {key}})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	return response.StatusCode, string(body)
}

func TestNumberInputLocaleUsesRegisteredLanguageFamily(t *testing.T) {
	original := numberInputLocales["en-US"]
	numberInputLocales["en-US"] = numberInputLocale{DocumentTitle: "English", PhoneTitle: "Phone %s", PhoneLabel: "Phone %s"}
	t.Cleanup(func() {
		if original.DocumentTitle == "" {
			delete(numberInputLocales, "en-US")
		} else {
			numberInputLocales["en-US"] = original
		}
	})
	got := numberInputLocaleFor("en-GB,en;q=0.9,zh-CN;q=0.8", "phone", "+1")
	if got.DocumentTitle != "English" || got.PhoneTitle != "Phone +1" || got.PhoneLabel != "Phone +1" {
		t.Fatalf("locale family was not selected: %+v", got)
	}
}

func TestNumberInputMobileRoundTripAndOneTimeConsumption(t *testing.T) {
	for _, item := range []struct{ kind, value string }{{"phone", "13800000000"}, {"code", "012345"}, {"danmaku", "测试弹幕"}} {
		t.Run(item.kind, func(t *testing.T) {
			m, result, address := inputFixture(t, item.kind)
			if result.ExpiresIn != 300 || len(result.Session) != 64 {
				t.Fatal("wrong session lifetime/entropy")
			}
			qr, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(result.QR, "data:image/png;base64,"))
			if err != nil {
				t.Fatal(err)
			}
			image, err := png.Decode(strings.NewReader(string(qr)))
			if err != nil || image.Bounds().Dx() != 280 {
				t.Fatal("invalid QR PNG")
			}
			response, err := http.Get(address)
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(response.Body)
			response.Body.Close()
			if response.StatusCode != 200 || !strings.Contains(string(body), "回填电视") || strings.Contains(string(body), item.value) {
				t.Fatal("wrong phone form")
			}
			if response.Header.Get("Cache-Control") != "no-store" || response.Header.Get("Referrer-Policy") != "no-referrer" || response.Header.Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("phone form can leak")
			}
			if got := m.poll(result.Session, false); got.State != "waiting" {
				t.Fatal(got)
			}
			if status, body := postInput(t, m, address, item.value); status != 200 || !strings.Contains(body, "已发送到电视") || strings.Contains(body, item.value) {
				t.Fatal(status, "wrong success page")
			}
			if status, _ := postInput(t, m, address, item.value); status != 410 {
				t.Fatal("repeated form accepted")
			}
			got := m.poll(result.Session, false)
			if got.State != "completed" || got.Value != item.value || got.Kind != item.kind {
				t.Fatal("number not consumed correctly")
			}
			if got := m.poll(result.Session, false); got.State != "expired" || got.Value != "" {
				t.Fatal("number was retained")
			}
			if m.active != nil {
				t.Fatal("session retained")
			}
			if response, err := http.Get(address); err == nil {
				response.Body.Close()
				t.Fatal("LAN port still open")
			}
		})
	}
}

func TestNumberInputRejectsInvalidAndUnexpectedMobileRequests(t *testing.T) {
	m, result, address := inputFixture(t, "code")
	for _, value := range []string{"123", "012345678", "123abc", "1234\n", "<script>", ""} {
		if status, _ := postInput(t, m, address, value); status != 400 {
			t.Fatal("invalid digits accepted")
		}
	}
	client := &http.Client{Timeout: time.Second}
	for _, item := range []struct {
		method, path, host, origin, body string
		status                           int
	}{
		{"GET", "/api/v1/account", "", "", "", 404},
		{"GET", "/minireel-proxy/media/test", "", "", "", 404},
		{"GET", "/input/wrong", "", "", "", 404},
		{"GET", "/input/" + result.Session, "attacker.example", "", "", 404},
		{"POST", "/input/" + result.Session, "", "https://attacker.example", "value=012345", 403},
		{"PUT", "/input/" + result.Session, "", "", "value=012345", 405},
		{"POST", "/input/" + result.Session, "", "", "value=012345&value=123456", 400},
		{"POST", "/input/" + result.Session, "", "", "value=012345&kind=phone", 400},
		{"POST", "/input/" + result.Session, "", "", "value=" + strings.Repeat("1", 2048), 403},
	} {
		request, _ := http.NewRequest(item.method, "http://"+m.active.host+item.path, strings.NewReader(item.body+"&form_key="+m.active.formKey))
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if item.host != "" {
			request.Host = item.host
		}
		if item.origin != "" {
			request.Header.Set("Origin", item.origin)
		}
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != item.status {
			t.Fatal(item.path, response.StatusCode, item.status)
		}
	}
	if got := m.poll(result.Session, false); got.State != "waiting" {
		t.Fatal("invalid request changed state")
	}
}

func TestNumberInputExpiryReplacementCancellationAndShutdown(t *testing.T) {
	m, first, oldAddress := inputFixture(t, "phone")
	second, err := m.start("code")
	if err != nil {
		t.Fatal(err)
	}
	if first.Session == second.Session {
		t.Fatal("reused token")
	}
	if response, err := http.Get(oldAddress); err == nil {
		response.Body.Close()
		t.Fatal("old port open")
	}
	m.poll(first.Session, true) // A late DELETE must not cancel the new field.
	if got := m.poll(second.Session, false); got.State != "waiting" {
		t.Fatal("late cancellation closed new field")
	}
	m.mu.Lock()
	m.active.expires = time.Now().Add(-time.Second)
	m.mu.Unlock()
	if got := m.poll(second.Session, false); got.State != "expired" {
		t.Fatal("expired session accepted")
	}
	third, err := m.start("phone")
	if err != nil {
		t.Fatal(err)
	}
	if got := m.poll(third.Session, true); got.State != "expired" || m.active != nil {
		t.Fatal("cancel did not clear")
	}
	m.close()
	if _, err := m.start("phone"); err == nil {
		t.Fatal("closed runtime reopened")
	}
}

func TestNumberInputManagementRemainsPrivateToLocalCore(t *testing.T) {
	m, result, _ := inputFixture(t, "code")
	s := &server{numberInputs: m}
	handler := s.withCORS(http.HandlerFunc(s.numberInput))
	for _, item := range []struct{ host, remote, origin string }{
		{"192.168.1.2:8797", "192.168.1.5:1234", ""},
		{"127.0.0.1:8797", "192.168.1.5:1234", ""},
		{"127.0.0.1:8797", "127.0.0.1:1234", "https://evil.example"},
	} {
		request := httptest.NewRequest("GET", "http://"+item.host+"/api/v1/number-input?session="+result.Session, nil)
		request.RemoteAddr = item.remote
		request.Header.Set("Origin", item.origin)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 403 || strings.Contains(response.Body.String(), result.Session) {
			t.Fatal("remote management accepted")
		}
	}
	request := httptest.NewRequest("GET", "http://127.0.0.1:8797/api/v1/number-input?session="+result.Session, nil)
	request.RemoteAddr = "127.0.0.1:1234"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	var payload struct {
		Data numberInputResult `json:"data"`
	}
	json.Unmarshal(response.Body.Bytes(), &payload)
	if response.Code != 200 || payload.Data.State != "waiting" || response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("private poll failed")
	}
}

func TestNumberInputLANSelectionAndGracefulFailure(t *testing.T) {
	for _, item := range []struct {
		ip    string
		valid bool
	}{{"10.0.0.2", true}, {"172.16.1.5", true}, {"172.31.0.1", true}, {"192.168.1.2", true}, {"127.0.0.1", false}, {"0.0.0.0", false}, {"1.1.1.1", false}, {"172.32.0.1", false}, {"::1", false}} {
		if numberInputPrivateIPv4(net.ParseIP(item.ip)) != item.valid {
			t.Fatal(item)
		}
	}
	m := newNumberInputManager()
	defer m.close()
	m.selectIP = func() (net.IP, error) { return nil, errors.New("offline") }
	if _, err := m.start("phone"); err == nil || m.active != nil {
		t.Fatal("offline created session")
	}
	if _, err := m.start("other"); err == nil {
		t.Fatal("unexpected field allowed")
	}
}

func TestNumberInputTimerClearsAbandonedNumberAndClosesListener(t *testing.T) {
	m, result, address := inputFixture(t, "code")
	if status, _ := postInput(t, m, address, "012345"); status != 200 {
		t.Fatal(status)
	}
	m.mu.Lock()
	m.active.timer.Reset(time.Millisecond)
	m.mu.Unlock()
	deadline := time.Now().Add(time.Second)
	for {
		m.mu.Lock()
		cleared := m.active == nil
		m.mu.Unlock()
		if cleared {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("expired number retained")
		}
		time.Sleep(time.Millisecond)
	}
	if got := m.poll(result.Session, false); got.State != "expired" || got.Value != "" {
		t.Fatal("expired value delivered")
	}
	if response, err := http.Get(address); err == nil {
		response.Body.Close()
		t.Fatal("expired listener open")
	}
}

func TestNumberInputBrowserNullOriginAndHiddenFormKey(t *testing.T) {
	m, result, address := inputFixture(t, "code")
	response, err := http.Get(address)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	match := regexp.MustCompile(`name="form_key" value="([0-9a-f]+)"`).FindStringSubmatch(string(body))
	if len(match) != 2 || match[1] == result.Session {
		t.Fatal("no independent form key")
	}
	for _, key := range []string{"", "wrong", match[1]} {
		request, _ := http.NewRequest("POST", address, strings.NewReader(url.Values{"value": {"012345"}, "form_key": {key}}.Encode()))
		request.Header.Set("Origin", "null")
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		expected := 403
		if key == match[1] {
			expected = 200
		}
		if response.StatusCode != expected {
			t.Fatal("wrong browser form validation", response.StatusCode, expected)
		}
	}
	if got := m.poll(result.Session, false); got.Value != "012345" {
		t.Fatal("valid form did not arrive")
	}
}
