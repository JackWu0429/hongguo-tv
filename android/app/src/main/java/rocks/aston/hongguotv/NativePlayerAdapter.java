package rocks.aston.hongguotv;

/** Activity lifecycle only. JavaScript is registered on the concrete adapter. */
interface NativePlayerAdapter {
    void onPause();
    void onResume();
    void destroy();
}
