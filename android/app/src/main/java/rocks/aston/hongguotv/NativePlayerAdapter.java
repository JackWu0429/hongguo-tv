package rocks.aston.hongguotv;

import android.webkit.JavascriptInterface;

/** Shared JavaScript contract and native-only Activity lifecycle. */
interface NativePlayerAdapter {
    // Concrete adapters also annotate these methods: WebView discovers
    // annotations on the actual implementation, while lint checks this type.
    @JavascriptInterface boolean isAvailable();
    @JavascriptInterface String engine();
    @JavascriptInterface String diagnostics();
    @JavascriptInterface String decoderMode();
    @JavascriptInterface boolean safeStart();
    @JavascriptInterface void setDecoderMode(String mode);
    @JavascriptInterface void play(String id, String payload);
    @JavascriptInterface void begin(String id);
    @JavascriptInterface void stop();
    @JavascriptInterface void pause();
    @JavascriptInterface void resume();
    @JavascriptInterface void setSpeed(double speed);
    @JavascriptInterface void setVolume(double volume, boolean muted);
    @JavascriptInterface void seekBy(int seconds);
    @JavascriptInterface void seekTo(double seconds);
    @JavascriptInterface void bounds(float left, float top, float width, float height);

    void onPause();
    void onResume();
    void destroy();
}
