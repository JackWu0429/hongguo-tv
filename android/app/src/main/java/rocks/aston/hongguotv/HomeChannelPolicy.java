package rocks.aston.hongguotv;

final class HomeChannelPolicy {
    static final int MAX_PROGRAMS = 20;

    private HomeChannelPolicy() {}

    static boolean supported(int sdkInt) {
        return sdkInt >= 26;
    }

    static boolean validSeriesId(String value) {
        if (value == null || value.length() == 0 || value.length() > 32) return false;
        for (int i = 0; i < value.length(); i++) {
            if (value.charAt(i) < '0' || value.charAt(i) > '9') return false;
        }
        return !"0".equals(value);
    }
}
