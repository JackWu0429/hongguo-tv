package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

type accountProfile struct {
	UID    string `json:"uid"`
	Name   string `json:"name"`
	Avatar string `json:"avatar,omitempty"`
	Phone  string `json:"phone,omitempty"` // Masked before storage.
}
type accountDisk struct {
	Version int             `json:"version"`
	Session accountSession  `json:"session"`
	Profile *accountProfile `json:"profile,omitempty"`
}
type accountStatus struct {
	LoggedIn   bool            `json:"logged_in"`
	Profile    *accountProfile `json:"profile,omitempty"`
	Phase      string          `json:"phase"`
	Phone      string          `json:"phone,omitempty"`
	RetryAfter int             `json:"retry_after"`
	SMSState   string          `json:"sms_state,omitempty"`
	SMSNumber  string          `json:"sms_number,omitempty"`
	SMSContent string          `json:"sms_content,omitempty"`
	Error      string          `json:"error,omitempty"`
	Sync       syncStatus      `json:"sync"`
}
type loginAttempt struct {
	client        *passportClient
	phone, code   string
	mfa           *accountMFA
	expires       time.Time
	requestCtx    context.Context
	cancelRequest context.CancelFunc
}
type accountManager struct {
	mu               sync.Mutex
	dir              string
	disk             accountDisk
	guest, store     *libraryStore
	details          *hongguoClient
	newClient        func(accountSession) *passportClient
	login            *loginAttempt
	phase, lastError string
	busy             bool
	codeAfter        time.Time
	smsState         string
	generation       uint64
	syncing          bool
	syncError        string
	lastSync         int64
	wake             chan struct{}
	cancelSync       context.CancelFunc
}

