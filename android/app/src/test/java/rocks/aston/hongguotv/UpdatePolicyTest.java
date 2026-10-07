package rocks.aston.hongguotv;

import org.junit.Test;
import static org.junit.Assert.*;

public class UpdatePolicyTest {
    @Test public void checkThrottleAndClockChanges() {
        assertTrue(UpdatePolicy.automaticCheckDue(100, 0));
        assertFalse(UpdatePolicy.automaticCheckDue(1000, 100));
        assertTrue(UpdatePolicy.automaticCheckDue(1000, 2000));
        assertTrue(UpdatePolicy.automaticCheckDue(100 + UpdatePolicy.CHECK_INTERVAL, 100));
    }
    @Test public void proxyAndDirectSourcesArePredictable() {
        assertArrayEquals(new String[]{"https://ghfast.top/https://github.com/a", "https://github.com/a"},
                UpdatePolicy.sources("https://github.com/a", "https://ghfast.top"));
        assertArrayEquals(new String[]{"https://github.com/a"}, UpdatePolicy.sources("https://github.com/a", ""));
        for (String bad : new String[]{"http://proxy.test", "https://u:p@proxy.test/", "https://proxy.test/?x=1", "https://proxy.test/#x"}) {
            try { UpdatePolicy.proxyPrefix(bad); fail(bad); } catch (IllegalArgumentException expected) { /* expected */ }
        }
    }
    @Test public void versionCodeAndCompleteSignerSetDecideInstall() {
        assertTrue(match(9, "0.2.10", new String[]{"A", "B"}, new String[]{"B", "A"}));
        assertFalse(match(8, "0.2.10", new String[]{"A"}, new String[]{"A"}));
        assertFalse(match(7, "0.2.10", new String[]{"A"}, new String[]{"A"}));
        assertFalse(match(9, "0.2.10", new String[]{"A"}, new String[]{"forged"}));
        assertFalse(match(9, "0.2.10", new String[0], new String[0]));
        assertFalse(UpdatePolicy.matchingArchive("app", 8, "other", 9, "0.2.10", 9, "0.2.10", new String[]{"A"}, new String[]{"A"}));
        assertFalse(UpdatePolicy.matchingArchive("app", 8, "app", 9, "0.2.9", 9, "0.2.10", new String[]{"A"}, new String[]{"A"}));
    }
    private boolean match(int code, String name, String[] left, String[] right) {
        return UpdatePolicy.matchingArchive("app", 8, "app", code, name, code, name, left, right);
    }
    @Test public void manifestRejectsForeignOrMutableDownloadTargets() {
        String url = "https://github.com/aston314/hongguo-tv-releases/releases/download/v0.2.7/hongguo-tv-0.2.7.apk";
        UpdatePolicy.validate("app", 9, "0.2.7", 23, 100, new String(new char[64]).replace('\0', 'a'), url, "app");
        for (String bad : new String[]{url.replace("github.com", "github.com.evil.test"), url.replace("download/v0.2.7", "latest/download"), url + "?token=x", url.replace("hongguo-tv-releases", "private-source")}) {
            try { UpdatePolicy.validate("app", 9, "0.2.7", 23, 100, new String(new char[64]).replace('\0', 'a'), bad, "app"); fail(bad); }
            catch (IllegalArgumentException expected) { /* expected */ }
        }
    }
}
