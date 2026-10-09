package rocks.aston.hongguotv;

/** Check a fixed-speed VOD clock only across uninterrupted playback windows. */
final class PlaybackClock {
    private long mediaStart = -1, wallStart = -1;
    private double ratio;
    void reset() { mediaStart = wallStart = -1; }
    double ratio() { return ratio; }
    boolean observe(long mediaMs, long wallMs, boolean running) {
        if (!running || mediaMs < 0 || wallMs < 0) { reset(); return false; }
        if (wallStart < 0 || mediaMs < mediaStart || wallMs < wallStart) {
            mediaStart = mediaMs; wallStart = wallMs; return false;
        }
        long elapsed = wallMs - wallStart;
        if (elapsed < 3000) return false;
        ratio = (double)(mediaMs - mediaStart) / elapsed;
        mediaStart = mediaMs; wallStart = wallMs;
        return ratio > 1.65;
    }
}
