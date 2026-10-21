package rocks.aston.hongguotv;

/** Serializes editor and Back state shared by the WebView bridge and Activity key dispatch. */
final class InputEditingState {
    enum Target { NONE, ACCOUNT, SEARCH }

    private Target target = Target.NONE;
    private boolean backPending;

    synchronized Snapshot snapshot() {
        return new Snapshot(target, backPending);
    }

    synchronized void beginAccount() {
        target = Target.ACCOUNT;
    }

    synchronized void beginSearch() {
        target = Target.SEARCH;
    }

    synchronized Target finishAccount() {
        if (target != Target.ACCOUNT) return Target.NONE;
        target = Target.NONE;
        return Target.ACCOUNT;
    }

    synchronized Target finishSearch() {
        if (target != Target.SEARCH) return Target.NONE;
        target = Target.NONE;
        return Target.SEARCH;
    }

    synchronized Target finishCurrent() {
        Target finished = target;
        target = Target.NONE;
        return finished;
    }

    synchronized void beginBack() {
        backPending = true;
    }

    synchronized void cancelBack() {
        backPending = false;
    }

    synchronized void reset() {
        target = Target.NONE;
        backPending = false;
    }

    static final class Snapshot {
        final Target target;
        final boolean backPending;

        Snapshot(Target target, boolean backPending) {
            this.target = target;
            this.backPending = backPending;
        }

        boolean isAccountEditing() { return target == Target.ACCOUNT; }
        boolean isSearchEditing() { return target == Target.SEARCH; }
        boolean isEditing() { return target != Target.NONE; }
        boolean shouldDismissBack() { return isEditing() || backPending; }
    }
}
