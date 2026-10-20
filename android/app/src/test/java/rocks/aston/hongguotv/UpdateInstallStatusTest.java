package rocks.aston.hongguotv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.pm.PackageInstaller;
import org.junit.Test;

public class UpdateInstallStatusTest {
    @Test public void onlyPendingUserActionRequiresLaunchingConfirmationIntent() {
        assertTrue(UpdateInstallStatus.needsUserAction(PackageInstaller.STATUS_PENDING_USER_ACTION));
        assertFalse(UpdateInstallStatus.needsUserAction(PackageInstaller.STATUS_SUCCESS));
        assertFalse(UpdateInstallStatus.needsUserAction(PackageInstaller.STATUS_FAILURE_STORAGE));
    }

    @Test public void failuresExplainCommonInstallerOutcomesAndKeepSystemDetail() {
        assertEquals("设备存储空间不足", UpdateInstallStatus.message(PackageInstaller.STATUS_FAILURE_STORAGE, ""));
        assertEquals("系统未能识别此安装包（bad signature）",
                UpdateInstallStatus.message(PackageInstaller.STATUS_FAILURE_INVALID, " bad signature "));
    }
}
