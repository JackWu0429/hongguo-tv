package rocks.aston.hongguotv;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class SearchInputFocusPolicyTest {
    @Test public void repairsRendererFocusOnlyOnceWhenDocumentReportsNoFocus() {
        SearchInputFocusPolicy policy = new SearchInputFocusPolicy();
        assertFalse(policy.shouldRepairRendererFocus(true));
        assertTrue(policy.shouldRepairRendererFocus(false));
        assertFalse(policy.shouldRepairRendererFocus(false));
    }

    @Test public void suppressesOnlyFocusEchoesInsideDismissGuard() {
        SearchInputFocusPolicy policy = new SearchInputFocusPolicy();
        policy.onImeDismissed(1000L);
        assertTrue(policy.shouldIgnoreFocusRequest(1001L));
        assertTrue(policy.shouldIgnoreFocusRequest(1499L));
        assertFalse(policy.shouldIgnoreFocusRequest(1500L));
        assertFalse(policy.shouldIgnoreFocusRequest(1501L));
    }

    @Test public void dismissalAllowsOneFreshRendererFocusRepair() {
        SearchInputFocusPolicy policy = new SearchInputFocusPolicy();
        assertTrue(policy.shouldRepairRendererFocus(false));
        policy.onImeDismissed(1000L);
        assertFalse(policy.shouldRepairRendererFocus(false));
        assertFalse(policy.shouldIgnoreFocusRequest(1200L));
        assertTrue(policy.shouldRepairRendererFocus(false));
    }

    @Test public void resetClearsDismissGuardAndRepairAttempt() {
        SearchInputFocusPolicy policy = new SearchInputFocusPolicy();
        policy.onImeDismissed(1000L);
        assertTrue(policy.shouldIgnoreFocusRequest(1001L));
        policy.reset();
        assertFalse(policy.shouldIgnoreFocusRequest(1002L));
        assertTrue(policy.shouldRepairRendererFocus(false));
    }
}
