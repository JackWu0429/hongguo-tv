package rocks.aston.hongguotv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final String CORE_URL = "http://127.0.0.1:8797/";
    private WebView webView;
    private boolean backPending;
    private boolean activityForeground;
    private AlertDialog exitDialog;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );

        startCoreService();
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF0C0D12);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript("window.HongguoTV && window.HongguoTV." +
                        (activityForeground ? "resumeFromBackground()" : "pauseForBackground()"), null);
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        setContentView(webView);
        webView.requestFocus(View.FOCUS_DOWN);
        webView.loadUrl(CORE_URL);
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
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.HongguoTV && window.HongguoTV.resumeFromBackground()", null);
        }
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
}
