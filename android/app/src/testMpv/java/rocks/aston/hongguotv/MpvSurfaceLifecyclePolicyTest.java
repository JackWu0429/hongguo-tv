package rocks.aston.hongguotv;

import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class MpvSurfaceLifecyclePolicyTest {
    @Test public void terminalSessionPlayerIsRetired() {
        assertEquals(MpvSurfaceLifecyclePolicy.Action.RETIRE_ORPHAN,
            MpvSurfaceLifecyclePolicy.onDestroyed(false, true, false, true));
    }

    @Test public void activeSessionPlayerIsRecreatedAfterSurfaceReturns() {
        assertEquals(MpvSurfaceLifecyclePolicy.Action.RECREATE_ACTIVE_SESSION,
            MpvSurfaceLifecyclePolicy.onDestroyed(false, true, true, true));
    }

    @Test public void pendingSessionWaitsForSurfaceCreationDuringStopFence() {
        assertEquals(MpvSurfaceLifecyclePolicy.Action.DEFER_STOPPING_SESSION,
            MpvSurfaceLifecyclePolicy.onDestroyed(true, true, true, true));
    }

    @Test public void unownedPlayerIsRetiredWhenSurfaceIsDestroyed() {
        assertEquals(MpvSurfaceLifecyclePolicy.Action.RETIRE_ORPHAN,
            MpvSurfaceLifecyclePolicy.onDestroyed(false, false, false, true));
    }

    @Test public void stoppedPlayerIsReusedOnlyWhenItsSurfaceStayedAvailable() {
        assertTrue(MpvSurfaceLifecyclePolicy.canReuseStoppedPlayer(true, true, true));
        assertFalse(MpvSurfaceLifecyclePolicy.canReuseStoppedPlayer(true, false, true));
        assertFalse(MpvSurfaceLifecyclePolicy.canReuseStoppedPlayer(true, true, false));
        assertFalse(MpvSurfaceLifecyclePolicy.canReuseStoppedPlayer(false, true, true));
    }
}
