package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html/template"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	qrcode "github.com/skip2/go-qrcode"
)

const numberInputTTL = 5 * time.Minute

var numberPhoneRE = regexp.MustCompile(`^1[3-9][0-9]{9}$`)
var numberCodeRE = regexp.MustCompile(`^[0-9]{4,8}$`)
var numberPage = template.Must(template.New("number-input").Funcs(template.FuncMap{
	"title":        func(t numberInputLocale, kind string) string { return t.Title(kind) },
	"description":  func(t numberInputLocale, kind string) string { return t.Description(kind) },
	"label":        func(t numberInputLocale, kind string) string { return t.Label(kind) },
	"placeholder":  func(t numberInputLocale, kind string) string { return t.Placeholder(kind) },
	"submit":       func(t numberInputLocale, kind string) string { return t.Submit(kind) },
	"hint":         func(t numberInputLocale, kind string) string { return t.Hint(kind) },
	"completeCopy": func(t numberInputLocale, kind string) string { return t.CompleteCopy(kind) },
}).ParseFS(uiFiles, "ui/number-input.html"))

const numberTextLimit = 100

// This listener only serves a single short-lived input form. The account,
// library and media core continues to listen exclusively on loopback.
type numberInputSession struct {
	id, kind, host, value, formKey string
	phoneCountryCode               string
	expires                        time.Time
	listener                       net.Listener
	server                         *http.Server
	timer                          *time.Timer
	completed                      bool
}

type numberInputManager struct {
	mu       sync.Mutex
	active   *numberInputSession
	closed   bool
	selectIP func() (net.IP, error)
}

type numberInputResult struct {
	Session   string `json:"session,omitempty"`
	Kind      string `json:"kind,omitempty"`
	State     string `json:"state"`
	QR        string `json:"qr,omitempty"`
	ExpiresIn int    `json:"expires_in,omitempty"`
	Value     string `json:"value,omitempty"`
}

func newNumberInputManager() *numberInputManager {
	return &numberInputManager{selectIP: numberInputLANIP}
}

func numberInputPrivateIPv4(ip net.IP) bool {
	ip = ip.To4()
	return ip != nil && (ip[0] == 10 || ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31 || ip[0] == 192 && ip[1] == 168)
}

func numberInputLANIP() (net.IP, error) {
	// UDP connect asks the routing table for the preferred source address;
	// it does not transmit a packet or depend on an Internet response.
	conn, err := net.DialTimeout("udp4", "1.1.1.1:53", 300*time.Millisecond)
	if err == nil {
		ip := conn.LocalAddr().(*net.UDPAddr).IP
		conn.Close()
		if numberInputPrivateIPv4(ip) {
			return ip, nil
		}
	}
	interfaces, _ := net.Interfaces()
	for _, item := range interfaces {
		if item.Flags&net.FlagUp == 0 || item.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, _ := item.Addrs()
		for _, address := range addresses {
			ip, _, _ := net.ParseCIDR(address.String())
			if numberInputPrivateIPv4(ip) {
				return ip.To4(), nil
			}
		}
	}
	return nil, errors.New("未找到局域网连接，可继续使用数字键盘")
}

func validNumberInput(kind, value string, phoneCountryCode ...string) bool {
	if kind == "search" {
		_, valid := normalizeSearchQuery(value)
		return valid
	}
	if kind == "danmaku" {
		_, valid := normalizeDanmakuInput(value)
		return valid
	}
	if kind == "phone" {
		code := "+86"
		if len(phoneCountryCode) > 0 && phoneCountryCode[0] != "" {
			code = phoneCountryCode[0]
		}
		_, err := normalizeAccountPhone(code, value)
		return err == nil
	}
	return kind == "code" && numberCodeRE.MatchString(value)
}

func normalizeDanmakuInput(value string) (string, bool) {
	if !utf8.ValidString(value) {
		return "", false
	}
	value = strings.TrimSpace(value)
	if value == "" || len(utf16.Encode([]rune(value))) > numberTextLimit {
		return "", false
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return "", false
		}
	}
	return value, true
}

