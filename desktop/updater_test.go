package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type updateTransport func(*http.Request) (*http.Response, error)

func (f updateTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(r *http.Request, status int, data []byte) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader(data)), Header: make(http.Header), ContentLength: int64(len(data)), Request: r}
}
func updateFixture(t *testing.T, platform string) (desktopManifest, []byte) {
	t.Helper()
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	files := map[string]string{"红果短剧.exe": "MZshell", "hongguo-tv-core.exe": "MZcore", "README.txt": "test"}
	if platform == "macos-universal" {
		files = map[string]string{"红果短剧.app/Contents/MacOS/红果短剧": "\xca\xfe\xba\xbeShell", "红果短剧.app/Contents/MacOS/hongguo-tv-core": "\xca\xfe\xba\xbeCore", "红果短剧.app/Contents/Info.plist": "plist"}
	}
	for n, v := range files {
		f, err := z.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		f.Write([]byte(v))
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(b.Bytes())
	m := desktopManifest{Schema: 1, Product: "hongguo-desktop", Version: "0.2.60", Code: 2, Notes: "新版", Packages: map[string]desktopPackage{}}
	for p, suffix := range map[string]string{"macos-universal": "macos-universal", "windows-amd64": "windows-x64"} {
		name := "hongguo-desktop-0.2.60-" + suffix + ".zip"
		m.Packages[p] = desktopPackage{Name: name, Size: int64(b.Len()), SHA256: hex.EncodeToString(sum[:]), URL: desktopPublicBase + "desktop-v0.2.60/" + name}
	}
	return m, b.Bytes()
}
func waitUpdater(t *testing.T, u *desktopUpdater) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		u.mu.Lock()
		busy := u.busy
		u.mu.Unlock()
		if !busy {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("updater did not finish")
}
func TestDesktopManifestRejectsForeignAndCrossPlatformDownloads(t *testing.T) {
	m, _ := updateFixture(t, "windows-amd64")
	if err := validateDesktopManifest(m); err != nil {
		t.Fatal(err)
	}
	bad := m
	bad.Packages = map[string]desktopPackage{}
	for k, v := range m.Packages {
		bad.Packages[k] = v
	}
	p := bad.Packages["windows-amd64"]
	p.URL = "https://evil.test/a.zip"
	bad.Packages["windows-amd64"] = p
	if validateDesktopManifest(bad) == nil {
		t.Fatal("foreign URL accepted")
	}
	bad = m
	bad.Product = "android"
	if validateDesktopManifest(bad) == nil {
		t.Fatal("Android channel accepted")
	}
}
func TestDesktopCheckProxyFallbackVersionCodeAndDailyLimit(t *testing.T) {
	m, _ := updateFixture(t, "windows-amd64")
	b, _ := json.Marshal(m)
	u := newDesktopUpdater(1, t.TempDir(), t.TempDir(), "windows-amd64")
	defer u.close()
	var mu sync.Mutex
	var calls []string
	u.client.Transport = updateTransport(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		calls = append(calls, r.URL.String())
		mu.Unlock()
		if r.URL.Host == "ghfast.top" {
			return response(r, 502, []byte("proxy")), nil
		}
		return response(r, 200, b), nil
	})
	u.check()
	u.check()
	waitUpdater(t, u)
	if u.snapshot().State != "available" {
		t.Fatal(u.snapshot())
	}
	mu.Lock()
	if len(calls) != 2 || !strings.HasPrefix(calls[0], desktopProxy) || calls[1] != desktopManifestURL {
		t.Fatal(calls)
	}
	mu.Unlock()
	u.automatic()
	waitUpdater(t, u)
	mu.Lock()
	count := len(calls)
	mu.Unlock()
	if count != 2 {
		t.Fatal("daily check repeated")
	}
	u.currentCode = 2
	u.check()
	waitUpdater(t, u)
	if u.snapshot().State != "latest" {
		t.Fatal("equal code should not update")
	}
}
func TestDesktopDownloadChecksumFallbackPartialCleanupAndSafeReuse(t *testing.T) {
	for _, platform := range []string{"windows-amd64", "macos-universal"} {
		t.Run(platform, func(t *testing.T) {
			m, b := updateFixture(t, platform)
			u := newDesktopUpdater(1, t.TempDir(), t.TempDir(), platform)
			defer u.close()
			u.target = &m
			var calls []string
			var mu sync.Mutex
			u.client.Transport = updateTransport(func(r *http.Request) (*http.Response, error) {
				mu.Lock()
				calls = append(calls, r.URL.String())
				mu.Unlock()
				data := b
				if r.URL.Host == "ghfast.top" {
					data = bytes.Repeat([]byte("x"), len(b))
				}
				return response(r, 200, data), nil
			})
			u.download()
			u.download()
			waitUpdater(t, u)
			s := u.snapshot()
			if s.State != "ready" {
				t.Fatal(s)
			}
			got, _ := os.ReadFile(s.File)
			if !bytes.Equal(got, b) {
				t.Fatal("wrong completed bytes")
			}
			partial, _ := filepath.Glob(filepath.Join(u.downloads, "*.part"))
			if len(partial) != 0 {
				t.Fatal("partial retained")
			}
			u.download()
			waitUpdater(t, u)
			mu.Lock()
			n := len(calls)
			mu.Unlock()
			if n != 2 {
				t.Fatal("verified ZIP downloaded again")
			}
			if err := os.WriteFile(s.File, []byte("my existing ZIP"), 0600); err != nil {
				t.Fatal(err)
			}
			u.download()
			waitUpdater(t, u)
			if u.snapshot().State != "error" {
				t.Fatal("corrupt existing file accepted")
			}
			got, _ = os.ReadFile(s.File)
			if string(got) != "my existing ZIP" {
				t.Fatal("user file overwritten")
			}
		})
	}
}
func TestDesktopDownloadFailureNeverPublishesBadZIP(t *testing.T) {
	m, b := updateFixture(t, "windows-amd64")
	u := newDesktopUpdater(1, t.TempDir(), t.TempDir(), "windows-amd64")
	defer u.close()
	u.target = &m
	u.client.Transport = updateTransport(func(r *http.Request) (*http.Response, error) { return response(r, 200, b[:len(b)-1]), nil })
	u.download()
	waitUpdater(t, u)
	if u.snapshot().State != "error" || u.snapshot().File != "" {
		t.Fatal(u.snapshot())
	}
	entries, _ := os.ReadDir(u.downloads)
	if len(entries) != 0 {
		t.Fatal("failed update left a file")
	}
}
func TestDesktopZIPRejectsWrongPlatformAndTraversal(t *testing.T) {
	_, b := updateFixture(t, "windows-amd64")
	root := t.TempDir()
	path := filepath.Join(root, "test.zip")
	os.WriteFile(path, b, 0600)
	if verifyDesktopZIP(path, "macos-universal") == nil {
		t.Fatal("wrong platform accepted")
	}
	var unsafe bytes.Buffer
	z := zip.NewWriter(&unsafe)
	f, _ := z.Create("../outside")
	f.Write([]byte("x"))
	z.Close()
	os.WriteFile(path, unsafe.Bytes(), 0600)
	if verifyDesktopZIP(path, "windows-amd64") == nil {
		t.Fatal("traversal accepted")
	}
}
func TestDesktopZIPRejectsLegacyEnglishApplicationPath(t *testing.T) {
	for _, platform := range []string{"macos-universal", "windows-amd64"} {
		_, data := updateFixture(t, platform)
		reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			t.Fatal(err)
		}
		var legacy bytes.Buffer
		writer := zip.NewWriter(&legacy)
		for _, entry := range reader.File {
			name := strings.ReplaceAll(entry.Name, "红果短剧", "hongguo-desktop")
			out, err := writer.Create(name)
			if err != nil {
				t.Fatal(err)
			}
			in, err := entry.Open()
			if err != nil {
				t.Fatal(err)
			}
			if _, err := io.Copy(out, in); err != nil {
				t.Fatal(err)
			}
			in.Close()
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(t.TempDir(), "legacy.zip")
		if err := os.WriteFile(path, legacy.Bytes(), 0600); err != nil {
			t.Fatal(err)
		}
		if verifyDesktopZIP(path, platform) == nil {
			t.Fatal("legacy display path accepted by renamed channel")
		}
	}
}
func TestDesktopCheckCancellationStopsRequests(t *testing.T) {
	u := newDesktopUpdater(1, t.TempDir(), t.TempDir(), "windows-amd64")
	started := make(chan struct{})
	u.client.Transport = updateTransport(func(r *http.Request) (*http.Response, error) {
		close(started)
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	u.check()
	<-started
	u.close()
	waitUpdater(t, u)
	if u.ctx.Err() == nil {
		t.Fatal("update worker not canceled")
	}
}
