package rocks.aston.hongguotv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.graphics.Color;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.ViewTreeObserver;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private static final String CORE_URL = "http://127.0.0.1:8797/";
    private WebView webView;
    private boolean backPending;
    private boolean activityForeground;
    private AlertDialog exitDialog;
    private boolean keyboardVisible;
    private LinearLayout startupPanel;
    private TextView startupMessage;
    private Button startupRetry;
    private Thread startupThread;
    private boolean destroyed;
    private boolean pageLoadFailed;
    private final Runnable restoreFullscreen = () -> {
        if (activityForeground && hasWindowFocus() && !isFinishing() && !isDestroyed() && !isKeyboardVisible()) {
            applyFullscreen();
        }
    };
    private final ViewTreeObserver.OnGlobalLayoutListener keyboardLayoutListener = () -> {
        boolean visible = isKeyboardVisible();
        if (keyboardVisible && !visible) scheduleFullscreen();
        keyboardVisible = visible;
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        startCoreService();
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF0C0D12);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        WebSettings settings = webView.getSettings();
        settings.setUserAgentString(settings.getUserAgentString() + " HongguoTV-Android");
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Fetch UI assets from the core embedded in this APK after updates.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageLoadFailed = false;
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) { pageLoadFailed = true; showStartupFailure(); }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!pageLoadFailed && url.startsWith(CORE_URL)) startupPanel.setVisibility(View.GONE);
                view.evaluateJavascript("window.HongguoTV && window.HongguoTV." +
                        (activityForeground ? "resumeFromBackground()" : "pauseForBackground()"), null);
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        FrameLayout content = new FrameLayout(this);
        content.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        startupPanel = new LinearLayout(this);
        startupPanel.setOrientation(LinearLayout.VERTICAL);
        startupPanel.setGravity(Gravity.CENTER);
        startupPanel.setBackgroundColor(0xFF0C0D12);
        startupMessage = new TextView(this);
        startupMessage.setTextColor(Color.WHITE);
        startupMessage.setTextSize(22);
        startupPanel.addView(startupMessage);
        startupRetry = new Button(this);
        startupRetry.setText("重试");
        startupRetry.setOnClickListener(view -> { startCoreService(); waitForCore(); });
        startupPanel.addView(startupRetry);
        content.addView(startupPanel, new FrameLayout.LayoutParams(-1, -1));
        setContentView(content);
        View decor = getWindow().getDecorView();
        decor.setOnSystemUiVisibilityChangeListener(visibility -> {
            // Android 6 WebView/IME can clear these flags after the initial launch.
            int hiddenBars = View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION;
            if ((visibility & hiddenBars) != hiddenBars) scheduleFullscreen();
        });
        decor.getViewTreeObserver().addOnGlobalLayoutListener(keyboardLayoutListener);
        applyFullscreen();
        webView.requestFocus(View.FOCUS_DOWN);
        waitForCore();
    }

    private void showStartupFailure() {
        if (destroyed) return;
        startupMessage.setText("本机服务连接失败，请重试");
        startupRetry.setVisibility(View.VISIBLE);
        startupPanel.setVisibility(View.VISIBLE);
        startupRetry.requestFocus();
    }

    private void waitForCore() {
        if (startupThread != null && startupThread.isAlive()) return;
        startupMessage.setText("正在启动红果短剧…");
        startupRetry.setVisibility(View.GONE);
        startupPanel.setVisibility(View.VISIBLE);
        startupThread = new Thread(() -> {
            long deadline = SystemClock.elapsedRealtime() + 30000;
            boolean ready = false;
            while (!Thread.currentThread().isInterrupted() && SystemClock.elapsedRealtime() < deadline) {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(CORE_URL + "api/v1/health").openConnection();
                    connection.setConnectTimeout(1000);
                    connection.setReadTimeout(1000);
                    ready = connection.getResponseCode() == 200;
                } catch (Exception ignored) {
                    // Retry only the local process; no external endpoints here.
                } finally {
                    if (connection != null) connection.disconnect();
                }
                if (ready) break;
                try { Thread.sleep(250); } catch (InterruptedException interrupted) { return; }
            }
            final boolean coreReady = ready;
            runOnUiThread(() -> {
                if (destroyed || isFinishing()) return;
                if (coreReady) { webView.loadUrl(CORE_URL); webView.requestFocus(); }
                else showStartupFailure();
            });
        }, "hongguo-tv-startup");
        startupThread.start();
    }

    private void applyFullscreen() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        View decor = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = decor.getWindowInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            }
        } else {
            // API 19+ immersive mode also works on our minimum version, Android 6 (API 23).
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN |
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    private void scheduleFullscreen() {
        View decor = getWindow().getDecorView();
        decor.removeCallbacks(restoreFullscreen);
        decor.post(restoreFullscreen);
    }

    private boolean isKeyboardVisible() {
        View decor = getWindow().getDecorView();
        Rect visibleFrame = new Rect();
        decor.getWindowVisibleDisplayFrame(visibleFrame);
        int height = decor.getRootView().getHeight();
        return height > 0 && height - visibleFrame.height() > height / 4;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && activityForeground) applyFullscreen();
    }

    private void startCoreService() {
        Intent intent = new Intent(this, CoreService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
        else startService(intent);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) requestPageBack();
            return true;
        }
        String command = mediaCommand(event.getKeyCode());
        if (command != null && webView != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN &&
                    (event.getRepeatCount() == 0 || "forward".equals(command) || "rewind".equals(command))) {
                webView.evaluateJavascript("window.HongguoTV && window.HongguoTV.mediaCommand('" + command + "')", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private String mediaCommand(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return "toggle";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "play";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return "pause";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "forward";
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "rewind";
            default: return null;
        }
    }

    @Override
    public void onBackPressed() {
        requestPageBack();
    }

    private void requestPageBack() {
        if (backPending || isFinishing()) return;
        if (exitDialog != null && exitDialog.isShowing()) {
            exitDialog.cancel();
            return;
        }
        if (webView == null) {
            showExitConfirmation();
            return;
        }
        backPending = true;
        webView.evaluateJavascript("!!(window.HongguoTV && window.HongguoTV.requestBack())", result -> {
            backPending = false;
            if (!isFinishing() && !isDestroyed() && !"true".equals(result)) showExitConfirmation();
        });
    }

    private void showExitConfirmation() {
        exitDialog = new AlertDialog.Builder(this)
                .setTitle("退出红果短剧？")
                .setNegativeButton("取消", (dialog, which) -> dialog.dismiss())
                .setPositiveButton("退出", (dialog, which) -> finish())
                .create();
        exitDialog.setOnShowListener(dialog -> exitDialog.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());
        exitDialog.setOnDismissListener(dialog -> scheduleFullscreen());
        exitDialog.show();
    }

    @Override
    protected void onPause() {
        activityForeground = false;
        if (webView != null) {
            webView.evaluateJavascript("window.HongguoTV && window.HongguoTV.pauseForBackground()", null);
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        activityForeground = true;
        applyFullscreen();
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.HongguoTV && window.HongguoTV.resumeFromBackground()", null);
        }
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        if (startupThread != null) startupThread.interrupt();
        View decor = getWindow().getDecorView();
        decor.removeCallbacks(restoreFullscreen);
        decor.setOnSystemUiVisibilityChangeListener(null);
        if (decor.getViewTreeObserver().isAlive()) {
            decor.getViewTreeObserver().removeOnGlobalLayoutListener(keyboardLayoutListener);
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
