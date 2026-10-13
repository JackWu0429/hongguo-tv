package rocks.aston.hongguotv;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

/** Local UI and playback settings survive restarts even when the core port changes. */
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

    @JavascriptInterface
    public String readSidebarDisplay() {
        return preferences.getString("sidebarDisplay", "expanded");
    }

    @JavascriptInterface
    public void writeSidebarDisplay(String value) {
        if (!"expanded".equals(value) && !"icons".equals(value)) {
            throw new IllegalArgumentException("invalid sidebar display");
        }
        if (!preferences.edit().putString("sidebarDisplay", value).commit()) {
            throw new IllegalStateException("sidebar display was not saved");
        }
    }
}
