package rocks.aston.hongguotv;

import org.junit.Test;
import static org.junit.Assert.*;

public class HomeChannelPolicyTest {
    @Test public void systemChannelsAreLimitedToAndroidEightAndNewer() {
        assertFalse(HomeChannelPolicy.supported(23));
        assertFalse(HomeChannelPolicy.supported(25));
        assertTrue(HomeChannelPolicy.supported(26));
        assertTrue(HomeChannelPolicy.supported(35));
    }

    @Test public void channelProgramsRequireNumericSeriesIds() {
        assertTrue(HomeChannelPolicy.validSeriesId("7690163276214176792"));
        assertFalse(HomeChannelPolicy.validSeriesId(null));
        assertFalse(HomeChannelPolicy.validSeriesId(""));
        assertFalse(HomeChannelPolicy.validSeriesId("0"));
        assertFalse(HomeChannelPolicy.validSeriesId("12/3"));
        assertFalse(HomeChannelPolicy.validSeriesId("123456789012345678901234567890123"));
    }

    @Test public void channelHasABoundedProgramList() {
        assertEquals(20, HomeChannelPolicy.MAX_PROGRAMS);
    }
}
