package rocks.aston.hongguotv;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class InputKeyPolicyTest {
    @Test public void floatingKeyboardKeepsDirectionalKeysEvenWithoutWindowResize() {
        assertFalse(InputKeyPolicy.routeVerticalKey(true, false));
        assertFalse(InputKeyPolicy.routeVerticalKey(true, true));
    }

    @Test public void appOwnedKeypadKeepsDirectionalKeysEvenIfWindowLooksResized() {
        assertTrue(InputKeyPolicy.routeVerticalKey(false, true));
    }

    @Test public void completedEditingRestoresPageNavigation() {
        assertTrue(InputKeyPolicy.routeVerticalKey(false, false));
    }

    @Test public void searchEditingKeepsVerticalNavigationOnPageRouter() {
        assertTrue(InputKeyPolicy.routeSearchKey(true));
        assertFalse(InputKeyPolicy.routeSearchKey(false));
    }
}
