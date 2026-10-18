package rocks.aston.hongguotv;

import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.provider.BaseColumns;
import android.text.TextUtils;
import android.util.Log;
import android.annotation.SuppressLint;
import androidx.tvprovider.media.tv.ChannelLogoUtils;
import androidx.tvprovider.media.tv.PreviewProgram;
import androidx.tvprovider.media.tv.TvContractCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;

final class TvHomeChannelManager {
    private static final String TAG = "TvHomeChannel";
    private static final String PREFS = "tv_home_channel";
    private static final String CHANNEL_INTERNAL_ID = "hongguo-picks-v1";
    private static final String CHANNEL_NAME = "红果精选";
    private static final String SUPPRESSED_PREFIX = "suppressed_";
    private static final String PROGRAM_ROW_PREFIX = "program_row_";
    private static final String BROWSE_REQUEST_PREFIX = "browse_requested_";
    // AndroidX exposes these PreviewProgram column names through restricted
    // interfaces; the provider contract values are stable public strings.
    private static final String PROGRAM_INTERNAL_ID_COLUMN = "internal_provider_id";
    private static final Object PROVIDER_LOCK = new Object();
    private static final String[] CHANNEL_COLUMNS = {
            BaseColumns._ID,
            TvContractCompat.Channels.COLUMN_PACKAGE_NAME,
            TvContractCompat.Channels.COLUMN_INTERNAL_PROVIDER_ID
    };
    private static final String[] PROGRAM_COLUMNS = {
            BaseColumns._ID,
            PROGRAM_INTERNAL_ID_COLUMN
    };

    private final Context context;
    private final HandlerThread worker;
    private final Handler handler;
    private final Runnable syncTask = this::runPendingSync;
    private String pendingJson;

    TvHomeChannelManager(Context context) {
        this.context = context.getApplicationContext();
        if (HomeChannelPolicy.supported(Build.VERSION.SDK_INT)) {
            worker = new HandlerThread("hongguo-tv-home-channel");
            worker.start();
            handler = new Handler(worker.getLooper());
        } else {
            worker = null;
            handler = null;
        }
    }

    void ensureDefaultChannel(boolean requestBrowsable) {
        if (handler != null) handler.post(() -> ensureDefaultChannel(context, requestBrowsable));
    }

    void syncRecommendations(String json) {
        if (handler == null || json == null || json.length() > 65536) return;
        synchronized (this) {
            pendingJson = json;
            handler.removeCallbacks(syncTask);
            handler.post(syncTask);
        }
    }

    void destroy() {
        if (worker != null) worker.quitSafely();
    }

    private void runPendingSync() {
        final String json;
        synchronized (this) {
            json = pendingJson;
            pendingJson = null;
        }
        if (json == null) return;
        try {
            syncNow(new JSONArray(json));
        } catch (Exception error) {
            Log.w(TAG, "Ignoring invalid recommendation payload", error);
        }
    }

    static void ensureDefaultChannel(Context context) {
        ensureDefaultChannel(context, false);
    }

    private static void ensureDefaultChannel(Context context, boolean requestBrowsable) {
        if (Build.VERSION.SDK_INT < 26) return;
        synchronized (PROVIDER_LOCK) {
            try {
                long existing = findChannel(context);
                if (existing > 0) {
                    if (requestBrowsable) requestBrowsableOnce(context, existing);
                    return;
                }
                Intent appLink = new Intent(Intent.ACTION_VIEW, Uri.parse("hongguo://home"))
                        .setClass(context, MainActivity.class);
                ContentValues values = new ContentValues();
                values.put(TvContractCompat.Channels.COLUMN_TYPE, TvContractCompat.Channels.TYPE_PREVIEW);
                values.put(TvContractCompat.Channels.COLUMN_DISPLAY_NAME, CHANNEL_NAME);
                values.put(TvContractCompat.Channels.COLUMN_APP_LINK_INTENT_URI, appLink.toUri(Intent.URI_INTENT_SCHEME));
                values.put(TvContractCompat.Channels.COLUMN_INTERNAL_PROVIDER_ID, CHANNEL_INTERNAL_ID);
                Uri channelUri = context.getContentResolver().insert(TvContractCompat.Channels.CONTENT_URI, values);
                if (channelUri == null) return;
                long channelId = ContentUris.parseId(channelUri);
                ChannelLogoUtils.storeChannelLogo(context, channelId, channelLogo(context));
                if (requestBrowsable) requestBrowsableOnce(context, channelId);
            } catch (SecurityException | IllegalArgumentException error) {
                Log.w(TAG, "TV provider rejected channel creation", error);
            } catch (RuntimeException error) {
                Log.w(TAG, "TV provider unavailable", error);
            }
        }
    }

