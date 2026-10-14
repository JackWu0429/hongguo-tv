package rocks.aston.hongguotv;

import org.junit.Test;
import static org.junit.Assert.assertEquals;

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
}
