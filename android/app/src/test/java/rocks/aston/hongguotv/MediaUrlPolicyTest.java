package rocks.aston.hongguotv;

import org.junit.Test;
import static org.junit.Assert.*;

public class MediaUrlPolicyTest {
    @Test public void onlyOwnLocalMediaRouteIsAccepted() {
        assertTrue(MediaUrlPolicy.valid("http://127.0.0.1:43123/minireel-proxy/media/0123456789abcdef01234567.mp4"));
        assertTrue(MediaUrlPolicy.valid("http://localhost/minireel-proxy/media/abcdefabcdefabcdefabcdef.mp4"));
        assertFalse(MediaUrlPolicy.valid("https://example.com/minireel-proxy/media/0123456789abcdef01234567.mp4"));
        assertFalse(MediaUrlPolicy.valid("http://127.0.0.1/minireel-proxy/media/0123456789abcdef01234567.m3u8"));
        assertFalse(MediaUrlPolicy.valid("http://127.0.0.1/minireel-proxy/media/0123456789abcdef01234567.mp4?token=1"));
    }
}
