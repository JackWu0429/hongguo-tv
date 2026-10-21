package rocks.aston.hongguotv;

import android.view.KeyEvent;

/** The login page uses an app-owned numeric keypad, so page navigation owns TV arrows. */
final class InputKeyPolicy {
    private InputKeyPolicy() {}

    static boolean isBackKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE;
    }

    static boolean routeVerticalKey(boolean editing, boolean keyboardVisible) {
        // The old login implementation used a native IME. The current login
        // screen uses an HTML keypad, so a stale Android 6 visible-frame
        // report must not hand DPAD navigation back to WebView's native focus
        // search. Keep the editing guard for any future native text field.
        return !editing;
    }

    /** Keeps page-owned navigation working after leaving the IME-backed search field. */
    static boolean routeSearchKey(boolean searchEditing, boolean searchNavigationFallback, boolean remoteNavigationTarget) {
        return searchEditing || searchNavigationFallback && remoteNavigationTarget;
    }

    static boolean routeFallbackNavigationKey(boolean searchNavigationFallback, boolean remoteNavigationTarget, boolean editing) {
        return searchNavigationFallback && remoteNavigationTarget && !editing;
    }
}
