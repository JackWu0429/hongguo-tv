package rocks.aston.hongguotv;

import org.junit.Test;
import static org.junit.Assert.*;

public class CoreEndpointTest {
    @Test public void onlyOwnChildReadyLineIsAccepted() {
        CoreEndpoint endpoint = CoreEndpoint.fromReadyLine("HONGGUO_TV_READY 45001 own-child", "own-child");
        assertNotNull(endpoint);
        assertEquals("http://127.0.0.1:45001/", endpoint.url);
        assertNull(CoreEndpoint.fromReadyLine("HONGGUO_TV_READY 8797 stale-child", "own-child"));
        assertNull(CoreEndpoint.fromReadyLine("core listening on 8797", "own-child"));
        assertNull(CoreEndpoint.fromReadyLine(null, "own-child"));
    }

    @Test public void badPortsAndMalformedLinesAreRejected() {
        for (String port : new String[]{"0", "-1", "65536", "abc", "2147483648"}) {
            assertNull(CoreEndpoint.fromReadyLine("HONGGUO_TV_READY " + port + " child", "child"));
        }
        assertNull(CoreEndpoint.fromReadyLine("HONGGUO_TV_READY 45001 child trailing", "child"));
        assertNull(CoreEndpoint.fromReadyLine("HONGGUO_TV_READY 45001 child", ""));
    }

    @Test public void healthRequiresExactBuildAndInstance() {
        CoreEndpoint endpoint = CoreEndpoint.fromReadyLine("HONGGUO_TV_READY 45001 child", "child");
        assertTrue(endpoint.matches("hongguo-tv-core", "child", "0.2.2-commit", "0.2.2-commit"));
        assertFalse(endpoint.matches("other", "child", "0.2.2-commit", "0.2.2-commit"));
        assertFalse(endpoint.matches("hongguo-tv-core", "stale", "0.2.2-commit", "0.2.2-commit"));
        assertFalse(endpoint.matches("hongguo-tv-core", "child", "0.2.1-commit", "0.2.2-commit"));
        assertFalse(endpoint.matches("hongguo-tv-core", "", "", "0.2.2-commit"));
        assertFalse(endpoint.matches("hongguo-tv-core", "child", "", ""));
    }
}
