package rocks.aston.hongguotv;

/** The address belongs to the child we started, never a shared fixed port. */
final class CoreEndpoint {
    static final String READY_PREFIX = "HONGGUO_TV_READY ";
    final String url;
    final String instanceId;

    private CoreEndpoint(int port, String instanceId) {
        this.url = "http://127.0.0.1:" + port + "/";
        this.instanceId = instanceId;
    }

    static CoreEndpoint fromReadyLine(String line, String expectedId) {
        if (line == null || !line.startsWith(READY_PREFIX) || expectedId == null || expectedId.isEmpty()) return null;
        String[] fields = line.substring(READY_PREFIX.length()).split(" ");
        if (fields.length != 2 || !expectedId.equals(fields[1])) return null;
        try {
            int port = Integer.parseInt(fields[0]);
            return port > 0 && port <= 65535 ? new CoreEndpoint(port, expectedId) : null;
        } catch (NumberFormatException invalid) {
            return null;
        }
    }

    boolean matches(String service, String instance, String version, String expectedVersion) {
        return "hongguo-tv-core".equals(service) && instanceId.equals(instance)
                && expectedVersion != null && !expectedVersion.isEmpty() && expectedVersion.equals(version);
    }
}
