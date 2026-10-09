package rocks.aston.hongguotv;

import java.net.URI;
import java.util.Locale;

/** Only the APK's own local decrypted-media endpoint may be opened by Media3. */
final class MediaUrlPolicy {
    private MediaUrlPolicy() {}

    static boolean valid(String url) {
        try {
            URI uri = new URI(url);
            String host = uri.getHost();
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || host == null || uri.getRawUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) return false;
            host = host.toLowerCase(Locale.ROOT);
            if (!("127.0.0.1".equals(host) || "localhost".equals(host) || "[::1]".equals(host) || "::1".equals(host))) return false;
            String path = uri.getPath();
            return path != null && path.matches("/minireel-proxy/media/[a-f0-9]{24}\\.mp4");
        } catch (Exception ignored) { return false; }
    }
}
