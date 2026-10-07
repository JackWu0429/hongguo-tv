package rocks.aston.hongguotv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.Gravity;
import android.webkit.JavascriptInterface;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

/** Native update transport and installation. No repository credentials enter the APK. */
final class AppUpdater {
    interface Host {
        boolean trusted();
        boolean foreground();
        void restoreFocus();
        void allowPrompt(PromptCheck check);
    }
    interface PromptCheck { void result(boolean allowed); }
    private final Activity activity;
    private final Host host;
    private final SharedPreferences preferences;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicInteger generation = new AtomicInteger();
    private final File directory, partial, apk;
    private volatile HttpURLConnection connection;
    private volatile boolean destroyed;
    private volatile String snapshot = "{}";
    private boolean started, checking, downloading, promptAllowed, manualPrompt, waitingPermission, promptCheckPending;
    private Manifest latest;
    private String state = "idle", message = "", proxy;
    private long downloaded;
    private AlertDialog dialog;
    private ProgressBar progress;
    private TextView progressText;

    AppUpdater(Activity activity, Host host) {
        this.activity = activity; this.host = host;
        preferences = activity.getSharedPreferences("HongguoTVUpdates", Activity.MODE_PRIVATE);
        proxy = preferences.getString("proxy", UpdatePolicy.DEFAULT_PROXY);
        try { proxy = UpdatePolicy.proxyPrefix(proxy); } catch (IllegalArgumentException invalid) { proxy = UpdatePolicy.DEFAULT_PROXY; }
        directory = new File(activity.getCacheDir(), "app-updates");
        partial = new File(directory, "update.part"); apk = new File(directory, "update.apk");
        try { latest = new Manifest(new JSONObject(preferences.getString("manifest", "{}")), activity.getPackageName()); }
        catch (Exception invalid) { latest = null; }
        if (latest != null && latest.code > BuildConfig.VERSION_CODE && latest.minSdk <= Build.VERSION.SDK_INT) state = "available";
        publish();
    }

    private static final class Manifest {
        final int code, minSdk;
        final long bytes;
        final String name, packageName, sha256, url, notes;
        final JSONObject json;
        Manifest(JSONObject json, String installedPackage) throws Exception {
            if (json.getInt("schema") != 1) throw new IOException("不支持的版本信息格式");
            this.json = json;
            code = json.getInt("version_code"); minSdk = json.getInt("min_sdk");
            name = json.getString("version_name"); packageName = json.getString("package_name");
            bytes = json.getLong("size"); sha256 = json.getString("sha256").toLowerCase(java.util.Locale.ROOT);
            url = json.getString("download_url"); notes = json.optString("release_notes", "");
            UpdatePolicy.validate(packageName, code, name, minSdk, bytes, sha256, url, installedPackage, BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME);
            if (notes.length() > 16000) throw new IOException("版本说明过长");
        }
    }

    final class Bridge {
        @JavascriptInterface public String getStatus() { return host.trusted() ? snapshot : "{}"; }
        @JavascriptInterface public void check() { if (host.trusted()) activity.runOnUiThread(() -> checkNow(true)); }
        @JavascriptInterface public void configure() { if (host.trusted()) activity.runOnUiThread(() -> configureSource()); }
        @JavascriptInterface public void setPromptAllowed(boolean allowed) {
            if (host.trusted()) activity.runOnUiThread(() -> { promptAllowed = allowed; maybePrompt(); });
        }
    }

    void start() {
        if (started || destroyed) return;
        started = true;
        worker.execute(this::cleanupCache);
        if (BuildConfig.DEBUG) { state = "unsupported"; message = "调试版不覆盖更新，请使用正式版"; publish(); return; }
        long now = System.currentTimeMillis();
        if (UpdatePolicy.automaticCheckDue(now, preferences.getLong("last_auto_attempt", 0))) {
            preferences.edit().putLong("last_auto_attempt", now).apply();
            checkNow(false);
        }
    }

