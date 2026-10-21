package rocks.aston.hongguotv;

final class SearchInputFocusPolicy {
    static final long IME_DISMISS_GUARD_MS = 500L;

    private boolean rendererFocusRepairAttempted;
    private long imeDismissedAt = -1L;

    synchronized boolean shouldRepairRendererFocus(boolean documentHasFocus) {
        if (documentHasFocus || rendererFocusRepairAttempted) return false;
        rendererFocusRepairAttempted = true;
        return true;
    }

    synchronized boolean shouldIgnoreFocusRequest(long now) {
        if (imeDismissedAt < 0L) return false;
        long elapsed = now - imeDismissedAt;
        if (elapsed < 0L || elapsed >= IME_DISMISS_GUARD_MS) {
            imeDismissedAt = -1L;
            return false;
        }
        return true;
    }

    synchronized void onImeDismissed(long now) {
        imeDismissedAt = now;
        rendererFocusRepairAttempted = false;
    }

    synchronized void onEditingFinished() {
        rendererFocusRepairAttempted = false;
    }

    synchronized void reset() {
        rendererFocusRepairAttempted = false;
        imeDismissedAt = -1L;
    }
}
