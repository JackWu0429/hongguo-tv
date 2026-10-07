package rocks.aston.hongguotv;

import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.security.MessageDigest;
import static org.junit.Assert.*;

public class UpdateFilesTest {
    private final byte[] content = "signed APK fixture bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    private final UpdateFiles.Monitor normal = new UpdateFiles.Monitor() {
        public void check() {} public void progress(long bytes) {}
    };
    @Test public void completeDownloadIsKeptAndMatchesAllBytes() throws Exception {
        File file = File.createTempFile("update", ".part");
        try {
            UpdateFiles.copyChecked(new ByteArrayInputStream(content), file, content.length, digest(content), normal);
            assertArrayEquals(content, Files.readAllBytes(file.toPath()));
        } finally { file.delete(); }
    }
    @Test public void tamperedTruncatedAndOversizedDownloadsLeaveNoPartialFile() throws Exception {
        for (long size : new long[]{content.length - 1, content.length, content.length + 1}) {
            File file = File.createTempFile("update", ".part");
            try {
                String sha = size == content.length ? digest(new byte[]{1}) : digest(content);
                UpdateFiles.copyChecked(new ByteArrayInputStream(content), file, size, sha, normal);
                fail("bad download accepted");
            } catch (IOException expected) { assertFalse(file.exists()); }
            finally { file.delete(); }
        }
    }
    @Test public void cancellationRemovesTheDownload() throws Exception {
        File file = File.createTempFile("update", ".part");
        try {
            UpdateFiles.copyChecked(new ByteArrayInputStream(content), file, content.length, digest(content), new UpdateFiles.Monitor() {
                public void check() throws IOException { throw new IOException("cancelled"); }
                public void progress(long bytes) { fail("cancelled download progressed"); }
            }); fail("cancel ignored");
        } catch (IOException expected) { assertFalse(file.exists()); }
        finally { file.delete(); }
    }
    private String digest(byte[] bytes) throws Exception { return UpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
}
