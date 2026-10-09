package rocks.aston.hongguotv;

/** A collapsed or hidden WebView stage must never resize an active video surface. */
final class PlaybackBounds {
    private PlaybackBounds() {}
    static boolean valid(float left, float top, float width, float height) {
        for (float n : new float[]{left, top, width, height}) {
            if (Float.isNaN(n) || Float.isInfinite(n)) return false;
        }
        return left >= 0 && top >= 0 && width > 0 && height > 0
            && left + width <= 1.00001f && top + height <= 1.00001f;
    }
    static boolean visible(int width, int height) { return width > 1 && height > 1; }
}
