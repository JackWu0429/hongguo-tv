package rocks.aston.hongguotv;

import org.junit.Test;
import static org.junit.Assert.*;

public class NativePlaybackPolicyTest {
    @Test public void media3StartsAtAndroidTen() {
        assertFalse(PlayerBridge.nativePlaybackAvailable(23));
        assertFalse(PlayerBridge.nativePlaybackAvailable(24));
        assertFalse(PlayerBridge.nativePlaybackAvailable(28));
        assertTrue(PlayerBridge.nativePlaybackAvailable(29));
        assertTrue(PlayerBridge.nativePlaybackAvailable(35));
    }
}
