package rocks.aston.hongguotv;

/** Initial seek is applied before prepare, so a quality switch cannot reveal time zero. */
final class PlaybackStart {
    private PlaybackStart() {}
    static long positionMs(double seconds, boolean live) {
        if (live || Double.isNaN(seconds) || Double.isInfinite(seconds) || seconds <= 0) return 0;
        return (long)(Math.min(seconds, 86400) * 1000);
    }
}
