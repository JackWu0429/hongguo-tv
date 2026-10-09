package rocks.aston.hongguotv;

/** The login page uses an app-owned numeric keypad, so page navigation owns TV arrows. */
final class InputKeyPolicy {
    private InputKeyPolicy() {}

    static boolean routeVerticalKey(boolean editing, boolean keyboardVisible) {
        // The old login implementation used a native IME. The current login
        // screen uses an HTML keypad, so a stale Android 6 visible-frame
        // report must not hand DPAD navigation back to WebView's native focus
        // search. Keep the editing guard for any future native text field.
        return !editing;
    }
}