func (m *numberInputManager) stopLocked() {
	if session := m.active; session != nil {
		session.value = ""
		session.formKey = ""
		session.timer.Stop()
		session.server.Close()
		m.active = nil
	}
}

func (m *numberInputManager) close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	m.stopLocked()
}

func (m *numberInputManager) start(kind string, countryCode ...string) (numberInputResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || kind != "phone" && kind != "code" && kind != "search" && kind != "danmaku" {
		return numberInputResult{}, errors.New("输入会话不可用")
	}
	m.stopLocked()
	ip, err := m.selectIP()
	if err != nil {
		if kind == "search" {
			return numberInputResult{}, errors.New("未找到局域网连接，可继续使用搜索框")
		}
		if kind == "danmaku" {
			return numberInputResult{}, errors.New("未找到局域网连接，可继续使用弹幕输入框")
		}
		return numberInputResult{}, err
	}
	// Bind only the chosen LAN address, rather than all host interfaces.
	listener, err := net.Listen("tcp4", net.JoinHostPort(ip.String(), "0"))
	if err != nil {
		if kind == "search" {
			return numberInputResult{}, errors.New("扫码输入暂不可用，可继续使用搜索框")
		}
		if kind == "danmaku" {
			return numberInputResult{}, errors.New("扫码输入暂不可用，可继续使用弹幕输入框")
		}
		return numberInputResult{}, errors.New("扫码输入暂不可用，可继续使用数字键盘")
	}
	var nonce [32]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		listener.Close()
		return numberInputResult{}, errors.New("无法创建扫码会话")
	}
	phoneCode := "+86"
	if kind == "phone" && len(countryCode) > 0 && countryCode[0] != "" {
		phoneCode = countryCode[0]
	}
	if kind == "phone" {
		if _, ok := accountPhoneCountryForCode(phoneCode); !ok {
			listener.Close()
			return numberInputResult{}, errors.New("暂不支持该国家或地区的手机号")
		}
	}
	session := &numberInputSession{id: hex.EncodeToString(nonce[:]), kind: kind, phoneCountryCode: phoneCode, host: listener.Addr().String(), expires: time.Now().Add(numberInputTTL), listener: listener}
	if _, err = rand.Read(nonce[:]); err != nil {
		listener.Close()
		return numberInputResult{}, errors.New("无法创建输入表单")
	}
	session.formKey = hex.EncodeToString(nonce[:])
	png, err := qrcode.Encode("http://"+session.host+"/input/"+session.id, qrcode.Medium, 280)
	if err != nil {
		listener.Close()
		return numberInputResult{}, errors.New("无法生成输入二维码")
	}
	session.server = &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.mobile(session, w, r) }), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 8192}
	m.active = session
	session.timer = time.AfterFunc(numberInputTTL, func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.active == session {
			m.stopLocked()
		}
	})
	go session.server.Serve(listener) // No request URL, phone or code is logged.
	return numberInputResult{Session: session.id, Kind: kind, State: "waiting", QR: "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), ExpiresIn: int(numberInputTTL.Seconds())}, nil
}

func (m *numberInputManager) poll(id string, cancel bool) numberInputResult {
	m.mu.Lock()
	defer m.mu.Unlock()
	session := m.active
	if session == nil || id == "" || id != session.id {
		return numberInputResult{State: "expired"}
	}
	if cancel || !time.Now().Before(session.expires) {
		m.stopLocked()
		return numberInputResult{State: "expired"}
	}
	if session.completed {
		result := numberInputResult{State: "completed", Kind: session.kind, Value: session.value}
		m.stopLocked() // Deliver once, then clear the number and close the port.
		return result
	}
	return numberInputResult{State: "waiting", Kind: session.kind}
}