    private static void requestBrowsableOnce(Context context, long channelId) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String key = BROWSE_REQUEST_PREFIX + channelId;
        if (preferences.getBoolean(key, false)) return;
        TvContractCompat.requestChannelBrowsable(context, channelId);
        preferences.edit().putBoolean(key, true).commit();
    }

    static JSONObject parseLaunchIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return null;
        Uri uri = intent.getData();
        if (uri == null || !"hongguo".equals(uri.getScheme()) || !"play".equals(uri.getHost())) return null;
        String seriesId = uri.getQueryParameter("series_id");
        if (!HomeChannelPolicy.validSeriesId(seriesId)) return null;
        JSONObject launch = new JSONObject();
        try {
            launch.put("series_id", seriesId);
            launch.put("title", cleanText(uri.getQueryParameter("title"), 120));
            return launch;
        } catch (Exception ignored) {
            return null;
        }
    }

    static void removeProgram(Context context, Intent intent) {
        if (Build.VERSION.SDK_INT < 26 || intent == null) return;
        long programId = intent.getLongExtra(TvContractCompat.EXTRA_PREVIEW_PROGRAM_ID, -1);
        if (programId <= 0) return;
        synchronized (PROVIDER_LOCK) {
            SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String rowKey = PROGRAM_ROW_PREFIX + programId;
            String seriesId = preferences.getString(rowKey, "");
            if (HomeChannelPolicy.validSeriesId(seriesId)) {
                preferences.edit().putBoolean(SUPPRESSED_PREFIX + seriesId, true).remove(rowKey).commit();
            }
            try {
                context.getContentResolver().delete(TvContractCompat.buildPreviewProgramUri(programId), null, null);
            } catch (RuntimeException error) {
                Log.w(TAG, "Unable to delete removed home-screen program", error);
            }
        }
    }

    private void syncNow(JSONArray source) {
        synchronized (PROVIDER_LOCK) {
            try {
                long channelId = findChannel(context);
                if (channelId <= 0) {
                    ensureDefaultChannel(context);
                    channelId = findChannel(context);
                }
                if (channelId <= 0) return;
                SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                LinkedHashMap<String, JSONObject> desired = parsePrograms(source, preferences);
                Map<String, Long> existing = readPrograms(context, channelId);
                if (existing == null) return;
                for (Map.Entry<String, Long> row : existing.entrySet()) {
                    JSONObject item = desired.remove(row.getKey());
                    if (item == null) {
                        context.getContentResolver().delete(TvContractCompat.buildPreviewProgramUri(row.getValue()), null, null);
                        preferences.edit().remove(PROGRAM_ROW_PREFIX + row.getValue()).commit();
                    } else {
                        ContentValues values = programValues(context, channelId, item);
                        context.getContentResolver().update(TvContractCompat.buildPreviewProgramUri(row.getValue()), values, null, null);
                        preferences.edit().putString(PROGRAM_ROW_PREFIX + row.getValue(), row.getKey()).commit();
                    }
                }
                for (Map.Entry<String, JSONObject> row : desired.entrySet()) {
                    Uri inserted = context.getContentResolver().insert(TvContractCompat.PreviewPrograms.CONTENT_URI,
                            programValues(context, channelId, row.getValue()));
                    if (inserted != null) {
                        preferences.edit().putString(PROGRAM_ROW_PREFIX + ContentUris.parseId(inserted), row.getKey()).commit();
                    }
                }
            } catch (SecurityException | IllegalArgumentException error) {
                Log.w(TAG, "TV provider rejected recommendation update", error);
            } catch (RuntimeException error) {
                Log.w(TAG, "TV provider unavailable during recommendation update", error);
            }
        }
    }

    private static LinkedHashMap<String, JSONObject> parsePrograms(JSONArray source, SharedPreferences preferences) {
        LinkedHashMap<String, JSONObject> result = new LinkedHashMap<>();
        for (int i = 0; i < source.length() && result.size() < HomeChannelPolicy.MAX_PROGRAMS; i++) {
            JSONObject item = source.optJSONObject(i);
            if (item == null) continue;
            String seriesId = item.optString("series_id", "").trim();
            if (!HomeChannelPolicy.validSeriesId(seriesId) || result.containsKey(seriesId) ||
                    preferences.getBoolean(SUPPRESSED_PREFIX + seriesId, false)) continue;
            String cover = safeImageUrl(item.optString("cover_fallback", ""));
            if (cover.length() == 0) cover = safeImageUrl(item.optString("cover", ""));
            if (cover.length() == 0) continue;
            JSONObject safe = new JSONObject();
            try {
                safe.put("series_id", seriesId);
                safe.put("title", cleanText(item.optString("title", ""), 120));
                safe.put("intro", cleanText(item.optString("intro", ""), 320));
                safe.put("cover", cover);
                result.put(seriesId, safe);
            } catch (Exception ignored) { }
        }
        return result;
    }

    private static Map<String, Long> readPrograms(Context context, long channelId) {
        Map<String, Long> result = new LinkedHashMap<>();
        Uri programs = TvContractCompat.buildPreviewProgramsUriForChannel(channelId);
        try (Cursor cursor = context.getContentResolver().query(programs, PROGRAM_COLUMNS, null, null, null)) {
            if (cursor == null) return null;
            int idColumn = cursor.getColumnIndexOrThrow(BaseColumns._ID);
            int internalColumn = cursor.getColumnIndexOrThrow(PROGRAM_INTERNAL_ID_COLUMN);
            while (cursor.moveToNext()) {
                String internalId = cursor.getString(internalColumn);
                if (internalId != null && internalId.startsWith("series:")) {
                    String seriesId = internalId.substring("series:".length());
                    if (HomeChannelPolicy.validSeriesId(seriesId)) result.put(seriesId, cursor.getLong(idColumn));
                }
            }
            return result;
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to read TV channel programs", error);
            return null;
        }
    }

    private static long findChannel(Context context) {
        try (Cursor cursor = context.getContentResolver().query(TvContractCompat.Channels.CONTENT_URI,
                CHANNEL_COLUMNS, null, null, null)) {
            if (cursor == null) return -1;
            int idColumn = cursor.getColumnIndexOrThrow(BaseColumns._ID);
            int packageColumn = cursor.getColumnIndexOrThrow(TvContractCompat.Channels.COLUMN_PACKAGE_NAME);
            int internalColumn = cursor.getColumnIndexOrThrow(TvContractCompat.Channels.COLUMN_INTERNAL_PROVIDER_ID);
            while (cursor.moveToNext()) {
                if (context.getPackageName().equals(cursor.getString(packageColumn)) &&
                        CHANNEL_INTERNAL_ID.equals(cursor.getString(internalColumn))) return cursor.getLong(idColumn);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to find TV channel", error);
        }
        return -1;
    }

    @SuppressLint({"WrongConstant", "RestrictedApi"})
    private static ContentValues programValues(Context context, long channelId, JSONObject item) {
        String seriesId = item.optString("series_id");
        Uri playUri = Uri.parse("hongguo://play").buildUpon()
                .appendQueryParameter("series_id", seriesId)
                .appendQueryParameter("title", item.optString("title"))
                .build();
        Intent playIntent = new Intent(Intent.ACTION_VIEW, playUri);
        // TYPE_CLIP and ASPECT_RATIO_2_3 are the Android TV provider's public
        // contract values. Using the builder avoids restricted raw-column APIs.
        PreviewProgram program = new PreviewProgram.Builder()
                .setChannelId(channelId)
                .setType(4)
                .setTitle(TextUtils.isEmpty(item.optString("title")) ? CHANNEL_NAME : item.optString("title"))
                .setDescription(item.optString("intro"))
                .setPosterArtUri(Uri.parse(item.optString("cover")))
                .setPosterArtAspectRatio(4)
                .setIntent(playIntent.setClass(context, MainActivity.class))
                .setInternalProviderId("series:" + seriesId)
                .setBrowsable(true)
                .build();
        return program.toContentValues();
    }

    private static String safeImageUrl(String value) {
        if (value == null || value.length() > 4096) return "";
        Uri uri = Uri.parse(value.trim());
        return "https".equalsIgnoreCase(uri.getScheme()) && !TextUtils.isEmpty(uri.getHost()) && uri.getUserInfo() == null
                ? uri.toString() : "";
    }

    private static String cleanText(String value, int limit) {
        if (value == null) return "";
        String clean = value.replace('\n', ' ').replace('\r', ' ').trim();
        return clean.length() <= limit ? clean : clean.substring(0, limit);
    }

    private static Bitmap channelLogo(Context context) {
        int size = Math.max(80, Math.round(80 * context.getResources().getDisplayMetrics().density));
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(0xFFF35D7B);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(0xFFFFFFFF);
        Path triangle = new Path();
        triangle.moveTo(size * 0.39f, size * 0.28f);
        triangle.lineTo(size * 0.68f, size * 0.5f);
        triangle.lineTo(size * 0.39f, size * 0.72f);
        triangle.close();
        canvas.drawPath(triangle, paint);
        return bitmap;
    }
}
