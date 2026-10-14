package rocks.aston.hongguotv;

/** Keeps source installation and player cleanup aligned with Surface lifetime. */
final class MpvSurfaceLifecyclePolicy {
    enum Action { DEFER_STOPPING_SESSION, RECREATE_ACTIVE_SESSION, RETIRE_ORPHAN, NONE }

    private MpvSurfaceLifecyclePolicy() {}

    static Action onDestroyed(boolean stopFenceActive, boolean sessionOwnsPlayer,
                              boolean currentSession, boolean sharedPlayerExists) {
        if (stopFenceActive) return Action.DEFER_STOPPING_SESSION;
        if (sessionOwnsPlayer) return currentSession ? Action.RECREATE_ACTIVE_SESSION : Action.RETIRE_ORPHAN;
        return sharedPlayerExists ? Action.RETIRE_ORPHAN : Action.NONE;
    }
}
