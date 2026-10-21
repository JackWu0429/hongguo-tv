package rocks.aston.hongguotv;

import android.view.KeyEvent;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class InputKeyPolicyTest {
    @Test public void backAndEscapeKeysUseTheApplicationBackFlow() {
        assertTrue(InputKeyPolicy.isBackKey(KeyEvent.KEYCODE_BACK));
        assertTrue(InputKeyPolicy.isBackKey(KeyEvent.KEYCODE_ESCAPE));
        assertFalse(InputKeyPolicy.isBackKey(KeyEvent.KEYCODE_DPAD_CENTER));
    }

    @Test public void menuKeyIsOwnedOnlyByThePlaybackPage() {
        assertTrue(InputKeyPolicy.routePlaybackMenuKey(true, KeyEvent.KEYCODE_MENU));
        assertFalse(InputKeyPolicy.routePlaybackMenuKey(false, KeyEvent.KEYCODE_MENU));
        assertFalse(InputKeyPolicy.routePlaybackMenuKey(true, KeyEvent.KEYCODE_BACK));
        assertFalse(InputKeyPolicy.routePlaybackMenuKey(true, KeyEvent.KEYCODE_HOME));
    }

    @Test public void backDismissesAnActiveInputBeforeReturningToThePage() {
        InputEditingState state = new InputEditingState();
        assertFalse(InputKeyPolicy.shouldDismissInputBack(state.snapshot()));
        state.beginSearch();
        assertTrue(InputKeyPolicy.shouldDismissInputBack(state.snapshot()));
        state.beginBack();
        state.finishSearch();
        assertTrue(InputKeyPolicy.shouldDismissInputBack(state.snapshot()));
        state.cancelBack();
        assertFalse(InputKeyPolicy.shouldDismissInputBack(state.snapshot()));
        state.beginAccount();
        assertTrue(InputKeyPolicy.shouldDismissInputBack(state.snapshot()));
    }

    @Test public void editorTransitionsAreMutuallyExclusiveWithoutLosingAnInFlightBack() {
        InputEditingState state = new InputEditingState();
        state.beginAccount();
        state.beginBack();
        state.beginSearch();

        InputEditingState.Snapshot snapshot = state.snapshot();
        assertTrue(snapshot.isSearchEditing());
        assertFalse(snapshot.isAccountEditing());
        assertTrue(snapshot.backPending);
        assertFalse(state.finishAccount() == InputEditingState.Target.ACCOUNT);
        assertTrue(state.snapshot().isSearchEditing());
        assertTrue(state.snapshot().backPending);
    }

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
        assertTrue(InputKeyPolicy.routeSearchKey(true, false, false));
        assertFalse(InputKeyPolicy.routeSearchKey(false, false, true));
    }

    @Test public void rendererFallbackRoutesOnlyToAFocusedNonEditor() {
        assertTrue(InputKeyPolicy.routeSearchKey(false, true, true));
        assertTrue(InputKeyPolicy.routeFallbackNavigationKey(true, true, false));
        assertFalse(InputKeyPolicy.routeFallbackNavigationKey(true, false, false));
        assertFalse(InputKeyPolicy.routeFallbackNavigationKey(true, true, true));
        assertFalse(InputKeyPolicy.routeSearchKey(false, true, false));
    }

    @Test public void imeFocusLossAfterSearchFieldFocusKeepsSuggestionNavigationRouted() {
        SearchNavigationState state = new SearchNavigationState();

        // The document can have focus when the input opens; the IME may take
        // native focus later, after that one-time snapshot was read.
        state.arm();
        assertTrue(state.routeSearchKey(true));

        // Moving from the editor to a suggestion ends text editing, but the
        // app-owned focus graph must continue receiving remote keys.
        state.setRemoteNavigationTarget(true);
        assertTrue(state.routeSearchKey(false));
        assertTrue(state.routeFallbackNavigationKey(false));
        assertFalse(state.routeFallbackNavigationKey(true));

        state.reset();
        assertFalse(state.routeSearchKey(false));
        assertFalse(state.routeFallbackNavigationKey(false));
    }

    @Test public void armingSearchNavigationDoesNotClearARecentlyFocusedSuggestion() {
        SearchNavigationState state = new SearchNavigationState();
        state.setRemoteNavigationTarget(true);
        state.arm();

        assertTrue(state.routeFallbackNavigationKey(false));
        assertTrue(state.routeSearchKey(false));
    }
}