    private void cleanupCache() {
        directory.mkdirs();
        partial.delete();
        if (!apk.isFile()) return;
        PackageInfo info = activity.getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
        if (info == null || info.versionCode <= BuildConfig.VERSION_CODE
                || System.currentTimeMillis() - apk.lastModified() > UpdatePolicy.CHECK_INTERVAL) apk.delete();
    }

    private void checkNow(boolean manual) {
        if (destroyed || downloading || checking || BuildConfig.DEBUG) return;
        checking = true; manualPrompt = manual; state = "checking"; message = "正在检查更新…"; publish();
        final int epoch = generation.incrementAndGet();
        final String selectedProxy = proxy;
        worker.execute(() -> {
            Manifest result = null;
            String error = "暂时无法连接更新服务，请稍后重试";
            String origin = UpdatePolicy.MANIFEST + "?check=" + System.currentTimeMillis();
            for (String source : UpdatePolicy.sources(origin, selectedProxy)) {
                if (!valid(epoch)) return;
                try {
                    result = new Manifest(new JSONObject(readManifest(source, epoch)), activity.getPackageName());
                    break;
                } catch (Exception failure) { error = friendly(failure); }
            }
            final Manifest response = result;
            final String failure = error;
            activity.runOnUiThread(() -> {
                if (!valid(epoch)) return;
                checking = false;
                if (response == null) { state = "error"; message = "检查失败：" + failure; publish(); return; }
                latest = response;
                preferences.edit().putString("manifest", response.json.toString()).apply();
                if (response.minSdk > Build.VERSION.SDK_INT) { state = "incompatible"; message = "新版本需要更高版本的 Android"; }
                else if (response.code > BuildConfig.VERSION_CODE) { state = "available"; message = "发现新版本 " + response.name; }
                else { state = "current"; message = "已是最新版本"; }
                publish(); maybePrompt();
            });
        });
    }

