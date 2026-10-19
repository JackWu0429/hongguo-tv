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
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func TestLinuxPlaybackProbe(t *testing.T) {
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
	var quit sync.Once
	finished := make(chan struct{})
	finish := func(ctx context.Context) {
		quit.Do(func() { close(finished); go func() { time.Sleep(time.Second); wruntime.Quit(ctx) }() })
	}
	mediaPath := regexp.MustCompile(`^/minireel-proxy/media/[a-zA-Z0-9_-]+\.mp4$`)
	stageName := regexp.MustCompile(`^(first-a|first-b|after-seek|second-a|second-b|failure)$`)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/__linux_probe/capture" && r.URL.Path != "/__linux_probe/report" {
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
	err = wails.Run(&options.App{
		Title: "Hongguo Linux playback validation", Width: 1280, Height: 800,
		WindowStartState: options.Fullscreen,
		BackgroundColour: options.NewRGB(12, 13, 18),
		AssetServer:      &assetserver.Options{Handler: handler}, Bind: []interface{}{app},
		OnStartup: func(ctx context.Context) {
			app.ctx = ctx
			app.core.start()
			// Do not invoke the macOS/Windows updater in a Linux experiment.
			go func() {
				select {
				case <-finished:
				case <-time.After(5 * time.Minute):
					mu.Lock()
					result = map[string]interface{}{"ok": false, "failure": "native window or JavaScript probe timed out"}
					encoded, _ := json.MarshalIndent(result, "", "  ")
					_ = os.WriteFile(filepath.Join(output, "playback.json"), encoded, 0600)
					mu.Unlock()
					finish(ctx)
				}
			}()
		},
		OnDomReady: func(ctx context.Context) { wruntime.WindowExecJS(ctx, string(script)) },
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
