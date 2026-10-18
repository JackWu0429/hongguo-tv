package rocks.aston.hongguotv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import androidx.tvprovider.media.tv.TvContractCompat;

public final class TvHomeChannelReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Build.VERSION.SDK_INT < 26 || intent == null) return;
        String action = intent.getAction();
        if (TvContractCompat.ACTION_INITIALIZE_PROGRAMS.equals(action)) {
            runAsync("hongguo-tv-channel-init", () -> TvHomeChannelManager.ensureDefaultChannel(context));
        } else if (TvContractCompat.ACTION_PREVIEW_PROGRAM_BROWSABLE_DISABLED.equals(action)) {
            runAsync("hongguo-tv-channel-remove", () -> TvHomeChannelManager.removeProgram(context, intent));
        }
    }

    private void runAsync(String threadName, Runnable work) {
        PendingResult pending = goAsync();
        HandlerThread worker = new HandlerThread(threadName);
        worker.start();
        new Handler(worker.getLooper()).post(() -> {
            try { work.run(); }
            finally { pending.finish(); worker.quitSafely(); }
        });
    }
}
