package rocks.aston.hongguotv;

/** A source snapshots this preference; changing it never reconfigures a live decoder. */
enum MpvDecodeMode {
    AUTOMATIC("mpv_auto", "auto-safe"), SOFTWARE("mpv_software", "no");

    final String id, hwdec;
    MpvDecodeMode(String id, String hwdec) { this.id = id; this.hwdec = hwdec; }

    static MpvDecodeMode requested(String id) {
        for (MpvDecodeMode mode : values()) if (mode.id.equals(id)) return mode;
        return null;
    }
    static MpvDecodeMode stored(String id) {
        MpvDecodeMode mode = requested(id);
        return mode == null ? AUTOMATIC : mode;
    }
}
