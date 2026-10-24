package rocks.aston.hongguotv;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.View;

/** Black startup track. A berry hops along the fill until the core is ready. */
public class StartupSplashView extends View {
    private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint berry = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint leaf = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shine = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF bar = new RectF();
    private float progress;
    private boolean hopping = true;
    private ValueAnimator finishAnimator;

    public StartupSplashView(Context context) {
        super(context);
        track.setColor(0x33FFFFFF);
        fill.setColor(0xFFF5F5F7);
        berry.setColor(0xFFC53645);
        leaf.setColor(0xFF3C8F55);
        shine.setColor(0x66FFFFFF);
        setWillNotDraw(false);
    }

    public void setProgress(float value) {
        progress = Math.max(0f, Math.min(1f, value));
        invalidate();
    }

    public void setHopping(boolean value) {
        hopping = value;
        if (hopping) postInvalidateOnAnimation();
    }

    public void reset() {
        if (finishAnimator != null) finishAnimator.cancel();
        progress = 0f;
        hopping = true;
        invalidate();
    }

    public void finish(Runnable done) {
        if (finishAnimator != null) finishAnimator.cancel();
        final boolean[] cancelled = { false };
        finishAnimator = ValueAnimator.ofFloat(progress, 1f);
        finishAnimator.setDuration(520);
        finishAnimator.addUpdateListener(animation -> setProgress((Float) animation.getAnimatedValue()));
        finishAnimator.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationCancel(Animator animation) { cancelled[0] = true; }
            @Override
            public void onAnimationEnd(Animator animation) {
                if (cancelled[0]) return;
                hopping = false;
                if (done != null) done.run();
            }
        });
        finishAnimator.start();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        float density = getResources().getDisplayMetrics().density;
        float width = getWidth();
        float height = getHeight();
        float trackWidth = Math.min(width - 160f * density, 560f * density);
        if (trackWidth < 160f * density) trackWidth = width * 0.62f;
        float trackHeight = 6f * density;
        float left = (width - trackWidth) / 2f;
        float top = height * 0.62f;
        bar.set(left, top, left + trackWidth, top + trackHeight);
        canvas.drawRoundRect(bar, trackHeight, trackHeight, track);
        float filled = trackWidth * progress;
        if (filled > 1f) {
            bar.right = left + Math.max(filled, trackHeight);
            canvas.drawRoundRect(bar, trackHeight, trackHeight, fill);
        }
        float hop = 0f;
        if (hopping) {
            hop = (float) Math.abs(Math.sin(SystemClock.uptimeMillis() / 170.0)) * 14f * density;
        }
        float radius = 15f * density;
        float fruitX = left + filled;
        float fruitY = top - radius - 8f * density - hop;
        canvas.drawCircle(fruitX, fruitY, radius, berry);
        canvas.drawCircle(fruitX - radius * 0.32f, fruitY - radius * 0.28f, radius * 0.28f, shine);
        canvas.save();
        canvas.translate(fruitX + radius * 0.15f, fruitY - radius * 0.85f);
        canvas.rotate(-28f);
        bar.set(0f, 0f, radius * 0.7f, radius * 0.34f);
        canvas.drawOval(bar, leaf);
        canvas.restore();
        if (hopping && getVisibility() == VISIBLE) postInvalidateOnAnimation();
    }
}
