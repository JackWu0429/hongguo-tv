package main

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

const desktopManifestURL = "https://raw.githubusercontent.com/aston314/hongguo-tv-releases/main/desktop-update-v2.json"
const desktopProxy = "https://ghfast.top/"
const desktopPublicBase = "https://github.com/aston314/hongguo-tv-releases/releases/download/"

// CI stamps a desktop-only channel. Android version codes and APK channels are unrelated.
var desktopVersion = "0.2.63"
var desktopVersionCode = "5"

type desktopPackage struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	URL    string `json:"download_url"`
}
type desktopManifest struct {
	Schema   int                       `json:"schema"`
	Product  string                    `json:"product"`
	Version  string                    `json:"version_name"`
	Code     int                       `json:"version_code"`
	Notes    string                    `json:"release_notes"`
	Packages map[string]desktopPackage `json:"packages"`
}
type updateStatus struct {
	Supported      bool   `json:"supported"`
	Desktop        bool   `json:"desktop"`
	State          string `json:"state"`
	CurrentVersion string `json:"current_version"`
	LatestVersion  string `json:"latest_version,omitempty"`
	LatestCode     int    `json:"latest_code,omitempty"`
	Notes          string `json:"release_notes,omitempty"`
	Message        string `json:"message"`
	Downloaded     int64  `json:"downloaded"`
	Total          int64  `json:"total"`
	File           string `json:"file,omitempty"`
}
type desktopUpdater struct {
	mu          sync.Mutex
	status      updateStatus
	target      *desktopManifest
	client      *http.Client
	currentCode int
	platform    string
	downloads   string
	stateFile   string
	busy        bool
	ctx         context.Context
	cancel      context.CancelFunc
}

func newDesktopUpdater(code int, dataDir, downloads, platform string) *desktopUpdater {
	ctx, cancel := context.WithCancel(context.Background())
	return &desktopUpdater{currentCode: code, platform: platform, downloads: downloads, stateFile: filepath.Join(dataDir, "desktop-update-v2-check.json"), ctx: ctx, cancel: cancel,
		client: &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, DialContext: (&net.Dialer{Timeout: 20 * time.Second}).DialContext, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 30 * time.Second}, CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 8 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "https" {
				return errors.New("HTTPS required")
			}
			return nil
		}}, status: updateStatus{Supported: true, Desktop: true, State: "idle", CurrentVersion: desktopVersion, Message: "每天自动检查一次；播放时不打扰。下载后请自行解压替换。"}}
}
func desktopPlatform() string {
	if runtime.GOOS == "darwin" {
		return "macos-universal"
	}
	return "windows-amd64"
}
func (u *desktopUpdater) snapshot() updateStatus { u.mu.Lock(); defer u.mu.Unlock(); return u.status }
func (u *desktopUpdater) close()                 { u.cancel() }
func (u *desktopUpdater) automatic() {
	var saved struct {
		LastCheck int64            `json:"last_check"`
		Manifest  *desktopManifest `json:"manifest"`
	}
	if b, err := os.ReadFile(u.stateFile); err == nil {
		_ = json.Unmarshal(b, &saved)
	}
	elapsed := time.Now().Unix() - saved.LastCheck
	if saved.LastCheck > 0 && elapsed >= 0 && elapsed < 86400 && saved.Manifest != nil && validateDesktopManifest(*saved.Manifest) == nil {
		u.applyManifest(*saved.Manifest)
		return
	}
	u.check()
}
func (u *desktopUpdater) check() {
	u.mu.Lock()
	if u.busy {
		u.mu.Unlock()
		return
	}
	u.busy = true
	u.status.State = "checking"
	u.status.Message = "正在检查新版本…"
	u.mu.Unlock()
	go func() {
		defer func() { u.mu.Lock(); u.busy = false; u.mu.Unlock() }()
		ctx, cancel := context.WithTimeout(u.ctx, 90*time.Second)
		defer cancel()
		var manifest desktopManifest
		err := u.withResponse(ctx, desktopManifestURL, func(r *http.Response) error {
			b, err := io.ReadAll(io.LimitReader(r.Body, 1024*1024+1))
			if err != nil {
				return err
			}
			if len(b) > 1024*1024 {
				return errors.New("manifest too large")
			}
			if err = json.Unmarshal(b, &manifest); err != nil {
				return err
			}
			return validateDesktopManifest(manifest)
		})
		if err != nil {
			u.fail("检查更新失败，请稍后重试。", false)
			return
		}
		u.applyManifest(manifest)
		// Only successful checks consume the daily automatic check. Manual retries remain available.
		b, _ := json.Marshal(map[string]interface{}{"last_check": time.Now().Unix(), "manifest": manifest})
		_ = os.MkdirAll(filepath.Dir(u.stateFile), 0700)
		_ = os.WriteFile(u.stateFile, b, 0600)
	}()
}
func (u *desktopUpdater) applyManifest(manifest desktopManifest) {
	p := manifest.Packages[u.platform]
	final := filepath.Join(u.downloads, p.Name)
	// A cached ready state still verifies the actual file, not just its filename.
	ready := manifest.Code > u.currentCode && verifyDownloaded(final, p, u.platform) == nil
	u.mu.Lock()
	defer u.mu.Unlock()
	u.target = &manifest
	u.status.LatestVersion = manifest.Version
	u.status.LatestCode = manifest.Code
	u.status.Notes = manifest.Notes
	u.status.File = ""
	u.status.Downloaded = 0
	u.status.Total = p.Size
	if manifest.Code <= u.currentCode {
		u.status.State = "latest"
		u.status.Message = "当前已是最新桌面版本。"
	} else if ready {
		u.status.State = "ready"
		u.status.File = final
		u.status.Downloaded = p.Size
		u.status.Message = "更新 ZIP 已下载并校验，可打开文件夹手动安装。"
	} else {
		u.status.State = "available"
		u.status.Message = "发现新版本 " + manifest.Version + "，可下载更新 ZIP。"
	}
}

