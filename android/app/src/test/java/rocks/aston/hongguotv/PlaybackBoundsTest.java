package rocks.aston.hongguotv;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackBoundsTest {
    @Test public void rejectsCollapsedOrOutsideSurface() {
        assertTrue(PlaybackBounds.valid(0, 0, 1, 1));
        assertTrue(PlaybackBounds.valid(.1f, .1f, .8f, .8f));
        assertFalse(PlaybackBounds.valid(0, 0, 0, 1));
        assertFalse(PlaybackBounds.valid(.5f, .5f, .6f, .5f));
        assertFalse(PlaybackBounds.valid(Float.NaN, 0, 1, 1));
    }
}
