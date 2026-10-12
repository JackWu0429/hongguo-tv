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
import org.json.JSONObject;

/** One libmpv instance per source: callbacks from a released source cannot own the new one. */
public final class MpvPlayerBridge implements NativePlayerAdapter, SurfaceHolder.Callback {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final WebView web;
    private final FrameLayout holder;
    private final SurfaceView surface;
    private Session session;
    private boolean destroyed, background;
    private double volume = 1, speed = 1;
    private boolean muted = true;
    private float left, top, width, height;
    private volatile String diagnostic = "{\"engine\":\"mpv\"}";

    private static final class Session {
        final String id, source;
        final JSONObject data;
        MPVLib player;
        boolean attached, loaded, firstFrame, wantsPlay, terminal, pendingSeek;
        long position, duration;
        int videoWidth, videoHeight;
        String decoder = "", state = "preparing";
        Runnable timeout;
        Session(String id, String source, JSONObject data) {
            this.id = id; this.source = source; this.data = data;
            wantsPlay = !data.optBoolean("paused", false);
            position = PlaybackStart.positionMs(data.optDouble("start_position", 0), false);
        }
    }

    MpvPlayerBridge(WebView web, FrameLayout holder) {
        this.web = web; this.holder = holder;
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
    @JavascriptInterface public String decoderMode() { return "mpv_software"; }
    @JavascriptInterface public boolean safeStart() { return false; }
    @JavascriptInterface public void setDecoderMode(String ignored) { /* Fixed by APK flavor. */ }

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
                Session target = new Session(id, source, data); session = target;
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
            // Software HEVC is the purpose of this edition. It does not rely on
            // the same vendor MediaCodec implementation that failed in Media3.
            option(active, "config", "no"); option(active, "terminal", "no");
            option(active, "vo", "gpu"); option(active, "gpu-context", "android");
            option(active, "opengl-es", "yes"); option(active, "hwdec", "no");
            option(active, "ao", "audiotrack"); option(active, "keep-open", "yes");
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
                @Override public void eventProperty(String name, boolean value) {
                    post(() -> {
                        if ("eof-reached".equals(name) && value && target.firstFrame) finish(target);
                        else if ("paused-for-cache".equals(name) && target.firstFrame && target.wantsPlay && !background)
                            event(target, value ? "buffering" : "playing", null);
                        else if ("pause".equals(name) && target.firstFrame && !background)
                            event(target, value ? "paused" : "playing", null);
                    });
                }
                @Override public void event(int value) {
                    post(() -> {
                        if (value == MPVLib.MpvEvent.MPV_EVENT_FILE_LOADED) {
                            target.loaded = true;
                            if (target.pendingSeek) {
                                active.command(new String[]{"seek", Double.toString(target.position / 1000.0), "absolute+exact"});
                                target.pendingSeek = false;
                            }
                        }
                        else if (value == MPVLib.MpvEvent.MPV_EVENT_PLAYBACK_RESTART) rendered(target);
                        else if (value == MPVLib.MpvEvent.MPV_EVENT_END_FILE) {
                            // keep-open emits eof-reached for a normal finish. END_FILE
                            // without EOF is a failed load, not an auto-next signal.
                            handler.postDelayed(() -> guarded(target, () -> {
                                if (!current(target) || target.player != active) return;
                                if (Boolean.TRUE.equals(active.getPropertyBoolean("eof-reached"))) finish(target);
                                else fail(target, "media");
                            }), 100);
                        }
                    });
                }
            });
            active.init();
            active.observeProperty("eof-reached", MPVLib.MpvFormat.MPV_FORMAT_FLAG);
            active.observeProperty("pause", MPVLib.MpvFormat.MPV_FORMAT_FLAG);
            active.observeProperty("paused-for-cache", MPVLib.MpvFormat.MPV_FORMAT_FLAG);
            active.attachSurface(surface.getHolder().getSurface()); target.attached = true;
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
        if (background || target.firstFrame) return;
        target.timeout = () -> { if (current(target) && !target.firstFrame && !background) fail(target, "first_frame_timeout"); };
        handler.postDelayed(target.timeout, 25000);
    }
    private void rendered(Session target) {
        if (!current(target) || !target.loaded || !target.attached) return;
        MPVLib player = target.player;
        Integer w = player.getPropertyInt("dwidth"), h = player.getPropertyInt("dheight");
        if (w == null || h == null || w <= 0 || h <= 0) return;
        target.videoWidth = w; target.videoHeight = h;
        String decoder = player.getPropertyString("video-codec");
        target.decoder = decoder == null ? "" : decoder;
        if (!target.firstFrame) {
            target.firstFrame = true;
            handler.removeCallbacks(target.timeout);
            JSONObject detail = new JSONObject();
            try { detail.put("width", w).put("height", h); } catch (Exception ignored) {}
            // playback-restart signals rendering restart; dimensions alone or
            // file-loaded never dismiss the cover. Diagnostics retain this name.
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
        if (!current(target)) return;
        JSONObject detail = new JSONObject();
        try { detail.put("kind", kind).put("code", 0); } catch (Exception ignored) {}
        event(target, "error", detail); target.terminal = true;
        dispose(target); holder.setVisibility(View.GONE);
    }
    private final Runnable progress = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            Session target = session;
            if (target != null && current(target) && target.player != null && target.firstFrame) guarded(target, () -> reportProgress(target));
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
                .put("surface", "SurfaceView").put("mode", "software").put("first_frame", target.firstFrame)
                .put("frame_signal", "playback-restart").put("video_decoder", target.decoder)
                .put("width", target.videoWidth).put("height", target.videoHeight).put("speed", speed);
            if (detail != null && detail.has("kind")) fields.put("error_kind", detail.getString("kind"));
            diagnostic = fields.toString();
        } catch (Exception ignored) {}
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
    @JavascriptInterface public void resume() { handler.post(() -> { Session s = session; if (s != null) guarded(s, () -> { s.wantsPlay = true; if (s.player != null && s.attached && !background) s.player.setPropertyBoolean("pause", false); }); }); }
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
            s.pendingSeek = !s.loaded;
            if (s.loaded && s.player != null) s.player.command(new String[]{"seek", Double.toString(seconds), "absolute+exact"});
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
    @Override public void surfaceChanged(SurfaceHolder surfaceHolder, int format, int w, int h) {}
    @Override public void surfaceDestroyed(SurfaceHolder surfaceHolder) {
        Session s = session;
        if (s != null && s.player != null && s.attached) guarded(s, () -> {
            Double position = s.player.getPropertyDouble("time-pos");
            if (position != null && finite(position)) s.position = Math.max(0, Math.round(position * 1000));
            // libmpv's Android VO captures ANativeWindow at initialization.
            // Changing wid alone cannot rebind that VO to a recreated surface.
            // Destroy before releasing its global reference, then restore the
            // source/position when SurfaceView creates a new surface.
            dispose(s); s.loaded = false; s.firstFrame = false;
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
            } finally { target.attached = false; old.destroy(); }
        }
    }
    private void release() { Session old = session; session = null; if (old != null) { old.terminal = true; dispose(old); } }
    @Override public void onPause() {
        background = true; Session s = session;
        if (s != null) { if (s.timeout != null) handler.removeCallbacks(s.timeout); guarded(s, () -> { if (s.player != null) s.player.setPropertyBoolean("pause", true); }); }
    }
    @Override public void onResume() {
        background = false; Session s = session;
        if (s != null) guarded(s, () -> { armTimeout(s); start(s); if (s.player != null && s.attached) s.player.setPropertyBoolean("pause", !s.wantsPlay); });
    }
    @Override public void destroy() { destroyed = true; handler.removeCallbacksAndMessages(null); release(); surface.getHolder().removeCallback(this); holder.setVisibility(View.GONE); }
}
