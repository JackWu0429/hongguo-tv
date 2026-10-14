package rocks.aston.hongguotv;

import org.junit.Test;
import static org.junit.Assert.*;

public final class MpvStopFenceTest {
    @Test public void waitsForStopReplyEndFileAndTwoQuietPolls() {
        MpvStopFence fence = new MpvStopFence();
        fence.begin(7, true);

        assertFalse(fence.onCommandReply(6, 0));
        assertFalse(fence.onEventsDrained());
        assertTrue(fence.onCommandReply(7, 0));
        assertFalse(fence.onEventsDrained());
        fence.onEndFile();
        assertFalse(fence.onEventsDrained());
        assertTrue(fence.onEventsDrained());
    }

    @Test public void eventsBetweenQuietPollsRestartTheFence() {
        MpvStopFence fence = new MpvStopFence();
        fence.begin(9, false);
        fence.onCommandReply(9, 0);

        assertFalse(fence.onEventsDrained());
        fence.onEvent();
        assertFalse(fence.onEventsDrained());
        assertTrue(fence.onEventsDrained());
    }

    @Test public void commandFailureRequiresClientRetirement() {
        MpvStopFence fence = new MpvStopFence();
        fence.begin(11, true);

        assertTrue(fence.onCommandReply(11, -1));
        assertTrue(fence.failed());
        assertFalse(fence.onEventsDrained());
    }

    @Test public void endFileBeforeStopReplyCannotCompleteTheBoundary() {
        MpvStopFence fence = new MpvStopFence();
        fence.begin(13, true);

        fence.onEndFile();
        assertFalse(fence.onEventsDrained());
        assertTrue(fence.onCommandReply(13, 0));
        assertFalse(fence.onEventsDrained());
        assertTrue(fence.onEventsDrained());
    }

    @Test public void aNewBoundaryInvalidatesLateEventsFromThePreviousSource() {
        MpvStopFence fence = new MpvStopFence();
        fence.begin(17, false);
        assertTrue(fence.onCommandReply(17, 0));
        assertFalse(fence.onEventsDrained());

        // A rapid A -> B -> C transition starts a fresh fence for C.
        fence.begin(18, false);
        fence.onEvent();
        assertFalse(fence.onCommandReply(17, 0));
        assertFalse(fence.onEventsDrained());
        assertTrue(fence.onCommandReply(18, 0));
        assertFalse(fence.onEventsDrained());
        assertTrue(fence.onEventsDrained());
    }

    @Test public void clearedFenceIgnoresLateNativeEvents() {
        MpvStopFence fence = new MpvStopFence();
        fence.begin(19, true);
        fence.clear();

        fence.onEvent();
        fence.onEndFile();
        assertFalse(fence.onCommandReply(19, 0));
        assertFalse(fence.onEventsDrained());
    }

    @Test public void rapidSourceChangesKeepOnlyLatestPendingSession() {
        MpvTransitionState<String> transition = new MpvTransitionState<>();
        transition.queue("episode-B");
        transition.queue("episode-C");

        assertEquals("episode-C", transition.takePendingSession());
        assertNull(transition.takePendingSession());
    }

    @Test public void latestPauseOrResumeIntentIsAppliedOnceAfterTheFence() {
        MpvTransitionState<String> transition = new MpvTransitionState<>();
        transition.queue("episode-C");
        transition.setPlayIntent(true);
        transition.setPlayIntent(false);

        assertEquals("episode-C", transition.takePendingSession());
        assertEquals(Boolean.FALSE, transition.takePlayIntent());
        assertNull(transition.takePlayIntent());
    }

    @Test public void resumeIntentWinsWhenItIsTheLastInputDuringTheFence() {
        MpvTransitionState<String> transition = new MpvTransitionState<>();
        transition.setPlayIntent(false);
        transition.setPlayIntent(true);

        assertEquals(Boolean.TRUE, transition.takePlayIntent());
    }

    @Test public void explicitStopClearsPendingSessionAndDeferredIntent() {
        MpvTransitionState<String> transition = new MpvTransitionState<>();
        transition.queue("episode-B");
        transition.setPlayIntent(true);
        transition.clear();

        assertNull(transition.takePendingSession());
        assertNull(transition.takePlayIntent());
    }

    @Test public void failedStopStillLeavesNewestPendingSessionForRetiredClientHandoff() {
        MpvStopFence fence = new MpvStopFence();
        MpvTransitionState<String> transition = new MpvTransitionState<>();
        fence.begin(23, true);
        transition.queue("episode-B");
        transition.queue("episode-C");

        assertTrue(fence.onCommandReply(23, -1));
        assertTrue(fence.failed());
        assertEquals("episode-C", transition.takePendingSession());
    }

    @Test public void timeoutRequiresRetirementAndLateReplyCannotReopenTheFence() {
        MpvStopFence fence = new MpvStopFence();
        fence.begin(29, true);

        assertTrue(fence.onTimeout());
        assertTrue(fence.failed());
        assertFalse(fence.onEventsDrained());
        assertFalse(fence.onCommandReply(29, 0));
        fence.clear();
        assertFalse(fence.onTimeout());
    }

    @Test public void timeoutRetirementPreservesOnlyTheNewestPendingSource() {
        MpvStopFence fence = new MpvStopFence();
        MpvTransitionState<String> transition = new MpvTransitionState<>();
        fence.begin(31, false);
        transition.queue("episode-B");
        transition.queue("episode-C");

        assertTrue(fence.onTimeout());
        assertFalse(fence.onEventsDrained());
        fence.clear(); // The timed-out client is retired before this pending source is installed.
        assertEquals("episode-C", transition.takePendingSession());
    }
}
