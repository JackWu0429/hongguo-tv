package rocks.aston.hongguotv;

/** Keeps native start attempts behind session identity and Surface readiness. */
final class MpvStartPolicy {
    private MpvStartPolicy() {}

    static boolean mayStart(boolean currentSession, boolean sessionAlreadyHasPlayer, boolean surfaceValid) {
        return currentSession && !sessionAlreadyHasPlayer && surfaceValid;
    }
}
