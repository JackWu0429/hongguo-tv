package rocks.aston.hongguotv;

import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Parcelable;

public final class UpdateInstallReceiver extends BroadcastReceiver {
    static final String ACTION_STATUS = "rocks.aston.hongguotv.UPDATE_INSTALL_STATUS";
    static final String ACTION_RESULT = "rocks.aston.hongguotv.UPDATE_INSTALL_RESULT";
    static final String EXTRA_TARGET_CODE = "update_target_code";
    static final String EXTRA_STATUS = "update_status";
    static final String EXTRA_STATUS_MESSAGE = "update_status_message";

    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_STATUS.equals(intent.getAction())) return;
        int targetCode = intent.getIntExtra(EXTRA_TARGET_CODE, 0);
        if (targetCode <= 0) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String detail = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        SharedPreferences preferences = context.getSharedPreferences("HongguoTVUpdates", Context.MODE_PRIVATE);

        if (UpdateInstallStatus.needsUserAction(status)) {
            if (startUserConfirmation(context, intent, targetCode)) {
                notifyApp(context, targetCode, status, "");
            } else {
                int sessionId = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1);
                if (sessionId >= 0) {
                    try { context.getPackageManager().getPackageInstaller().abandonSession(sessionId); }
                    catch (Exception ignored) { }
                }
                saveFailure(preferences, targetCode, PackageInstaller.STATUS_FAILURE,
                        "系统无法打开安装确认界面");
                notifyApp(context, targetCode, PackageInstaller.STATUS_FAILURE, "系统无法打开安装确认界面");
            }
            return;
        }

        if (status == PackageInstaller.STATUS_SUCCESS) {
            preferences.edit().putBoolean("waiting_permission", false)
                    .putBoolean("waiting_installer", false).remove("install_status")
                    .remove("install_message").apply();
            notifyApp(context, targetCode, status, "");
            return;
        }

        saveFailure(preferences, targetCode, status, detail);
        notifyApp(context, targetCode, status, detail == null ? "" : detail);
    }

    private boolean startUserConfirmation(Context context, Intent statusIntent, int targetCode) {
        Intent confirmation = parcelableIntent(statusIntent);
        if (confirmation != null) {
            try {
                confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(confirmation);
                return true;
            } catch (Exception ignored) { }
            int sessionId = statusIntent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1);
            if (sessionId >= 0) {
                try { context.getPackageManager().getPackageInstaller().abandonSession(sessionId); }
                catch (Exception ignored) { }
            }
        }
        try {
            Intent install = new Intent(Intent.ACTION_VIEW);
            Uri uri = Uri.parse("content://" + context.getPackageName() + ".updates/apk");
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.setClipData(ClipData.newUri(context.getContentResolver(), "update", uri));
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            install.putExtra("update_target_code", targetCode);
            context.startActivity(install);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private Intent parcelableIntent(Intent statusIntent) {
        try {
            if (Build.VERSION.SDK_INT >= 33) return statusIntent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
            Parcelable value = statusIntent.getParcelableExtra(Intent.EXTRA_INTENT);
            return value instanceof Intent ? (Intent) value : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void saveFailure(SharedPreferences preferences, int targetCode, int status, String detail) {
        preferences.edit().putInt("install_target_code", targetCode).putInt("install_status", status)
                .putString("install_message", detail == null ? "" : detail)
                .putBoolean("waiting_installer", true).apply();
    }

    private void notifyApp(Context context, int targetCode, int status, String detail) {
        Intent event = new Intent(ACTION_RESULT).setPackage(context.getPackageName());
        event.putExtra(EXTRA_TARGET_CODE, targetCode).putExtra(EXTRA_STATUS, status)
                .putExtra(EXTRA_STATUS_MESSAGE, detail == null ? "" : detail);
        context.sendBroadcast(event);
    }
}