func atomicPrivateJSON(path string, value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".account-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	e := f.Close()
	if err == nil {
		err = e
	}
	if err == nil {
		err = os.Rename(f.Name(), path)
	}
	return err
}
func newAccountManager(dir string, guest *libraryStore, details *hongguoClient) (*accountManager, error) {
	m := &accountManager{dir: dir, guest: guest, store: guest, details: details, newClient: newPassportClient, phase: "phone", wake: make(chan struct{}, 1)}
	b, err := os.ReadFile(filepath.Join(dir, "account.json"))
	if err == nil {
		if json.Unmarshal(b, &m.disk) != nil || m.disk.Version != 1 {
			return nil, errors.New("账号文件无效")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if m.disk.Session.DeviceID == "" {
		m.disk = accountDisk{Version: 1, Session: accountSession{DeviceID: miniReelRandomID(), InstallID: miniReelRandomID(), Cookies: map[string]string{}}}
		if err := m.saveDisk(m.disk); err != nil {
			return nil, err
		}
	}
	if m.disk.Profile != nil {
		if !validID(m.disk.Profile.UID) {
			return nil, errors.New("账号身份无效")
		}
		m.store, err = m.accountLibrary(m.disk.Profile.UID)
		if err != nil {
			return nil, err
		}
		m.phase = "logged_in"
		m.lastSync = storeCloudLastSync(m.store)
	}
	if m.disk.Session.Device == nil {
		m.disk.Session.Device, err = newPassportDevice()
		if err != nil {
			return nil, err
		}
		if err = m.saveDisk(m.disk); err != nil {
			return nil, err
		}
	}
	return m, nil
}
func (m *accountManager) saveDisk(d accountDisk) error {
	if atomicPrivateJSON(filepath.Join(m.dir, "account.json"), d) != nil {
		return errors.New("账号信息保存失败")
	}
	return nil
}
func (m *accountManager) accountLibrary(uid string) (*libraryStore, error) {
	s, err := newLibraryStore(filepath.Join(m.dir, "accounts", uid))
	if err != nil {
		return nil, err
	}
	if s.data.OwnerID != "" && s.data.OwnerID != uid {
		return nil, errors.New("账号记录身份不匹配")
	}
	s.data.OwnerID = uid
	return s, nil
}
func (m *accountManager) librarySnapshot() LibraryData {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.store.snapshot()
}
func (m *accountManager) changeLibrary(c LibraryChange) (LibraryData, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	owner := m.store.data.OwnerID
	if c.OwnerID == nil || *c.OwnerID != owner {
		return LibraryData{}, errors.New("账号已切换，请重新打开页面")
	}
	d, err := m.store.apply(c)
	if err == nil && owner != "" {
		m.signalSync()
	}
	return d, err
}
func (m *accountManager) signalSync() {
	select {
	case m.wake <- struct{}{}:
	default:
	}
}
func (m *accountManager) status() accountStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked()
}
func (m *accountManager) statusLocked() accountStatus {
	s := accountStatus{LoggedIn: m.disk.Profile != nil, Phase: m.phase, Error: m.lastError, SMSState: m.smsState, Sync: syncStatus{State: "local"}}
	if m.disk.Profile != nil {
		p := *m.disk.Profile
		s.Profile = &p
		s.Sync = m.syncStatusLocked()
	}
	if m.login != nil {
		s.Phone = maskPhone(m.login.phone)
		if m.login.mfa != nil {
			s.SMSNumber = m.login.mfa.Number
			s.SMSContent = m.login.mfa.Content
		}
	}
	if left := time.Until(m.codeAfter); left > 0 {
		s.RetryAfter = int(math.Ceil(left.Seconds()))
	}
	return s
}
func maskPhone(phone string) string {
	if len(phone) == 11 {
		return phone[:3] + "****" + phone[7:]
	}
	return ""
}

func (m *accountManager) beginLogin(ctx context.Context, phone string, send bool) (*loginAttempt, uint64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.disk.Profile != nil {
		return nil, 0, errors.New("请先退出当前账号")
	}
	if m.busy {
		return nil, 0, errors.New("正在验证，请稍候")
	}
	if send {
		if time.Now().Before(m.codeAfter) {
			return nil, 0, errors.New("请等待倒计时结束后再发送")
		}
		m.generation++
		m.login = &loginAttempt{client: m.newClient(m.disk.Session), phone: phone, expires: time.Now().Add(10 * time.Minute)}
		m.smsState = "preparing"
	}
	if m.login == nil || m.login.phone != phone || time.Now().After(m.login.expires) {
		return nil, 0, errors.New("请重新获取验证码")
	}
	m.login.requestCtx, m.login.cancelRequest = context.WithCancel(ctx)
	m.busy = true
	m.lastError = ""
	return m.login, m.generation, nil
}
func (m *accountManager) endLogin(generation uint64, phase string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if generation != m.generation {
		return
	}
	m.busy = false
	if m.login != nil && m.login.cancelRequest != nil {
		m.login.cancelRequest()
	}
	if err != nil {
		m.lastError = err.Error()
	}
	m.phase = phase
}
func (m *accountManager) sendCode(ctx context.Context, phone string) error {
	a, g, err := m.beginLogin(ctx, phone, true)
	if err != nil {
		return err
	}
	// An unregistered/random identity is not valid for Passport. Save the
	// anonymous registered identity before any SMS request, also on rejection.
	defer a.cancelRequest()
	ctx = a.requestCtx
	if err = a.client.registerDevice(ctx); err != nil {
		m.mu.Lock()
		if g == m.generation {
			m.smsState = "rejected"
			m.codeAfter = time.Time{}
		}
		m.mu.Unlock()
		m.endLogin(g, "phone", err)
		return err
	}
	m.mu.Lock()
	if g != m.generation || ctx.Err() != nil {
		m.mu.Unlock()
		err = errors.New("登录已取消")
		m.endLogin(g, "phone", err)
		return err
	}
	disk := m.disk
	disk.Session = cloneAccountSession(a.client.session)
	err = m.saveDisk(disk)
	if err == nil {
		m.disk = disk
		// Retain a guard if the request times out after delivery is possible.
		m.codeAfter = time.Now().Add(time.Minute)
		m.smsState = "uncertain"
	} else {
		m.smsState = "rejected"
		m.codeAfter = time.Time{}
	}
	m.mu.Unlock()
	if err != nil {
		m.endLogin(g, "phone", err)
		return err
	}
	p, err := a.client.sendCode(ctx, phone)
	sent := err == nil && passportSuccess(p)
	retry := asInt(passportData(p)["retry_time"])
	if retry < 1 || retry > 3600 {
		retry = 0
	}
	state := "uncertain"
	if sent {
		state = "sent"
		if retry == 0 {
			retry = 60
		}
	}
	var he *passportHTTPError
	if errors.As(err, &he) {
		if he.RetryAfter > 0 {
			retry = he.RetryAfter
		}
		if he.Status == 429 {
			state = "limited"
			if retry == 0 {
				retry = 60
			}
		} else if he.Status >= 400 && he.Status < 500 && he.Status != 408 {
			state = "rejected"
		}
	} else if err == nil && passportErrorCode(p) != "" && passportErrorCode(p) != "0" {
		state = "rejected"
	}
	m.mu.Lock()
	if g == m.generation {
		m.smsState = state
		if retry > 0 {
			m.codeAfter = time.Now().Add(time.Duration(retry) * time.Second)
		} else if state == "rejected" {
			m.codeAfter = time.Time{}
		}
	}
	m.mu.Unlock()
	if err == nil && !passportSuccess(p) {
		err = passportFailure(p)
	}
	phase := "code"
	if err != nil {
		phase = "phone"
	}
	m.endLogin(g, phase, err)
	return err
}
func (m *accountManager) loginSMS(ctx context.Context, phone, code string) error {
	a, g, err := m.beginLogin(ctx, phone, false)
	if err != nil {
		return err
	}
	defer a.cancelRequest()
	ctx = a.requestCtx
	a.code = code
	p, err := a.client.smsLogin(ctx, phone, code, "")
	if err == nil {
		if passportSuccess(p) {
			err = m.finishLogin(ctx, g, a, p)
		} else if mfa := parseAccountMFA(passportData(p)); mfa != nil {
			m.mu.Lock()
			if g != m.generation {
				m.mu.Unlock()
				return errors.New("登录已取消")
			}
			a.mfa = mfa
			m.mu.Unlock()
			m.endLogin(g, "mfa", nil)
			return nil
		} else {
			err = passportFailure(p)
		}
	}
	phase := "code"
	if err == nil {
		phase = "logged_in"
	}
	m.endLogin(g, phase, err)
	return err
}
func (m *accountManager) verifyLogin(ctx context.Context) error {
	m.mu.Lock()
	if m.login == nil || m.login.mfa == nil || time.Now().After(m.login.expires) {
		m.mu.Unlock()
		return errors.New("验证已过期，请重新登录")
	}
	if m.busy {
		m.mu.Unlock()
		return errors.New("正在验证，请稍候")
	}
	a, g := m.login, m.generation
	m.busy = true
	m.mu.Unlock()
	p, err := a.client.verifyMFA(ctx, a.mfa)
	if err == nil && passportErrorCode(p) == "1045" {
		m.endLogin(g, "mfa", nil)
		return nil
	}
	if err == nil && !passportSuccess(p) {
		err = passportFailure(p)
	}
	if err == nil {
		if !m.loginCurrent(ctx, g) {
			return errors.New("登录已取消")
		}
		ticket := asString(passportData(p)["ticket"])
		if ticket == "" {
			ticket = asString(passportData(p)["verify_ticket"])
		}
		if ticket == "" {
			err = errors.New("验证响应缺少登录票据")
		} else {
			p, err = a.client.smsLogin(ctx, a.phone, a.code, ticket)
			if err == nil && !passportSuccess(p) {
				err = passportFailure(p)
			}
			if err == nil {
				err = m.finishLogin(ctx, g, a, p)
			}
		}
	}
	phase := "mfa"
	if err == nil && m.status().LoggedIn {
		phase = "logged_in"
	}
	m.endLogin(g, phase, err)
	return err
}
func (m *accountManager) loginCurrent(ctx context.Context, g uint64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return g == m.generation && ctx.Err() == nil && m.disk.Profile == nil
}
func (m *accountManager) finishLogin(ctx context.Context, g uint64, a *loginAttempt, p map[string]any) error {
	if !m.loginCurrent(ctx, g) {
		return errors.New("登录已取消")
	}
	d := passportData(p)
	uid := asString(d["user_id_str"])
	if uid == "" {
		uid = asString(d["user_id"])
	}
	if !validID(uid) {
		return errors.New("登录响应缺少有效账号身份")
	}
	if a.client.session.Token == "" && a.client.session.Cookies["sessionid"] == "" && a.client.session.Cookies["sessionid_ss"] == "" {
		return errors.New("登录响应缺少会话凭证")
	}
	info, err := a.client.cloudJSON(ctx, "/reading/user/info/v1/", http.MethodGet, urlValues("user_id", uid), nil)
	if err != nil {
		return err
	}
	if err := validateAccountIdentity(info, uid); err != nil {
		return err
	}
	profile := &accountProfile{UID: uid, Name: asString(d["screen_name"]), Avatar: asString(d["avatar_url"]), Phone: maskPhone(a.phone)}
	if profile.Name == "" {
		profile.Name = asString(d["name"])
	}
	if profile.Name == "" {
		profile.Name = "红果用户"
	}
	store, err := m.accountLibrary(uid)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if g != m.generation || ctx.Err() != nil {
		return errors.New("登录已取消")
	}
	disk := accountDisk{Version: 1, Session: a.client.session, Profile: profile}
	if err = m.saveDisk(disk); err != nil {
		return err
	}
	m.disk = disk
	m.store = store
	m.login = nil
	m.phase = "logged_in"
	m.syncError = ""
	m.lastSync = storeCloudLastSync(store)
	m.signalSync()
	return nil
}
func validateAccountIdentity(info map[string]any, uid string) error {
	details := passportData(info)
	if u, ok := asMap(details["user_info"]); ok {
		details = u
	}
	got := asString(details["user_id_str"])
	if got == "" {
		got = asString(details["user_id"])
	}
	if got != "" && got != uid {
		return errors.New("账号会话已失效或身份不一致，请退出后重新登录")
	}
	if len(details) == 0 {
		return errors.New("账号身份响应无效，请重新登录")
	}
	return nil
}
func urlValues(k, v string) url.Values { return url.Values{k: {v}} }

func (m *accountManager) logout() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	disk := accountDisk{Version: 1, Session: accountSession{DeviceID: m.disk.Session.DeviceID, InstallID: m.disk.Session.InstallID, Device: m.disk.Session.Device, Registered: m.disk.Session.Registered, Cookies: map[string]string{}}}
	if err := m.saveDisk(disk); err != nil {
		return err
	}
	m.generation++
	if m.cancelSync != nil {
		m.cancelSync()
	}
	if m.login != nil && m.login.cancelRequest != nil {
		m.login.cancelRequest()
	}
	m.disk = disk
	m.store = m.guest
	m.login = nil
	m.busy = false
	m.phase = "phone"
	m.lastError = ""
	m.syncing = false
	m.syncError = ""
	m.lastSync = 0
	return nil
}
func (m *accountManager) cancelLogin() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.disk.Profile != nil {
		return
	}
	m.generation++
	if m.login != nil && m.login.cancelRequest != nil {
		m.login.cancelRequest()
	}
	m.login = nil
	m.busy = false
	m.phase = "phone"
	m.lastError = ""
}

