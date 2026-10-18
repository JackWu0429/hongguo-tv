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

    /**
     * A system IME can temporarily move window focus away from the WebView
     * while the DOM search field remains active. Keep vertical D-pad routing
     * enabled so the user can leave that field for the scan/filter actions.
     */
    static boolean routeSearchKey(boolean searchEditing) {
        return searchEditing;
    }
}
