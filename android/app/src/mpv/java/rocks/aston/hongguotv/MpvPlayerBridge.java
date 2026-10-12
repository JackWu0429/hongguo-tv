package rocks.aston.hongguotv;

import android.os.Handler;
import android.os.Looper;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;

/** One libmpv instance per source: callbacks from a released source cannot own the new one. */
public final class MpvPlayerBridge implements NativePlayerAdapter, SurfaceHolder.Callback {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final WebView web;
    private final FrameLayout holder;
    private final SurfaceView surface;
    private final SharedPreferences preferences;
    private Session session;
    private boolean destroyed, background;
    private double volume = 1, speed = 1;
    private boolean muted = true;
    private float left, top, width, height;
    private volatile String diagnostic = "{\"engine\":\"mpv\"}";

    private static final class Session {
        final String id, source;
        final JSONObject data;
        final MpvDecodeMode mode;
        final MpvOutputState output = new MpvOutputState();
        MPVLib player;
        boolean outputReady, wantsPlay, terminal, pendingSeek;
        long position, duration;
        String decoder = "", state = "preparing";
        String errorKind = "";
        int errorCode;
        Runnable timeout;
        Session(String id, String source, JSONObject data, MpvDecodeMode mode) {
            this.id = id; this.source = source; this.data = data;
            this.mode = mode;
            wantsPlay = !data.optBoolean("paused", false);
            position = PlaybackStart.positionMs(data.optDouble("start_position", 0), false);
        }
    }

