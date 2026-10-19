//go:build linux && linux_playback_probe

package main

// This opt-in test runs the real Wails/WebKitGTK window. It is deliberately
// excluded from normal tests and does not change the production player.
import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type linuxProbeBridge struct{ dispatch func(string) string }

func (b *linuxProbeBridge) Dispatch(message string) string { return b.dispatch(message) }

func TestLinuxPlaybackProbe(t *testing.T) {
	// go test links the application package under its import path, not main.
	// Match the separately stamped core explicitly in this opt-in test.
	version = "linux-playback-validation"
	desktopVersion = "0.2.92-linux-validation"
	output := os.Getenv("HONGGUO_PROBE_OUTPUT")
	if output == "" || os.Getenv("HONGGUO_CORE_PATH") == "" {
		t.Fatal("probe requires isolated output and a compiled core")
	}
	if err := os.MkdirAll(output, 0700); err != nil {
		t.Fatal(err)
	}
	script, err := os.ReadFile(os.Getenv("HONGGUO_PROBE_JS"))
	if err != nil {
		t.Fatal(err)
	}
	data := t.TempDir()
	app := &desktopApp{core: newCoreHost(), updater: newDesktopUpdater(0, data, data, "linux-validation")}
	app.core.dataDir = data
	var mu sync.Mutex
	var result map[string]interface{}
	var heartbeat map[string]interface{}
	var quit sync.Once
	finished := make(chan struct{})
	finish := func(ctx context.Context) {
		quit.Do(func() { close(finished); go func() { time.Sleep(time.Second); wruntime.Quit(ctx) }() })
	}
	mediaPath := regexp.MustCompile(`^/minireel-proxy/media/[a-zA-Z0-9_-]+\.mp4$`)
	stageName := regexp.MustCompile(`^(first-a|first-b|after-seek|second-a|second-b|failure)$`)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/__linux_probe/capture" && r.URL.Path != "/__linux_probe/report" && r.URL.Path != "/__linux_probe/heartbeat" {
			if !desktopRequestAllowed(r) {
				t.Logf("shell request rejected: method=%s path=%s host=%s origin=%s", r.Method, r.URL.Path, r.Host, r.Header.Get("Origin"))
			}
			app.core.proxy(w, r)
			return
		}
		if r.Method != http.MethodPost || !desktopRequestAllowed(r) {
			http.Error(w, "invalid probe request", http.StatusForbidden)
			return
		}
		var payload map[string]interface{}
		if err := json.NewDecoder(io.LimitReader(r.Body, 256*1024)).Decode(&payload); err != nil {
			http.Error(w, "invalid probe JSON", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/__linux_probe/heartbeat" {
			mu.Lock()
			heartbeat = payload
			mu.Unlock()
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		if r.URL.Path == "/__linux_probe/report" {
			mu.Lock()
			result = payload
			mu.Unlock()
			encoded, _ := json.MarshalIndent(payload, "", "  ")
			_ = os.WriteFile(filepath.Join(output, "playback.json"), encoded, 0600)
			_, _ = w.Write([]byte(`{"ok":true}`))
			finish(app.ctx)
			return
		}
		stage, _ := payload["stage"].(string)
		if !stageName.MatchString(stage) {
			http.Error(w, "invalid stage", http.StatusBadRequest)
			return
		}
		// Screenshots come from the X11 compositor, not a poster/canvas substitute.
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		screenshotErr := exec.CommandContext(ctx, "import", "-window", "root", filepath.Join(output, stage+".png")).Run()
		capture := map[string]interface{}{"screenshot": screenshotErr == nil}
		if stage == "first-a" || stage == "second-a" {
			// A null sink proves decoded PCM without claiming physical speaker output.
			err := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "pulse", "-i", "linux_probe.monitor", "-t", "2", "-ar", "16000", "-ac", "1", filepath.Join(output, stage+".wav")).Run()
			capture["audio_capture"] = err == nil
			path, _ := payload["media_path"].(string)
			if mediaPath.MatchString(path) && app.core.target() != "" {
				bytes, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-rw_timeout", "12000000", "-show_entries", "stream=codec_name,codec_type,width,height,sample_rate,channels:format=duration", "-of", "json", app.core.target()+path).Output()
				var codecs interface{}
				if err == nil && json.Unmarshal(bytes, &codecs) == nil {
					capture["codecs"] = codecs
				}
			}
		}
		// Neither artifacts nor logs need the ephemeral media token.
		delete(payload, "media_path")
		capture["sample"] = payload
		encoded, _ := json.MarshalIndent(capture, "", "  ")
		_ = os.WriteFile(filepath.Join(output, stage+".json"), encoded, 0600)
		_ = json.NewEncoder(w).Encode(capture)
	})
	bridge := &linuxProbeBridge{dispatch: func(message string) string {
		var request struct {
			Kind    string          `json:"kind"`
			Payload json.RawMessage `json:"payload"`
		}
		if json.Unmarshal([]byte(message), &request) != nil || (request.Kind != "heartbeat" && request.Kind != "capture" && request.Kind != "report") {
			return `{"error":"invalid diagnostic message"}`
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("POST", "http://wails.localhost/__linux_probe/"+request.Kind, strings.NewReader(string(request.Payload))))
		return response.Body.String()
	}}
	err = wails.Run(&options.App{
		Title: "Hongguo Linux playback validation", Width: 1280, Height: 800,
		WindowStartState: options.Fullscreen,
		BackgroundColour: options.NewRGB(12, 13, 18),
		AssetServer:      &assetserver.Options{Handler: handler}, Bind: []interface{}{app, bridge},
		OnStartup: func(ctx context.Context) {
			app.ctx = ctx
			app.core.start()
			// Do not invoke the macOS/Windows updater in a Linux experiment.
			go func() {
				ticker := time.NewTicker(2 * time.Second)
				defer ticker.Stop()
				timeout := time.NewTimer(5 * time.Minute)
				defer timeout.Stop()
				for {
					select {
					case <-finished:
						return
					case <-ticker.C:
						wruntime.WindowExecJS(ctx, string(script))
					case <-timeout.C:
						mu.Lock()
						app.core.mu.RLock()
						result = map[string]interface{}{"ok": false, "failure": "native window or JavaScript probe timed out", "heartbeat": heartbeat, "core_ready": app.core.baseURL != "", "core_failure": app.core.failure}
						app.core.mu.RUnlock()
						encoded, _ := json.MarshalIndent(result, "", "  ")
						_ = os.WriteFile(filepath.Join(output, "playback.json"), encoded, 0600)
						mu.Unlock()
						captureCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
						_ = exec.CommandContext(captureCtx, "import", "-window", "root", filepath.Join(output, "failure.png")).Run()
						cancel()
						finish(ctx)
						return
					}
				}
			}()
		},
		OnDomReady: func(ctx context.Context) { t.Log("native document ready"); wruntime.WindowExecJS(ctx, string(script)) },
		OnShutdown: app.shutdown,
	})
	if err != nil {
		app.core.stop()
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if result == nil || result["ok"] != true {
		t.Fatal(fmt.Sprint("Linux playback did not pass; inspect playback.json"))
	}
}
