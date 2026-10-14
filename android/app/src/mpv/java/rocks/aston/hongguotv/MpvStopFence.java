package rocks.aston.hongguotv;

/** Holds source replacement until stop completes and the old event queue settles. */
final class MpvStopFence {
    private long requestId;
    private boolean active, requiresEndFile, commandComplete, endFileSeen, failed;
    private int quietPolls;

    void begin(long id, boolean expectEndFile) {
        requestId = id;
        active = true;
        requiresEndFile = expectEndFile;
        commandComplete = false;
        endFileSeen = false;
        failed = false;
        quietPolls = 0;
    }

    boolean isActive() { return active; }

    void onEvent() { if (active) quietPolls = 0; }

    boolean onCommandReply(long id, int error) {
        if (!active || id != requestId) return false;
        onEvent();
        if (error < 0) failed = true;
        else commandComplete = true;
        return true;
    }

    void onEndFile() {
        if (!active) return;
        onEvent();
        endFileSeen = true;
    }

    boolean failed() { return failed; }

    boolean onTimeout() {
        if (!active) return false;
        failed = true;
        return true;
    }

    boolean onEventsDrained() {
        if (!active || failed || !commandComplete || requiresEndFile && !endFileSeen) return false;
        return ++quietPolls >= 2;
    }

    void clear() { active = false; }
}
