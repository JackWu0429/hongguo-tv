package rocks.aston.hongguotv;

import org.junit.Test;
import static org.junit.Assert.*;

public class MpvDecodeModeTest {
    @Test public void newOrInvalidPreferenceUsesSafeAutomaticDecoding() {
        assertEquals(MpvDecodeMode.AUTOMATIC, MpvDecodeMode.stored(null));
        assertEquals(MpvDecodeMode.AUTOMATIC, MpvDecodeMode.stored("standard"));
        assertEquals("auto-safe", MpvDecodeMode.stored(null).hwdec);
    }
    @Test public void softwareEscapeIsExplicitAndInvalidRequestsAreRejected() {
        assertEquals("no", MpvDecodeMode.stored("mpv_software").hwdec);
        assertEquals(MpvDecodeMode.AUTOMATIC, MpvDecodeMode.requested("mpv_auto"));
        assertNull(MpvDecodeMode.requested(null));
        assertNull(MpvDecodeMode.requested("mediacodec"));
    }
}
