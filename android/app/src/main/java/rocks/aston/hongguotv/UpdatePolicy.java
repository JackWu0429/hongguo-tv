package rocks.aston.hongguotv;

import java.net.URI;
import java.util.Arrays;
import java.util.Locale;

/** Rules shared by checking, downloading and the final installer hand-off. */
final class UpdatePolicy {
    static final String REPOSITORY = "aston314/hongguo-tv-releases";
    static final String MANIFEST = "https://raw.githubusercontent.com/" + REPOSITORY + "/main/update.json";
    static final String DEFAULT_PROXY = "https://ghfast.top/";
    static final long MAX_APK_BYTES = 100L * 1024 * 1024;
    static final long CHECK_INTERVAL = 24L * 60 * 60 * 1000;

    static boolean automaticCheckDue(long now, long lastAttempt) {
        return lastAttempt <= 0 || lastAttempt > now || now - lastAttempt >= CHECK_INTERVAL;
    }

    static String proxyPrefix(String value) {
        if (value == null || value.trim().isEmpty()) return "";
        String text = value.trim();
        URI uri = URI.create(text);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null)
            throw new IllegalArgumentException("请输入 HTTPS 代理地址，或留空使用 GitHub 直连");
        return text.endsWith("/") ? text : text + "/";
    }

    static String[] sources(String origin, String proxy) {
        String prefix = proxyPrefix(proxy);
        return prefix.isEmpty() ? new String[]{origin} : new String[]{prefix + origin, origin};
    }

    static void validate(String packageName, int code, String name, int minSdk, long bytes,
                         String sha256, String download, String installedPackage, int installedCode, String installedName) {
        if (code < installedCode || code == installedCode && !installedName.equals(name))
            throw new IllegalArgumentException("更新信息尚未刷新或版本不一致，请稍后重试");
        if (!installedPackage.equals(packageName) || code <= 0 || name == null
                || !name.matches("[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?")
                || minSdk < 23 || bytes <= 0 || bytes > MAX_APK_BYTES
                || sha256 == null || !sha256.matches("[a-fA-F0-9]{64}"))
            throw new IllegalArgumentException("版本信息不完整或不匹配");
        URI uri = URI.create(download);
        String path = uri.getRawPath();
        String prefix = "/" + REPOSITORY + "/releases/download/v" + name + "/";
        if (!"https".equals(uri.getScheme()) || !"github.com".equals(uri.getHost())
                || uri.getRawUserInfo() != null || uri.getPort() != -1
                || uri.getRawQuery() != null || uri.getRawFragment() != null
                || path == null || !path.equals(prefix + "hongguo-tv-" + name + ".apk"))
            throw new IllegalArgumentException("安装包地址不是红果短剧公开发行文件");
    }

    static boolean matchingArchive(String installedPackage, int installedCode, String archivePackage,
                                   int archiveCode, String archiveName, int expectedCode, String expectedName,
                                   String[] installedSigners, String[] archiveSigners) {
        if (!installedPackage.equals(archivePackage) || archiveCode <= installedCode
                || archiveCode != expectedCode || !expectedName.equals(archiveName)
                || installedSigners == null || archiveSigners == null
                || installedSigners.length == 0 || installedSigners.length != archiveSigners.length) return false;
        String[] left = installedSigners.clone(), right = archiveSigners.clone();
        Arrays.sort(left); Arrays.sort(right);
        return Arrays.equals(left, right);
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
}