    private String readManifest(String source, int epoch) throws Exception {
        HttpURLConnection request = open(source, epoch);
        try (InputStream stream = request.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = stream.read(buffer)) != -1) {
                ensureValid(epoch);
                if (output.size() + count > 65536) throw new IOException("版本信息超过大小限制");
                output.write(buffer, 0, count);
            }
            return output.toString("UTF-8");
        } finally { request.disconnect(); if (connection == request) connection = null; }
    }

    private HttpURLConnection open(String source, int epoch) throws Exception {
        URL url = new URL(source);
        for (int redirect = 0; redirect < 6; redirect++) {
            ensureValid(epoch);
            if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null) throw new IOException("更新连接必须使用 HTTPS");
            HttpURLConnection request = (HttpURLConnection) url.openConnection();
            connection = request;
            request.setConnectTimeout(8000); request.setReadTimeout(15000);
            request.setInstanceFollowRedirects(false); request.setUseCaches(false);
            request.setRequestProperty("Cache-Control", "no-cache");
            request.setRequestProperty("Accept-Encoding", "identity");
            request.setRequestProperty("User-Agent", "HongguoTV/" + BuildConfig.VERSION_NAME);
            int code;
            try { code = request.getResponseCode(); }
            catch (Exception failure) { request.disconnect(); throw failure; }
            ensureValid(epoch);
            if (code >= 300 && code <= 399) {
                String location = request.getHeaderField("Location"); request.disconnect();
                if (location == null) throw new IOException("下载重定向缺少地址");
                url = new URL(url, location); continue;
            }
            if (code != 200) { request.disconnect(); throw new IOException("更新服务返回 HTTP " + code); }
            return request;
        }
        throw new IOException("更新连接重定向次数过多");
    }

    private boolean canShow() {
        return !destroyed && host.foreground() && host.trusted() && promptAllowed
                && !activity.isFinishing() && !activity.isDestroyed() && dialog == null;
    }

    private void maybePrompt() {
        if (!"available".equals(state) || latest == null || !canShow() || promptCheckPending) return;
        if (!manualPrompt && preferences.getInt("dismissed_code", 0) >= latest.code) return;
        final Manifest target = latest;
        promptCheckPending = true;
        host.allowPrompt(allowed -> {
            promptCheckPending = false;
            if (!allowed || !canShow() || target != latest || !"available".equals(state)) return;
            manualPrompt = false;
            AlertDialog prompt = new AlertDialog.Builder(activity).setTitle("发现新版本 " + target.name)
                .setMessage((target.notes.isEmpty() ? "红果短剧有新版本可以安装。" : target.notes) + "\n\n覆盖升级保留账号和记录。")
                .setNegativeButton("稍后", (d, which) -> defer(target))
                .setPositiveButton("立即更新", (d, which) -> beginDownload(target)).create();
            prompt.setOnCancelListener(d -> defer(target));
            show(prompt, AlertDialog.BUTTON_NEGATIVE);
        });
    }

    private void defer(Manifest target) {
        preferences.edit().putInt("dismissed_code", target.code).apply();
    }

    private void show(AlertDialog next, int focusButton) {
        dialog = next;
        next.setOnShowListener(d -> next.getButton(focusButton).requestFocus());
        next.setOnDismissListener(d -> {
            if (dialog == next) dialog = null;
            if (!destroyed) host.restoreFocus();
        });
        next.show();
    }

    private void beginDownload(Manifest target) {
        // The confirmation is dismissed by Android after its click listener returns.
        activity.getWindow().getDecorView().post(() -> {
            if (destroyed || downloading) return;
            if (dialog != null) { AlertDialog old = dialog; dialog = null; old.dismiss(); }
            downloading = true; downloaded = 0; state = "downloading"; message = "正在下载 " + target.name; publish();
            final int epoch = generation.incrementAndGet();
            showDownloadProgress();
            final String selectedProxy = proxy;
            worker.execute(() -> download(target, selectedProxy, epoch));
        });
    }

    private void showDownloadProgress() {
        LinearLayout panel = new LinearLayout(activity); panel.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(24 * activity.getResources().getDisplayMetrics().density);
        panel.setPadding(padding, padding, padding, padding);
        progressText = new TextView(activity); progressText.setText("正在连接下载服务…"); progressText.setTextSize(17);
        progress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100); progress.setIndeterminate(true);
        panel.addView(progressText); panel.addView(progress, new LinearLayout.LayoutParams(-1, -2));
        AlertDialog next = new AlertDialog.Builder(activity).setTitle("下载更新").setView(panel)
                .setNegativeButton("取消", (d, which) -> cancelDownload()).create();
        next.setOnCancelListener(d -> cancelDownload());
        show(next, AlertDialog.BUTTON_NEGATIVE);
    }

    private void download(Manifest target, String selectedProxy, int epoch) {
        String error = "下载暂时不可用";
        try {
            directory.mkdirs();
            if (apk.isFile() && apk.length() == target.bytes && hash(apk).equals(target.sha256)) {
                verifyArchive(target, apk); completed(target, epoch); return;
            }
            apk.delete();
            String[] sources = UpdatePolicy.sources(target.url, selectedProxy);
            for (int sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
                String source = sources[sourceIndex];
                ensureValid(epoch);
                partial.delete();
                final boolean fallback = sourceIndex > 0;
                activity.runOnUiThread(() -> {
                    if (!valid(epoch)) return;
                    downloaded = 0; message = fallback ? "代理下载失败，正在尝试 GitHub 直连…" : "正在连接下载服务…"; publish();
                    if (progress != null) progress.setIndeterminate(true);
                    if (progressText != null) progressText.setText(message);
                });
                try {
                    HttpURLConnection request = open(source, epoch);
                    try (InputStream stream = request.getInputStream()) {
                        long length = -1;
                        String lengthHeader = request.getHeaderField("Content-Length");
                        if (lengthHeader != null) length = Long.parseLong(lengthHeader);
                        if (length > 0 && length != target.bytes) throw new IOException("安装包大小不匹配");
                        UpdateFiles.copyChecked(stream, partial, target.bytes, target.sha256, new UpdateFiles.Monitor() {
                            private long lastProgress;
                            public void check() throws IOException { ensureValid(epoch); }
                            public void progress(long bytes) {
                                long now = android.os.SystemClock.elapsedRealtime();
                                if (now - lastProgress > 250) { updateProgress(bytes, target.bytes, epoch); lastProgress = now; }
                            }
                        });
                    } finally { request.disconnect(); if (connection == request) connection = null; }
                    ensureValid(epoch);
                    verifyArchive(target, partial);
                    if (!partial.renameTo(apk)) throw new IOException("无法保存更新安装包");
                    completed(target, epoch); return;
                } catch (Exception failure) { partial.delete(); error = friendly(failure); }
            }
            throw new IOException(error);
        } catch (Exception failure) {
            partial.delete();
            apk.delete();
            final String text = friendly(failure);
            activity.runOnUiThread(() -> {
                if (!valid(epoch)) return;
                downloading = false; dismissDialog(); state = "error"; message = "下载失败：" + text; publish();
                showFailure(message);
            });
        }
    }

    private void completed(Manifest target, int epoch) {
        activity.runOnUiThread(() -> {
            if (!valid(epoch)) return;
            downloading = false; downloaded = target.bytes; state = "ready"; message = "安装包已验证，可以安装";
            latest = target; dismissDialog(); publish();
            if (host.foreground() && host.trusted()) launchInstaller(target);
        });
    }

    private void updateProgress(long bytes, long total, int epoch) {
        activity.runOnUiThread(() -> {
            if (!valid(epoch) || !downloading) return;
            downloaded = bytes; publish();
            if (progress != null) { progress.setIndeterminate(false); progress.setProgress((int) (bytes * 100 / total)); }
            if (progressText != null) progressText.setText(String.format(java.util.Locale.ROOT,
                    "已下载 %.1f / %.1f MB · %d%%", bytes / 1048576.0, total / 1048576.0, bytes * 100 / total));
        });
    }

    private void verifyArchive(Manifest target, File file) throws Exception {
        PackageManager manager = activity.getPackageManager();
        PackageInfo archive = manager.getPackageArchiveInfo(file.getPath(), PackageManager.GET_SIGNATURES);
        PackageInfo installed = manager.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNATURES);
        if (archive == null || !UpdatePolicy.matchingArchive(installed.packageName, installed.versionCode,
                archive.packageName, archive.versionCode, archive.versionName, target.code, target.name,
                signerHashes(installed.signatures), signerHashes(archive.signatures)))
            throw new IOException("安装包的应用、版本或签名不匹配，已停止安装");
        if (Build.VERSION.SDK_INT >= 24 && archive.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT)
            throw new IOException("设备 Android 版本不满足安装要求");
    }

    private String[] signerHashes(Signature[] signatures) throws Exception {
        if (signatures == null) return new String[0];
        String[] result = new String[signatures.length];
        for (int i = 0; i < signatures.length; i++) result[i] = UpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(signatures[i].toByteArray()));
        return result;
    }

    private String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[32768]; int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return UpdatePolicy.hex(digest.digest());
    }

    private void launchInstaller(Manifest target) {
        if (!apk.isFile() || apk.length() != target.bytes || destroyed) return;
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
            AlertDialog permission = new AlertDialog.Builder(activity).setTitle("允许安装更新")
                    .setMessage("请在系统设置中允许红果短剧安装更新，随后返回继续安装。")
                    .setNegativeButton("稍后", null).setPositiveButton("去设置", (d, which) -> {
                        try {
                            waitingPermission = true;
                            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                        } catch (Exception failure) { waitingPermission = false; message = "设备无法打开安装权限设置"; publish(); }
                    }).create();
            show(permission, AlertDialog.BUTTON_NEGATIVE); return;
        }
        try {
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(Uri.parse("content://" + activity.getPackageName() + ".updates/apk"), "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(install);
        } catch (Exception failure) { message = "设备无法打开系统安装界面"; publish(); showFailure(message); }
    }

    void resume() {
        if (destroyed) return;
        if (waitingPermission) {
            waitingPermission = false;
            if (Build.VERSION.SDK_INT >= 26 && activity.getPackageManager().canRequestPackageInstalls()
                    && latest != null && "ready".equals(state)) {
                final Manifest target = latest;
                host.allowPrompt(allowed -> { if (allowed && !destroyed && host.foreground() && target == latest) launchInstaller(target); });
            }
        }
        publish();
    }

    private void configureSource() {
        if (!host.foreground() || downloading || checking || dialog != null) return;
        EditText input = new EditText(activity); input.setSingleLine(true); input.setText(proxy);
        input.setHint("https://ghfast.top/，留空为直连"); input.setTextSize(17); input.setSelectAllOnFocus(true);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        LinearLayout panel = new LinearLayout(activity); panel.setOrientation(LinearLayout.VERTICAL); panel.setGravity(Gravity.CENTER);
        int pad = Math.round(20 * activity.getResources().getDisplayMetrics().density); panel.setPadding(pad, pad, pad, pad);
        panel.addView(input, new LinearLayout.LayoutParams(-1, -2));
        AlertDialog next = new AlertDialog.Builder(activity).setTitle("下载代理")
                .setMessage("代理连接失败时自动尝试 GitHub 直连。留空则始终直连。")
                .setView(panel).setNegativeButton("取消", null).setPositiveButton("保存", (d, which) -> {
                    try { proxy = UpdatePolicy.proxyPrefix(input.getText().toString()); preferences.edit().putString("proxy", proxy).apply(); publish(); }
                    catch (Exception failure) { message = friendly(failure); publish(); }
                }).create();
        show(next, AlertDialog.BUTTON_POSITIVE);
        // Keep D-pad navigation available without requiring a touch keyboard.
        input.setOnKeyListener((view, key, event) -> {
            if (key == android.view.KeyEvent.KEYCODE_DPAD_DOWN && event.getAction() == android.view.KeyEvent.ACTION_DOWN) {
                android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager) activity.getSystemService(Activity.INPUT_METHOD_SERVICE);
                if (keyboard != null) keyboard.hideSoftInputFromWindow(input.getWindowToken(), 0);
                next.getButton(AlertDialog.BUTTON_POSITIVE).requestFocus(); return true;
            }
            return false;
        });
    }

    private void showFailure(String text) {
        if (!host.foreground() || destroyed || dialog != null) return;
        show(new AlertDialog.Builder(activity).setTitle("更新未完成").setMessage(text)
                .setPositiveButton("知道了", null).create(), AlertDialog.BUTTON_POSITIVE);
    }

    private void cancelDownload() {
        generation.incrementAndGet();
        HttpURLConnection active = connection; if (active != null) active.disconnect();
        downloading = false; state = latest == null ? "idle" : "available"; message = "已取消下载";
        if (latest != null) defer(latest);
        publish();
    }

    boolean back() {
        if (dialog == null || !dialog.isShowing()) return false;
        dialog.cancel(); return true;
    }

    private void dismissDialog() {
        if (dialog != null) { AlertDialog old = dialog; dialog = null; old.dismiss(); }
        progress = null; progressText = null;
    }

    private boolean valid(int epoch) { return !destroyed && generation.get() == epoch; }
    private void ensureValid(int epoch) throws IOException { if (!valid(epoch)) throw new IOException("更新操作已取消"); }
    private String friendly(Exception error) {
        if (error instanceof java.net.SocketTimeoutException) return "连接超时，可重试或更换下载代理";
        if (error instanceof java.net.UnknownHostException) return "无法连接下载地址，可更换下载代理";
        return error.getMessage() == null ? "网络或文件校验失败" : error.getMessage();
    }

    private void publish() {
        try {
            JSONObject value = new JSONObject();
            value.put("supported", !BuildConfig.DEBUG); value.put("current_version", BuildConfig.VERSION_NAME);
            value.put("current_code", BuildConfig.VERSION_CODE); value.put("state", state); value.put("message", message);
            value.put("proxy", proxy); value.put("downloaded", downloaded);
            value.put("latest_version", latest == null ? "" : latest.name);
            value.put("latest_code", latest == null ? 0 : latest.code);
            value.put("size", latest == null ? 0 : latest.bytes); snapshot = value.toString();
        } catch (Exception ignored) { /* Keep the last complete status. */ }
    }

    void destroy() {
        destroyed = true; generation.incrementAndGet();
        HttpURLConnection active = connection; if (active != null) active.disconnect();
        dismissDialog(); worker.shutdownNow();
    }
}
