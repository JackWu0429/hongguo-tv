package rocks.aston.hongguotv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.util.Map;

public class CoreService extends Service {
    private static final String CHANNEL_ID = "hongguo_tv_core";
    private static final int NOTIFICATION_ID = 8797;
    private static final int PORT = 8797;
    private Process process;
    private Thread logThread;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundCompat();
        startProcess();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (process != null) {
            process.destroy();
            process = null;
        }
        if (logThread != null) {
            logThread.interrupt();
            logThread = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startProcess() {
        if (process != null) {
            try {
                process.exitValue();
            } catch (IllegalThreadStateException running) {
                return;
            }
        }
        try {
            File binary = new File(getApplicationInfo().nativeLibraryDir, "libhongguotv.so");
            if (!binary.exists()) {
                Log.e("HongguoTv", "core binary missing: " + binary.getAbsolutePath());
                return;
            }
            ProcessBuilder builder = new ProcessBuilder(binary.getAbsolutePath(), "-port", String.valueOf(PORT))
                    .redirectErrorStream(true);
            // Android may expose /data/local/tmp as os.TempDir to the native
            // process.  Point the embedded MiniReel cache at the app-private
            // cache directory so CENC-cleared MP4 files are writable and can
            // be reclaimed by Android when storage pressure occurs.
            File playbackCache = new File(getCacheDir(), "minireel");
            Map<String, String> environment = builder.environment();
            environment.put("MINIREEL_CACHE_DIR", playbackCache.getAbsolutePath());
            process = builder.start();
            consumeLogs(process);
        } catch (Exception error) {
            Log.e("HongguoTv", "failed to start core", error);
        }
    }

    private void consumeLogs(final Process running) {
        logThread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(running.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) Log.i("HongguoTv", line);
            } catch (Exception ignored) {
            }
        }, "hongguo-tv-core-log");
        logThread.start();
    }

    private void startForegroundCompat() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = builder
                .setSmallIcon(R.drawable.ic_stat_core)
                .setContentTitle(getString(R.string.notification_title))
                .setContentText(getString(R.string.notification_running))
                .setContentIntent(pending)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIFICATION_ID, notification);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, getString(R.string.app_name), NotificationManager.IMPORTANCE_LOW);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(channel);
    }
}
