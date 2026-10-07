package rocks.aston.hongguotv;

/** TV IMEs may float without shrinking the window's visible frame. */
final class InputKeyPolicy {
    private InputKeyPolicy() {}

    static boolean routeVerticalKey(boolean editing, boolean keyboardVisible) {
        return !editing && !keyboardVisible;
    }
}
