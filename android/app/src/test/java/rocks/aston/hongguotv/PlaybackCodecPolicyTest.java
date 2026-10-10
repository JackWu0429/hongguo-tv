package rocks.aston.hongguotv;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackCodecPolicyTest {
    @Test public void nativePlaybackAllowsAVCAndHEVCButRejectsAV1() {
        assertTrue(PlaybackCodecPolicy.allowsDecoder("video/avc"));
        assertTrue(PlaybackCodecPolicy.allowsDecoder("video/hevc"));
        assertTrue(PlaybackCodecPolicy.allowsDecoder("audio/mp4a-latm"));
        assertFalse(PlaybackCodecPolicy.allowsDecoder("video/av01"));
        assertFalse(PlaybackCodecPolicy.allowsDecoder(null));
    }

    @Test public void compatibilityModeStillKeepsSoftwareAVCAndAACRules() {
        assertTrue(PlaybackCodecPolicy.allowsInMode("video/hevc", "OMX.realtek.video.dec.hevc", true));
        assertFalse(PlaybackCodecPolicy.allowsInMode("video/avc", "OMX.realtek.video.dec.avc", true));
        assertTrue(PlaybackCodecPolicy.allowsInMode("video/avc", "OMX.google.h264.decoder", true));
        assertFalse(PlaybackCodecPolicy.allowsInMode("audio/mp4a-latm", null, true));
    }
}
