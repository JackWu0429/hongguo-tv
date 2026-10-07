package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const passportAPI = "https://api5-normal-lq.fqnovel.com"

type accountSession struct {
	DeviceID   string            `json:"device_id"`
	InstallID  string            `json:"install_id"`
	Cookies    map[string]string `json:"cookies"`
	Token      string            `json:"token,omitempty"`
	Device     *passportDevice   `json:"device,omitempty"`
	Registered bool              `json:"registered,omitempty"`
}

type passportClient struct {
	uid        string
	http       *http.Client
	base       string
	deviceBase string
	session    accountSession
}

func cloneAccountSession(session accountSession) accountSession {
	copy := session
	copy.Cookies = map[string]string{}
	for k, v := range session.Cookies {
		copy.Cookies[k] = v
	}
	if session.Device != nil {
		d := *session.Device
		copy.Device = &d
	}
	return copy
}

func newPassportClient(session accountSession) *passportClient {
	copy := cloneAccountSession(session)
	if copy.Registered {
		copy.Cookies["install_id"] = copy.InstallID
	}
	return &passportClient{http: &http.Client{Timeout: 25 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}, base: passportAPI, deviceBase: passportDeviceAPI, session: copy}
}

func passportQuery(s accountSession) url.Values {
	q := url.Values{"ac": {"wifi"}, "aid": {"8662"}, "app_name": {"novelread"}, "channel": {"update_64"}, "device_brand": {"Redmi"}, "device_id": {s.DeviceID}, "device_platform": {"android"}, "device_type": {"25053RT47C"}, "dpi": {"520"}, "iid": {s.InstallID}, "language": {"zh"}, "manifest_version_code": {"73532"}, "os": {"android"}, "os_api": {"36"}, "os_version": {"16"}, "resolution": {"1280*2772"}, "ssmix": {"a"}, "update_version_code": {"73532"}, "version_code": {"73532"}, "version_name": {"7.3.5.32"}}
	if s.Device != nil {
		q.Set("cdid", s.Device.CDID)
		q.Set("openudid", s.Device.OpenUDID)
	}
	return q
}

func (c *passportClient) request(ctx context.Context, path, method string, params url.Values, body []byte, contentType string) (map[string]any, error) {
	q := passportQuery(c.session)
	for k, vs := range params {
		q[k] = append([]string(nil), vs...)
	}
	raw, h, err := signPassportRequest(q, body, time.Now().UnixMilli(), c.session.DeviceID)
	if err != nil {
		return nil, err
	}
	r, err := http.NewRequestWithContext(ctx, method, c.base+path+"?"+raw, bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("账号请求地址无效")
	}
	r.Header = h
	r.Header.Set("User-Agent", defaultHongguoUA)
	r.Header.Set("Accept", "application/json")
	r.Header.Set("X-XS-From-Web", "0")
	r.Header.Set("Sdk-Version", "2")
	r.Header.Set("Passport-Sdk-Version", "6031190")
	r.Header.Set("X-SS-DP", "8662")
	r.Header.Set("X-Tt-Store-Region", "cn")
	r.Header.Set("X-Tt-Store-Region-Src", "did")
	if strings.HasPrefix(path, "/passport/") {
		r.Header.Set("Passport-Sdk-Version", "5051452")
		r.Header.Set("X-Vc-Bdturing-Sdk-Version", "4.0.3.cn")
		r.Header.Set("Lc", "101")
	}
	if region := c.session.Cookies["store-region"]; region != "" {
		r.Header.Set("X-Tt-Store-Region", region)
	}
	if strings.HasPrefix(path, "/novel/commentapi/reply/list/") {
		r.Header.Set("comment-source", "504")
		r.Header.Set("server-channel", "18")
	}
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	if c.session.Token != "" {
		r.Header.Set("X-Tt-Token", c.session.Token)
	}
	for k, v := range c.session.Cookies {
		r.AddCookie(&http.Cookie{Name: k, Value: v})
	}
	resp, err := c.http.Do(r)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errors.New("红果账号服务连接失败，请稍后重试")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, newPassportHTTPError(resp)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20+1))
	if err != nil || len(b) > 4<<20 {
		return nil, errors.New("红果账号响应读取失败")
	}
	var payload map[string]any
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	if d.Decode(&payload) != nil || payload == nil {
		return nil, errors.New("红果账号响应不是有效 JSON")
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return nil, errors.New("红果账号响应含多余内容")
	}
	for _, cookie := range resp.Cookies() {
		if cookie.MaxAge < 0 {
			delete(c.session.Cookies, cookie.Name)
		} else {
			c.session.Cookies[cookie.Name] = cookie.Value
		}
	}
	if token := resp.Header.Get("X-Tt-Token"); token != "" {
		c.session.Token = token
	}
	return payload, nil
}

func passportXOR(s string) string {
	b := []byte(s)
	for i := range b {
		b[i] ^= 5
	}
	return hex.EncodeToString(b)
}

var accountPhoneRE = regexp.MustCompile(`^1[3-9][0-9]{9}$`)
var accountCodeRE = regexp.MustCompile(`^[0-9]{4,8}$`)
var accountPrivateDigitsRE = regexp.MustCompile(`[0-9]{7,}`)

func passportForm(phone string) url.Values {
	return url.Values{"mobile": {passportXOR("+86" + phone)}, "account_sdk_source": {"app"}, "passport_support_flow": {"captcha,verify"}, "mix_mode": {"1"}}
}

