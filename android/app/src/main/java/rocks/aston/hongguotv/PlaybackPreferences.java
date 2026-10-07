package rocks.aston.hongguotv;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

/** Playback settings survive restarts even when the local port changes. */
final class PlaybackPreferences {
    private final SharedPreferences preferences;

    PlaybackPreferences(Context context) {
        preferences = context.getSharedPreferences("playback", Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public String read() { return preferences.getString("settings", "{}"); }

    @JavascriptInterface
    public void write(String value) {
        if (value == null || value.length() > 4096) throw new IllegalArgumentException("invalid preferences");
        if (!preferences.edit().putString("settings", value).commit()) {
            throw new IllegalStateException("preferences were not saved");
        }
    }
}
