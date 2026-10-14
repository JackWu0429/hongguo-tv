package rocks.aston.hongguowasmdiag;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.content.pm.PackageInfo;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

public final class WasmDiagnosticActivity extends Activity {
    private static final String TEST_HOST = "wasm-diagnostic.test";
    private final AtomicInteger rangeRequests = new AtomicInteger();
    private WebView webView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        applyFullscreen();
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.addJavascriptInterface(new DiagnosticBridge(), "HongguoWasmDiag");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null || !TEST_HOST.equals(request.getUrl().getHost())) {
                    return response(403, "Forbidden", "text/plain", "external request blocked".getBytes());
                }
                String range = null;
                for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                    if ("range".equalsIgnoreCase(header.getKey())) range = header.getValue();
                }
                return serveAsset(request.getUrl().getPath(), range);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request == null || request.getUrl() == null || !TEST_HOST.equals(request.getUrl().getHost());
            }
        });
        setContentView(webView);
        webView.loadUrl("https://" + TEST_HOST + "/index.html");
    }

    private WebResourceResponse serveAsset(String path, String range) {
        String relative = "www" + (path == null ? "/index.html" : path);
        byte[] data;
        try (InputStream input = getAssets().open(relative); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            data = output.toByteArray();
        } catch (Exception missing) {
            return response(404, "Not Found", "text/plain", "missing test asset".getBytes());
        }

        int status = 200;
        String reason = "OK";
        int offset = 0;
        int length = data.length;
        Map<String, String> headers = Collections.singletonMap("Cache-Control", "no-store");
        if (range != null && path != null && path.startsWith("/samples/")) {
            int[] bounds = parseRange(range, data.length);
            if (bounds == null) {
                return new WebResourceResponse("video/mp4", null, 416, "Range Not Satisfiable",
                        Collections.singletonMap("Content-Range", "bytes */" + data.length),
                        new ByteArrayInputStream(new byte[0]));
            }
            offset = bounds[0];
            length = bounds[1] - offset + 1;
            status = 206;
            reason = "Partial Content";
            rangeRequests.incrementAndGet();
            java.util.HashMap<String, String> partial = new java.util.HashMap<>();
            partial.put("Accept-Ranges", "bytes");
            partial.put("Content-Range", "bytes " + offset + "-" + (offset + length - 1) + "/" + data.length);
            partial.put("Content-Length", String.valueOf(length));
            partial.put("Cache-Control", "no-store");
            headers = partial;
        }
        String mime = mimeFor(path);
        return new WebResourceResponse(mime, null, status, reason, headers,
                new ByteArrayInputStream(data, offset, length));
    }

    private static int[] parseRange(String header, int total) {
        if (header == null || !header.startsWith("bytes=")) return null;
        String[] parts = header.substring(6).split("-", 2);
        try {
            int start = Integer.parseInt(parts[0]);
            int end = parts.length > 1 && !parts[1].isEmpty() ? Integer.parseInt(parts[1]) : total - 1;
            if (start < 0 || start >= total || end < start) return null;
            return new int[]{start, Math.min(end, total - 1)};
        } catch (Exception invalid) {
            return null;
        }
    }

    private static String mimeFor(String path) {
        if (path == null) return "application/octet-stream";
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".mp4")) return "video/mp4";
        return "application/octet-stream";
    }

    private static WebResourceResponse response(int status, String reason, String mime, byte[] body) {
        return new WebResourceResponse(mime, "UTF-8", status, reason,
                Collections.<String, String>emptyMap(), new ByteArrayInputStream(body));
    }

    private void applyFullscreen() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyFullscreen();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class DiagnosticBridge {
        @JavascriptInterface
        public String getDeviceInfo() {
            JSONObject result = new JSONObject();
            try {
                result.put("manufacturer", Build.MANUFACTURER);
                result.put("model", Build.MODEL);
                result.put("android", Build.VERSION.RELEASE);
                result.put("api", Build.VERSION.SDK_INT);
                result.put("abi", Build.VERSION.SDK_INT >= 21 ? Build.SUPPORTED_ABIS[0] : Build.CPU_ABI);
                DisplayMetrics metrics = getResources().getDisplayMetrics();
                result.put("screen", metrics.widthPixels + "x" + metrics.heightPixels);
                PackageInfo info = currentWebViewPackage();
                if (info != null) result.put("webview", info.packageName + " " + info.versionName);
                else result.put("webview", "不可读取");
            } catch (Exception ignored) {
                // Keep the diagnostic useful if one optional package field is unavailable.
            }
            return result.toString();
        }

        @JavascriptInterface
        public int getRangeRequestCount() {
            return rangeRequests.get();
        }
    }

    private PackageInfo currentWebViewPackage() {
        if (Build.VERSION.SDK_INT >= 26) return WebView.getCurrentWebViewPackage();
        String[] candidates = {"com.google.android.webview", "com.android.webview"};
        for (String name : candidates) {
            try {
                return getPackageManager().getPackageInfo(name, 0);
            } catch (Exception ignored) {
                // Try the next system package name.
            }
        }
        return null;
    }
}