func (m *numberInputManager) mobile(session *numberInputSession, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || (!numberInputPrivateIPv4(net.ParseIP(remote)) && !net.ParseIP(remote).IsLoopback()) || r.Host != session.host || r.URL.Path != "/input/"+session.id {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	// Chrome may send Origin: null when a no-referrer form navigates. The
	// independent hidden form key still verifies submissions in old browsers.
	if origin := r.Header.Get("Origin"); origin != "" && origin != "null" && origin != "http://"+session.host || r.Header.Get("Sec-Fetch-Site") == "cross-site" && r.Method == http.MethodPost {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if m.active != session || session.completed || !time.Now().Before(session.expires) {
		renderNumberPage(w, http.StatusGone, map[string]any{"Expired": true, "Kind": session.kind, "Text": numberInputLocaleFor(r.Header.Get("Accept-Language"), session.kind, session.phoneCountryCode)})
		return
	}
	phoneCountry, _ := accountPhoneCountryForCode(session.phoneCountryCode)
	phonePattern := "[0-9]{" + strconv.Itoa(phoneCountry.Min) + "," + strconv.Itoa(phoneCountry.Max) + "}"
	if phoneCountry.Code == "+86" {
		phonePattern = "1[3-9][0-9]{9}"
	}
	copy := numberInputLocaleFor(r.Header.Get("Accept-Language"), session.kind, session.phoneCountryCode)
	data := map[string]any{"Phone": session.kind == "phone", "PhoneCountryCode": session.phoneCountryCode, "PhoneMinLength": phoneCountry.Min, "PhoneMaxLength": phoneCountry.Max, "PhonePattern": phonePattern, "Search": session.kind == "search", "Danmaku": session.kind == "danmaku", "Kind": session.kind, "Action": r.URL.Path, "FormKey": session.formKey, "Text": copy}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		limit := int64(1024)
		if session.kind == "search" || session.kind == "danmaku" {
			limit = 4096
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		if err := r.ParseForm(); err != nil || len(r.PostForm["form_key"]) != 1 || r.PostForm.Get("form_key") != session.formKey {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if len(r.PostForm["value"]) != 1 || len(r.PostForm) != 2 || !validNumberInput(session.kind, r.PostForm.Get("value"), session.phoneCountryCode) {
			status = http.StatusBadRequest
			data["Error"] = copy.GenericError
			if session.kind == "search" {
				data["Error"] = copy.SearchError
			} else if session.kind == "danmaku" {
				data["Error"] = copy.DanmakuError
			}
		} else {
			session.value = r.PostForm.Get("value")
			if session.kind == "search" {
				session.value, _ = normalizeSearchQuery(session.value)
			} else if session.kind == "danmaku" {
				session.value, _ = normalizeDanmakuInput(session.value)
			}
			session.completed = true
			data["Complete"] = true
		}
	}
	renderNumberPage(w, status, data)
}

func renderNumberPage(w http.ResponseWriter, status int, data map[string]any) {
	var body bytes.Buffer
	if err := numberPage.ExecuteTemplate(&body, "number-input.html", data); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	// Explicit length lets the phone finish even when the TV consumes the
	// value and closes this listener immediately after the response is sent.
	w.Header().Set("Content-Length", strconv.Itoa(body.Len()))
	w.WriteHeader(status)
	w.Write(body.Bytes())
	if flush, ok := w.(http.Flusher); ok {
		flush.Flush() // Complete the phone response before TV consumes the number.
	}
}

func (s *server) numberInput(w http.ResponseWriter, r *http.Request) {
	if s.numberInputs == nil {
		writeError(w, http.StatusServiceUnavailable, "扫码输入暂不可用，可继续使用数字键盘")
		return
	}
	switch r.Method {
	case http.MethodPost:
		var request struct {
			Kind        string `json:"kind"`
			CountryCode string `json:"country_code,omitempty"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1024)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil || request.Kind != "phone" && request.Kind != "code" && request.Kind != "search" && request.Kind != "danmaku" {
			writeError(w, http.StatusBadRequest, "只支持手机号、验证码、搜索或弹幕输入")
			return
		}
		result, err := s.numberInputs.start(request.Kind, request.CountryCode)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": result})
	case http.MethodGet, http.MethodDelete:
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": s.numberInputs.poll(r.URL.Query().Get("session"), r.Method == http.MethodDelete)})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