func validateDesktopManifest(m desktopManifest) error {
	if m.Schema != 1 || m.Product != "hongguo-desktop" || m.Code < 1 || !regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`).MatchString(m.Version) || len(m.Notes) > 16000 || len(m.Packages) != 2 {
		return errors.New("invalid desktop manifest")
	}
	for platform, suffix := range map[string]string{"macos-universal": "macos-universal", "windows-amd64": "windows-x64"} {
		p, ok := m.Packages[platform]
		name := "hongguo-desktop-" + m.Version + "-" + suffix + ".zip"
		if !ok || p.Name != name || p.Size < 1 || p.Size > 300*1024*1024 || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(p.SHA256) || p.URL != desktopPublicBase+"desktop-v"+m.Version+"/"+name {
			return errors.New("invalid desktop package")
		}
	}
	return nil
}
func (u *desktopUpdater) withResponse(ctx context.Context, url string, read func(*http.Response) error) error {
	var last error
	for _, address := range []string{desktopProxy + url, url} {
		limit := 7 * time.Minute
		if url == desktopManifestURL {
			limit = 35 * time.Second
		}
		attempt, cancel := context.WithTimeout(ctx, limit)
		req, err := http.NewRequestWithContext(attempt, "GET", address, nil)
		if err != nil {
			cancel()
			return err
		}
		req.Header.Set("User-Agent", "HongguoDesktop/"+desktopVersion)
		req.Header.Set("Accept-Encoding", "identity")
		resp, err := u.client.Do(req)
		if err == nil {
			if resp.StatusCode != http.StatusOK {
				err = fmt.Errorf("HTTP %d", resp.StatusCode)
			} else {
				err = read(resp)
			}
			resp.Body.Close()
		}
		cancel()
		if err == nil {
			return nil
		}
		last = err
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return last
}
func (u *desktopUpdater) fail(message string, keepTarget bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.status.State = "error"
	u.status.Message = message
	u.status.Downloaded = 0
	if !keepTarget {
		u.target = nil
		u.status.LatestCode = 0
		u.status.LatestVersion = ""
		u.status.Notes = ""
	}
}
func (u *desktopUpdater) download() {
	u.mu.Lock()
	if u.busy || u.target == nil || u.target.Code <= u.currentCode {
		u.mu.Unlock()
		return
	}
	m := *u.target
	p := m.Packages[u.platform]
	u.busy = true
	u.status.State = "downloading"
	u.status.File = ""
	u.status.Downloaded = 0
	u.status.Total = p.Size
	u.status.Message = "正在下载更新 ZIP…"
	u.mu.Unlock()
	go func() {
		defer func() { u.mu.Lock(); u.busy = false; u.mu.Unlock() }()
		ctx, cancel := context.WithTimeout(u.ctx, 15*time.Minute)
		defer cancel()
		file, err := u.downloadPackage(ctx, p)
		if err != nil {
			if u.ctx.Err() == nil {
				u.fail("下载或校验失败，请重试。现有程序和数据不受影响。", true)
			}
			return
		}
		u.mu.Lock()
		u.status.State = "ready"
		u.status.File = file
		u.status.Downloaded = p.Size
		u.status.Message = "ZIP 已下载并通过校验。请退出应用后自行解压替换，账号和记录会保留。"
		u.mu.Unlock()
	}()
}
func verifyDownloaded(path string, p desktopPackage, platform string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() || st.Size() != p.Size {
		return errors.New("size differs")
	}
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return err
	}
	if hex.EncodeToString(h.Sum(nil)) != p.SHA256 {
		return errors.New("SHA256 differs")
	}
	return verifyDesktopZIP(path, platform)
}
func verifyDesktopZIP(path, platform string) error {
	z, err := zip.OpenReader(path)
	if err != nil {
		return err
	}
	defer z.Close()
	required := map[string]string{"红果短剧.exe": "MZ", "hongguo-tv-core.exe": "MZ"}
	if platform == "macos-universal" {
		required = map[string]string{"红果短剧.app/Contents/MacOS/红果短剧": "\xca\xfe\xba\xbe", "红果短剧.app/Contents/MacOS/hongguo-tv-core": "\xca\xfe\xba\xbe", "红果短剧.app/Contents/Info.plist": ""}
	}
	seen := map[string]bool{}
	var total uint64
	for _, entry := range z.File {
		name := entry.Name
		if strings.HasPrefix(name, "/") || strings.Contains(name, "\\") || strings.Contains(name, ":") || seen[name] || entry.Mode()&os.ModeSymlink != 0 {
			return errors.New("unsafe ZIP entry")
		}
		for _, part := range strings.Split(name, "/") {
			if part == ".." {
				return errors.New("unsafe ZIP path")
			}
		}
		seen[name] = true
		total += entry.UncompressedSize64
		if total > 1024*1024*1024 {
			return errors.New("ZIP too large")
		}
		if entry.FileInfo().IsDir() {
			continue
		}
		reader, err := entry.Open()
		if err != nil {
			return err
		}
		if magic, ok := required[name]; ok {
			b := make([]byte, len(magic))
			_, err = io.ReadFull(reader, b)
			if err == nil && string(b) != magic {
				err = errors.New("wrong platform binary")
			}
		}
		if err == nil {
			_, err = io.Copy(io.Discard, reader)
		}
		reader.Close()
		if err != nil {
			return err
		}
	}
	for name := range required {
		if !seen[name] {
			return errors.New("incomplete ZIP")
		}
	}
	return nil
}
func (u *desktopUpdater) downloadPackage(ctx context.Context, p desktopPackage) (string, error) {
	if err := os.MkdirAll(u.downloads, 0755); err != nil {
		return "", err
	}
	final := filepath.Join(u.downloads, p.Name)
	if st, err := os.Lstat(final); err == nil {
		if !st.Mode().IsRegular() {
			return "", errors.New("existing file is not regular")
		}
		if err = verifyDownloaded(final, p, u.platform); err != nil {
			return "", err
		}
		return final, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}
	var temp string
	defer func() {
		if temp != "" {
			_ = os.Remove(temp)
		}
	}()
	err := u.withResponse(ctx, p.URL, func(resp *http.Response) error {
		if temp != "" {
			_ = os.Remove(temp)
		}
		f, err := os.CreateTemp(u.downloads, ".hongguo-update-*.part")
		if err != nil {
			return err
		}
		temp = f.Name()
		if resp.ContentLength >= 0 && resp.ContentLength != p.Size {
			f.Close()
			return errors.New("content length differs")
		}
		u.mu.Lock()
		u.status.Downloaded = 0
		u.mu.Unlock()
		buf := make([]byte, 64*1024)
		var count int64
		last := time.Now()
		limited := io.LimitReader(resp.Body, p.Size+1)
		for {
			n, readErr := limited.Read(buf)
			if n > 0 {
				written, writeErr := f.Write(buf[:n])
				count += int64(written)
				if writeErr != nil {
					f.Close()
					return writeErr
				}
				if count > p.Size {
					f.Close()
					return errors.New("oversize download")
				}
				if time.Since(last) > 200*time.Millisecond {
					u.mu.Lock()
					u.status.Downloaded = count
					u.mu.Unlock()
					last = time.Now()
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				f.Close()
				return readErr
			}
		}
		if err = f.Sync(); err != nil {
			f.Close()
			return err
		}
		if err = f.Close(); err != nil {
			return err
		}
		return verifyDownloaded(temp, p, u.platform)
	})
	if err != nil {
		return "", err
	}
	// Publish with an exclusive destination, never overwrite a user's existing file.
	if err = os.Link(temp, final); err != nil {
		return "", err
	}
	_ = os.Chmod(final, 0644)
	return final, nil
}
