package rocks.aston.hongguotv;

/** Keeps D-pad routing on the page after an IME takes native focus from WebView. */
final class SearchNavigationState {
    private boolean fallbackEnabled;
    private boolean remoteNavigationTarget;

    void arm() {
        fallbackEnabled = true;
        remoteNavigationTarget = false;
    }

    void setRemoteNavigationTarget(boolean active) {
        remoteNavigationTarget = active;
    }

    boolean routeSearchKey(boolean searchEditing) {
        return InputKeyPolicy.routeSearchKey(searchEditing, fallbackEnabled, remoteNavigationTarget);
    }

    boolean routeFallbackNavigationKey(boolean editing) {
        return InputKeyPolicy.routeFallbackNavigationKey(fallbackEnabled, remoteNavigationTarget, editing);
    }

    void reset() {
        fallbackEnabled = false;
        remoteNavigationTarget = false;
    }
}