func (c *passportClient) sendCode(ctx context.Context, phone string) (map[string]any, error) {
	f := passportForm(phone)
	f.Set("auto_read", "0")
	f.Set("unbind_exist", "34")
	f.Set("type", passportXOR("24"))
	return c.request(ctx, "/passport/mobile/send_code/v1/", http.MethodPost, nil, []byte(f.Encode()), "application/x-www-form-urlencoded; charset=UTF-8")
}

func (c *passportClient) smsLogin(ctx context.Context, phone, code, ticket string) (map[string]any, error) {
	f := passportForm(phone)
	f.Set("code", passportXOR(code))
	if ticket != "" {
		f.Set("passport_mfa_retry_tag", "1")
		f.Set("sms_code_key", passportXOR(ticket))
	}
	return c.request(ctx, "/passport/mobile/sms_login/", http.MethodPost, nil, []byte(f.Encode()), "application/x-www-form-urlencoded; charset=UTF-8")
}

type accountMFA struct {
	EncryptUID string
	CodeKey    string
	LogID      string
	Scene      string
	Number     string
	Content    string
}

func parseAccountMFA(data map[string]any) *accountMFA {
	if data == nil {
		return nil
	}
	m := &accountMFA{EncryptUID: asString(data["encrypt_uid"]), CodeKey: asString(data["sms_code_key"]), Scene: asString(data["passport_scene"])}
	if event, ok := asMap(data["event_params"]); ok {
		m.LogID = asString(event["log_id"])
	}
	ways, _ := data["verify_ways"].([]any)
	for _, value := range ways {
		way, ok := asMap(value)
		if !ok {
			continue
		}
		if asString(way["verify_way"]) == "upsms" || asString(way["sms_content"]) != "" {
			m.Content = asString(way["sms_content"])
			m.Number = asString(way["channel_mobile"])
			break
		}
	}
	if m.EncryptUID == "" || m.CodeKey == "" || m.Number == "" || m.Content == "" {
		return nil
	}
	return m
}

func (c *passportClient) verifyMFA(ctx context.Context, m *accountMFA) (map[string]any, error) {
	biz, _ := json.Marshal(map[string]string{"passport_mfa_retry_tag": "1", "sms_code_key": m.CodeKey})
	f := url.Values{"encrypt_uid": {m.EncryptUID}, "verify_ticket": {""}, "verify_scene": {"sms_login"}, "verify_reason": {"atom"}, "copywriting_key": {"sms_login"}, "ies_safety_diversion_tag": {"mfa"}, "new_verify_flow": {"1"}, "new_authn_sdk_version": {"1.1.3"}, "new_authn_sdk_verify_reason": {"atom"}, "new_authn_sdk_verify_scene": {"sms_login"}, "request_tag_from": {"h5"}, "biz_params": {string(biz)}, "new_authn_sdk_log_id": {m.LogID}}
	return c.request(ctx, "/passport/upsms/verify/", http.MethodPost, nil, []byte(f.Encode()), "application/x-www-form-urlencoded; charset=UTF-8")
}

func passportData(p map[string]any) map[string]any { d, _ := asMap(p["data"]); return d }
func passportErrorCode(p map[string]any) string {
	d := passportData(p)
	if x, ok := d["error_code"]; ok {
		return asString(x)
	}
	if x, ok := p["error_code"]; ok {
		return asString(x)
	}
	return ""
}
func passportSuccess(p map[string]any) bool {
	code := passportErrorCode(p)
	if code != "" && code != "0" {
		return false
	}
	return asString(p["message"]) == "success" && passportData(p) != nil
}
func passportFailure(p map[string]any) error {
	code := passportErrorCode(p)
	if code == "" {
		code = "未知"
	}
	d := passportData(p)
	msg := asString(d["description"])
	if msg == "" {
		msg = asString(p["description"])
	}
	// Never echo a remote object, URL, ticket, or credentials into logs/UI.
	if strings.ContainsAny(msg, "\r\n") || strings.Contains(msg, "http") || len([]rune(msg)) > 120 {
		msg = ""
	}
	if msg == "" {
		msg = "验证失败，请检查验证码或稍后重试"
	}
	msg = accountPrivateDigitsRE.ReplaceAllString(msg, "***")
	return fmt.Errorf("%s（%s）", msg, code)
}

func (c *passportClient) cloudJSON(ctx context.Context, path, method string, q url.Values, value any) (map[string]any, error) {
	var body []byte
	var err error
	typ := ""
	if value != nil {
		body, err = json.Marshal(value)
		if err != nil {
			return nil, err
		}
		typ = "application/json; charset=utf-8"
	}
	p, err := c.request(ctx, path, method, q, body, typ)
	if err != nil {
		return nil, err
	}
	code, exists := p["code"]
	if !exists || asString(code) != "0" {
		return nil, fmt.Errorf("云端未确认请求成功（%s）", asString(code))
	}
	if code := passportErrorCode(p); code != "" && code != "0" {
		return nil, errors.New("云端未确认请求成功，请重新登录或稍后重试")
	}
	if _, ok := p["data"]; !ok && p["video_data"] == nil && method == http.MethodGet {
		return nil, errors.New("云端响应缺少 data")
	}
	return p, nil
}

func accountSeconds(v any) float64 { x, _ := strconv.ParseFloat(asString(v), 64); return x }
