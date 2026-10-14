package rocks.aston.hongguotv;

/** Keeps the newest source request and latest play intent during a stop fence. */
final class MpvTransitionState<T> {
    private T pendingSession;
    private Boolean playIntent;

    void queue(T session) { pendingSession = session; }

    T takePendingSession() {
        T next = pendingSession;
        pendingSession = null;
        return next;
    }

    T takePendingSessionWhenReady(boolean ready) {
        return ready ? takePendingSession() : null;
    }

    void setPlayIntent(boolean wantsPlay) { playIntent = wantsPlay; }

    Boolean takePlayIntent() {
        Boolean intent = playIntent;
        playIntent = null;
        return intent;
    }

    void clear() {
        pendingSession = null;
        playIntent = null;
    }
}
