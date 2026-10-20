package rocks.aston.hongguotv;

import android.content.pm.PackageInstaller;

final class UpdateInstallStatus {
    private UpdateInstallStatus() {}

    static boolean needsUserAction(int status) {
        return status == PackageInstaller.STATUS_PENDING_USER_ACTION;
    }

    static String message(int status, String detail) {
        String reason;
        switch (status) {
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                reason = "安装已取消";
                break;
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                reason = "设备安全策略阻止了安装";
                break;
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
                reason = "安装包与设备中现有应用冲突";
                break;
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                reason = "安装包与此设备不兼容";
                break;
            case PackageInstaller.STATUS_FAILURE_INVALID:
                reason = "系统未能识别此安装包";
                break;
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                reason = "设备存储空间不足";
                break;
            case PackageInstaller.STATUS_FAILURE_TIMEOUT:
                reason = "系统安装器响应超时";
                break;
            default:
                reason = "系统安装未完成";
                break;
        }
        if (detail != null && !detail.trim().isEmpty()) return reason + "（" + detail.trim() + "）";
        return reason;
    }
}