    MpvPlayerBridge(WebView web, FrameLayout holder) {
        this.web = web; this.holder = holder;
        preferences = web.getContext().getSharedPreferences("hongguo_mpv_playback", Context.MODE_PRIVATE);
        surface = new SurfaceView(web.getContext());
        surface.setFocusable(false);
        surface.getHolder().addCallback(this);
        holder.addView(surface, new FrameLayout.LayoutParams(-1, -1));
        holder.setVisibility(View.GONE);
        web.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob) -> applyBounds());
        handler.postDelayed(progress, 500);
    }

    @JavascriptInterface public boolean isAvailable() { return true; }
    @JavascriptInterface public String engine() { return "mpv"; }
    @JavascriptInterface public String diagnostics() { return diagnostic; }
    @JavascriptInterface public String decoderMode() { return MpvDecodeMode.stored(preferences.getString("mpv_decode_mode", null)).id; }
    @JavascriptInterface public boolean safeStart() { return false; }
    @JavascriptInterface public void setDecoderMode(String value) {
        MpvDecodeMode mode = MpvDecodeMode.requested(value);
        if (mode != null) preferences.edit().putString("mpv_decode_mode", mode.id).apply();
    }

    @JavascriptInterface public void showLicenses() {
        handler.post(() -> {
            if (destroyed) return;
            try (java.io.InputStream input = web.getContext().getAssets().open("mpv-notices.txt")) {
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
                TextView text = new TextView(web.getContext());
                text.setText(bytes.toString("UTF-8")); text.setTextSize(16); text.setPadding(24,24,24,24);
                ScrollView scroll = new ScrollView(web.getContext()); scroll.setFocusable(true); scroll.addView(text);
                new AlertDialog.Builder(web.getContext()).setTitle("MPV 开源许可")
                    .setView(scroll).setPositiveButton("关闭", (dialog, which) -> dialog.dismiss()).show();
            } catch (java.io.IOException ignored) {
                new AlertDialog.Builder(web.getContext()).setMessage("许可文件暂时无法读取，请查看对应版本的库源码附件。")
                    .setPositiveButton("关闭", null).show();
            }
        });
    }

    @JavascriptInterface public void play(String id, String payload) {
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,80}") || payload == null || payload.length() > 65536) return;
        try {
            JSONObject data = new JSONObject(payload);
            String source = data.optString("source");
            handler.post(() -> {
                if (destroyed) return;
                release();
                Session target = new Session(id, source, data, MpvDecodeMode.stored(decoderMode())); session = target;
                if (!MediaUrlPolicy.valid(source)) { fail(target, "source"); return; }
                if (!applyBounds()) { fail(target, "display"); return; }
                double rate = data.optDouble("speed", speed);
                if (finite(rate) && rate > 0 && rate <= 4) speed = rate;
                holder.setVisibility(View.VISIBLE);
                armTimeout(target);
                event(target, "buffering", null);
                start(target);
            });
        } catch (Exception ignored) {
            handler.post(() -> send(id, "error", new JSONObject()));
        }
    }

    private boolean current(Session target) { return !destroyed && session == target && !target.terminal; }
    private void start(Session target) {
        if (!current(target) || target.player != null || !surface.getHolder().getSurface().isValid()) return;
        try {
            MPVLib active = MPVLib.create(web.getContext());
            if (active == null) { fail(target, "initialization"); return; }
            target.player = active;
            // Match media_kit's safe automatic Android path. Users can retain
            // software decoding if their vendor decoder produces bad frames.
            option(active, "config", "no"); option(active, "terminal", "no");
            option(active, "vo", "gpu"); option(active, "gpu-context", "android");
            option(active, "opengl-es", "yes"); option(active, "hwdec", target.mode.hwdec);
            // Match WebView object-fit: contain: preserve the source aspect
            // ratio, center in the current Surface, and never crop to fill.
            option(active, "keepaspect", "yes"); option(active, "panscan", "0");
            option(active, "video-align-x", "0"); option(active, "video-align-y", "0");
            // Mobile rendering defaults used by media_kit; retain HDR policy.
            option(active, "scale", "bilinear"); option(active, "dscale", "bilinear");
            option(active, "dither", "no"); option(active, "correct-downscaling", "no");
            option(active, "linear-downscaling", "no"); option(active, "sigmoid-upscaling", "no");
            // media_kit uses OpenSL ES on physical Android devices. Keep
            // AudioTrack as an initialization fallback with conservative PCM.
            option(active, "ao", "opensles,audiotrack");
            option(active, "audiotrack-pcm-float", "no");
            option(active, "keep-open", "yes");
            option(active, "idle", "yes"); option(active, "force-window", "no");
            option(active, "osd-level", "0"); option(active, "input-default-bindings", "no");
            option(active, "input-vo-keyboard", "no"); option(active, "sid", "no");
            option(active, "cache", "yes"); option(active, "demuxer-max-bytes", "32MiB");
            option(active, "demuxer-max-back-bytes", "8MiB");
            option(active, "network-timeout", "15");
            option(active, "start", Double.toString(target.position / 1000.0));
            active.addObserver(new MPVLib.EventObserver() {
                private void post(Runnable action) { handler.post(() -> { if (target.player == active) guarded(target, action); }); }
                @Override public void error() { post(() -> fail(target, "native_event")); }
                @Override public void outputMessage(int component, int level) {
                    post(() -> { target.output.message(component, level); updateDiagnostic(target, null); });
                }
                @Override public void endFile(int reason, int error) {
                    post(() -> {
                        if (reason == 0 && target.outputReady) finish(target);
                        else if (reason == 4 || error < 0) fail(target, "media", error);
                        // stop/quit belong to disposal, not auto-next or a failed load.
                    });
                }
                @Override public void eventProperty(String name, boolean value) {
                    post(() -> {
                        if ("eof-reached".equals(name) && value && target.outputReady) finish(target);
                        else if ("vo-configured".equals(name)) {
                            target.output.configured = value; rendered(target);
                        }
                        else if ("paused-for-cache".equals(name) && target.outputReady && target.wantsPlay && !background)
                            MpvPlayerBridge.this.event(target, value ? "buffering" : "playing", null);
                        else if ("pause".equals(name) && target.outputReady && !background)
                            MpvPlayerBridge.this.event(target, value ? "paused" : "playing", null);
                    });
                }
                @Override public void event(int value) {
                    post(() -> {
                        if (value == MPVLib.MpvEvent.MPV_EVENT_FILE_LOADED) {
                            target.output.loaded = true;
                            if (target.pendingSeek) {
                                active.command(new String[]{"seek", Double.toString(target.position / 1000.0), "absolute+exact"});
                                target.pendingSeek = false;
                            }
                        }
                        else if (value == MPVLib.MpvEvent.MPV_EVENT_PLAYBACK_RESTART) {
                            target.output.restarted = true; rendered(target);
                        }
                    });
                }
            });
            active.init();
            active.observeProperty("eof-reached", MPVLib.MpvFormat.MPV_FORMAT_FLAG);
            active.observeProperty("pause", MPVLib.MpvFormat.MPV_FORMAT_FLAG);
            active.observeProperty("paused-for-cache", MPVLib.MpvFormat.MPV_FORMAT_FLAG);
            active.observeProperty("vo-configured", MPVLib.MpvFormat.MPV_FORMAT_FLAG);
            active.attachSurface(surface.getHolder().getSurface()); target.output.attached = true;
            android.graphics.Rect frame = surface.getHolder().getSurfaceFrame();
            surfaceSize(target, frame.width(), frame.height());
            active.setPropertyString("force-window", "yes");
            active.setPropertyBoolean("mute", muted);
            active.setPropertyDouble("volume", volume * 100);
            active.setPropertyDouble("speed", speed);
            active.setPropertyBoolean("pause", background || !target.wantsPlay);
            active.command(new String[]{"loadfile", target.source, "replace"});
        } catch (LinkageError | RuntimeException failure) { fail(target, "initialization"); }
    }
    private static void option(MPVLib player, String name, String value) {
        if (player.setOptionString(name, value) < 0) throw new IllegalStateException("MPV option rejected: " + name);
    }
    private static boolean finite(double value) { return !Double.isNaN(value) && !Double.isInfinite(value); }
    private void guarded(Session target, Runnable action) {
        if (!current(target)) return;
        try { action.run(); } catch (RuntimeException failure) { fail(target, "player"); }
    }
    private void armTimeout(Session target) {
        if (target.timeout != null) handler.removeCallbacks(target.timeout);
        if (background || target.outputReady) return;
        target.timeout = () -> { if (current(target) && !target.outputReady && !background) fail(target, "output_timeout"); };
        handler.postDelayed(target.timeout, 25000);
    }
    private void rendered(Session target) {
        if (!current(target) || target.player == null) return;
        MPVLib player = target.player;
        Integer w = player.getPropertyInt("dwidth"), h = player.getPropertyInt("dheight");
        target.output.width = w == null ? 0 : w; target.output.height = h == null ? 0 : h;
        target.output.vo = property(player, "current-vo");
        target.output.configured = Boolean.TRUE.equals(player.getPropertyBoolean("vo-configured"));
        if (!target.output.ready(surface.getHolder().getSurface().isValid())) return;
        String decoder = player.getPropertyString("video-codec");
        target.decoder = decoder == null ? "" : decoder;
        if (!target.outputReady) {
            target.outputReady = true;
            handler.removeCallbacks(target.timeout);
            JSONObject detail = new JSONObject();
            try { detail.put("width", w).put("height", h); } catch (Exception ignored) {}
            // The shared adapter's frame event means presentation-ready here.
            // libmpv has no physical first-frame callback; report that honestly.
            event(target, "frame", detail);
        }
        if (!background) event(target, target.wantsPlay ? "playing" : "paused", null);
    }
    private void finish(Session target) {
        if (!current(target)) return;
        reportProgress(target);
        event(target, "ended", null); target.terminal = true;
        try { target.player.setPropertyBoolean("pause", true); } catch (RuntimeException ignored) {}
        handler.removeCallbacks(target.timeout);
    }
    private void fail(Session target, String kind) {
        fail(target, kind, 0);
    }
    private void fail(Session target, String kind, int code) {
        if (!current(target)) return;
        JSONObject detail = new JSONObject();
        target.errorKind = kind; target.errorCode = code;
        try { detail.put("kind", kind).put("code", code); } catch (Exception ignored) {}
        event(target, "error", detail); target.terminal = true;
        dispose(target); holder.setVisibility(View.GONE);
    }
    private final Runnable progress = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            Session target = session;
            if (target != null && current(target) && target.player != null) guarded(target, () -> {
                if (!target.outputReady) rendered(target);
                if (target.outputReady) reportProgress(target);
                else updateDiagnostic(target, null);
            });
            handler.postDelayed(this, 500);
        }
    };
    private void reportProgress(Session target) {
        if (target.player == null) return;
        Double position = target.player.getPropertyDouble("time-pos"), duration = target.player.getPropertyDouble("duration");
        if (position != null && finite(position)) target.position = Math.max(0, Math.round(position * 1000));
        if (duration != null && finite(duration)) target.duration = Math.max(0, Math.round(duration * 1000));
        updateDiagnostic(target, null);
        web.evaluateJavascript("window.HongguoNativePlayback&&window.HongguoNativePlayback.progress(" + JSONObject.quote(target.id) + "," + target.position + "," + target.duration + ")", null);
    }
    private void updateDiagnostic(Session target, JSONObject detail) {
        try {
            JSONObject fields = new JSONObject().put("engine", "mpv").put("state", target.state)
                .put("surface", "SurfaceView").put("mode", target.mode.id).put("hwdec_requested", target.mode.hwdec).put("output_ready", target.outputReady)
                .put("frame_signal", "playback-restart").put("video_decoder", target.decoder)
                .put("width", target.output.width).put("height", target.output.height).put("speed", speed)
                .put("restart_seen", target.output.restarted).put("vo_configured", target.output.configured)
                .put("video_output", target.output.vo).put("surface_width", target.output.surfaceWidth)
                .put("surface_height", target.output.surfaceHeight)
                .put("surface_attached", target.output.attached && surface.getHolder().getSurface().isValid())
                .put("surface_visible", holder.getVisibility() == View.VISIBLE && surface.isShown())
                .put("output_messages", target.output.messages());
            if (target.player != null) {
                MPVLib player = target.player;
                target.decoder = property(player, "video-codec");
                fields.put("video_decoder", target.decoder).put("hwdec_current", property(player, "hwdec-current"));
                Integer decodedDrops = player.getPropertyInt("decoder-frame-drop-count"), outputDrops = player.getPropertyInt("frame-drop-count");
                Double avsync = player.getPropertyDouble("avsync");
                if (decodedDrops != null && decodedDrops >= 0) fields.put("decoder_frame_drop_count", decodedDrops);
                if (outputDrops != null && outputDrops >= 0) fields.put("frame_drop_count", outputDrops);
                if (avsync != null && finite(avsync)) fields.put("avsync", avsync);
                fields.put("audio_output", property(player, "current-ao"))
                    .put("audio_codec", property(player, "audio-codec"))
                    .put("audio_format", property(player, "audio-out-params/format"));
                Integer rate = player.getPropertyInt("audio-out-params/samplerate");
                Integer channels = player.getPropertyInt("audio-out-params/channel-count");
                if (rate != null) fields.put("audio_rate", rate);
                if (channels != null) fields.put("audio_channels", channels);
                Boolean actualMute = player.getPropertyBoolean("mute"), actualPause = player.getPropertyBoolean("pause");
                Double actualVolume = player.getPropertyDouble("volume");
                if (actualMute != null) fields.put("actual_mute", actualMute);
                if (actualPause != null) fields.put("actual_pause", actualPause);
                if (actualVolume != null && finite(actualVolume)) fields.put("actual_volume", actualVolume);
            }
            if (!target.errorKind.isEmpty()) fields.put("error_kind", target.errorKind).put("error_code", target.errorCode);
            diagnostic = fields.toString();
        } catch (Exception ignored) {}
    }
    private static String property(MPVLib player, String name) {
        String value = player.getPropertyString(name);
        // Only codec/output properties are queried. Bound strings before crossing the bridge.
        return value == null ? "" : value.substring(0, Math.min(value.length(), 80));
    }
    private void event(Session target, String name, JSONObject detail) {
        if (!current(target)) return;
        target.state = name; updateDiagnostic(target, detail); send(target.id, name, detail);
    }
    private void send(String id, String name, JSONObject detail) {
        if (!destroyed) web.evaluateJavascript("window.HongguoNativePlayback&&window.HongguoNativePlayback.event(" + JSONObject.quote(id) + "," + JSONObject.quote(name) + "," + (detail == null ? "{}" : detail.toString()) + ")", null);
    }
    @JavascriptInterface public void begin(String id) { stop(); }
    @JavascriptInterface public void stop() { handler.post(() -> { release(); holder.setVisibility(View.GONE); }); }
    @JavascriptInterface public void pause() { handler.post(() -> { Session s = session; if (s != null) guarded(s, () -> { s.wantsPlay = false; if (s.player != null) s.player.setPropertyBoolean("pause", true); }); }); }
    @JavascriptInterface public void resume() { handler.post(() -> { Session s = session; if (s != null) guarded(s, () -> { s.wantsPlay = true; if (s.player != null && s.output.attached && !background) s.player.setPropertyBoolean("pause", false); }); }); }
    @JavascriptInterface public void setSpeed(double value) {
        if (!finite(value) || value <= 0 || value > 4) return;
        handler.post(() -> { speed = value; Session s = session; if (s != null) guarded(s, () -> { if (s.player != null) s.player.setPropertyDouble("speed", value); }); });
    }
    @JavascriptInterface public void setVolume(double value, boolean silent) {
        if (!finite(value)) return;
        handler.post(() -> { volume = Math.max(0, Math.min(1, value)); muted = silent;
            Session s = session; if (s != null) guarded(s, () -> { if (s.player != null) { s.player.setPropertyDouble("volume", volume * 100); s.player.setPropertyBoolean("mute", muted); } });
        });
    }
    @JavascriptInterface public void seekTo(double seconds) {
        if (!finite(seconds) || seconds < 0) return;
        handler.post(() -> { Session s = session; if (s != null) guarded(s, () -> {
            s.position = Math.round(seconds * 1000);
            s.pendingSeek = !s.output.loaded;
            if (s.output.loaded && s.player != null) s.player.command(new String[]{"seek", Double.toString(seconds), "absolute+exact"});
        }); });
    }
    @JavascriptInterface public void seekBy(int seconds) { handler.post(() -> { if (session != null) seekTo(Math.max(0, session.position / 1000.0 + Math.max(-60, Math.min(60, seconds)))); }); }
    @JavascriptInterface public void bounds(float l, float t, float w, float h) {
        if (!PlaybackBounds.valid(l, t, w, h)) return;
        handler.post(() -> { left = l; top = t; width = w; height = h; applyBounds(); });
    }
    private boolean applyBounds() {
        if (!PlaybackBounds.valid(left, top, width, height)) return false;
        int w = Math.round(web.getWidth() * width), h = Math.round(web.getHeight() * height);
        if (!PlaybackBounds.visible(w, h)) return false;
        FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(w, h);
        layout.leftMargin = Math.round(web.getWidth() * left); layout.topMargin = Math.round(web.getHeight() * top);
        holder.setLayoutParams(layout); return true;
    }
    @Override public void surfaceCreated(SurfaceHolder surfaceHolder) {
        Session target = session;
        if (target == null || !current(target)) return;
        armTimeout(target);
        start(target);
    }
    private void surfaceSize(Session target, int w, int h) {
        target.output.surfaceWidth = w; target.output.surfaceHeight = h;
        if (target.player != null && target.output.attached && w > 0 && h > 0)
            target.player.setPropertyString("android-surface-size", w + "x" + h);
    }
    @Override public void surfaceChanged(SurfaceHolder surfaceHolder, int format, int w, int h) {
        Session target = session;
        if (target != null) guarded(target, () -> { surfaceSize(target, w, h); rendered(target); });
    }
    @Override public void surfaceDestroyed(SurfaceHolder surfaceHolder) {
        Session s = session;
        if (s != null && s.player != null && s.output.attached) guarded(s, () -> {
            Double position = s.player.getPropertyDouble("time-pos");
            if (position != null && finite(position)) s.position = Math.max(0, Math.round(position * 1000));
            // libmpv's Android VO captures ANativeWindow at initialization.
            // Changing wid alone cannot rebind that VO to a recreated surface.
            // Destroy before releasing its global reference, then restore the
            // source/position when SurfaceView creates a new surface.
            dispose(s); s.output.loaded = false; s.outputReady = false;
            s.output.restarted = false; s.output.configured = false; s.output.vo = "";
            s.output.surfaceWidth = 0; s.output.surfaceHeight = 0;
            event(s, "buffering", null);
        });
    }
    private void dispose(Session target) {
        if (target.timeout != null) handler.removeCallbacks(target.timeout);
        MPVLib old = target.player; target.player = null;
        if (old != null) {
            try {
                old.setPropertyBoolean("mute", true);
            } catch (RuntimeException ignored) {
                // Destroy still owns cleanup if a dying source rejected a command.
            } finally { target.output.attached = false; old.destroy(); }
        }
    }
    private void release() { Session old = session; session = null; if (old != null) { old.terminal = true; dispose(old); } }
    @Override public void onPause() {
        background = true; Session s = session;
        if (s != null) { if (s.timeout != null) handler.removeCallbacks(s.timeout); guarded(s, () -> { if (s.player != null) s.player.setPropertyBoolean("pause", true); }); }
    }
    @Override public void onResume() {
        background = false; Session s = session;
        if (s != null) guarded(s, () -> { armTimeout(s); start(s); if (s.player != null && s.output.attached) s.player.setPropertyBoolean("pause", !s.wantsPlay); });
    }
    @Override public void destroy() { destroyed = true; handler.removeCallbacksAndMessages(null); release(); surface.getHolder().removeCallback(this); holder.setVisibility(View.GONE); }
}