func (s *server) account(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.accounts == nil {
		writeError(w, 503, "账号功能尚未就绪")
		return
	}
	if r.URL.Path == "/api/v1/account" && r.Method == http.MethodGet {
		writeJSON(w, 200, map[string]any{"ok": true, "data": s.accounts.status()})
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, 405, "method not allowed")
		return
	}
	var input struct {
		Phone string `json:"phone"`
		Code  string `json:"code"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || d.Decode(&struct{}{}) != io.EOF {
		writeError(w, 400, "账号请求无效")
		return
	}
	var err error
	switch r.URL.Path {
	case "/api/v1/account/send-code":
		if !accountPhoneRE.MatchString(input.Phone) {
			err = errors.New("请输入正确的手机号")
		} else {
			err = s.accounts.sendCode(r.Context(), input.Phone)
		}
	case "/api/v1/account/login":
		if !accountPhoneRE.MatchString(input.Phone) || !accountCodeRE.MatchString(input.Code) {
			err = errors.New("请输入手机号和验证码")
		} else {
			err = s.accounts.loginSMS(r.Context(), input.Phone, input.Code)
		}
	case "/api/v1/account/verify":
		err = s.accounts.verifyLogin(r.Context())
	case "/api/v1/account/cancel":
		s.accounts.cancelLogin()
	case "/api/v1/account/logout":
		err = s.accounts.logout()
	case "/api/v1/account/sync":
		if !s.accounts.status().LoggedIn {
			err = errors.New("请先登录")
		} else {
			s.accounts.signalSync()
		}
	default:
		writeError(w, 404, "not found")
		return
	}
	if err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error(), "data": s.accounts.status()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "data": s.accounts.status()})
}

// Keep all wire identifiers strings in HTTP/UI. Only the official cloud
// request body needs its documented numeric IDs, encoded without float64.
func cloudNumericID(id string) json.Number { return json.Number(id) }
func cloudMillis(n float64) int64          { return int64(n * 1000) }
func accountEpoch(value any) int64         { v, _ := strconv.ParseInt(asString(value), 10, 64); return v }
