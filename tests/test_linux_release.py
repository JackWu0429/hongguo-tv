import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import publish_linux_appimage as release


class LinuxReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.version = "0.2.93"
        self.commit = "a" * 40
        self.name = f"hongguo-desktop-{self.version}-x86_64.AppImage"
        data = bytearray(b"test-appimage-content")
        data[:4] = b"\x7fELF"
        data[8:11] = b"AI\x02"
        self.image = self.root / self.name
        self.image.write_bytes(data)
        self.sha = hashlib.sha256(data).hexdigest()
        checksum = f"{self.sha}  {self.name}"
        (self.root / "SHA256SUMS").write_text(checksum + "\n")
        (self.root / f"{self.name}.sha256").write_text(checksum + "\n")
        (self.root / "package.json").write_text(json.dumps({
            "file": self.name,
            "size": len(data),
            "sha256": self.sha,
            "source_commit": self.commit,
            "core_version": f"{self.version}-{self.commit}",
            "version": self.version,
            "architecture": "x86_64",
            "experimental": True,
        }))

    def test_candidate_requires_matching_source_version_and_checksums(self):
        files = release.candidate(self.root, self.version, self.commit)
        self.assertEqual({path.name for path in files}, {
            self.name,
            self.name + ".sha256",
        })
        with self.assertRaises(ValueError):
            release.candidate(self.root, self.version, "b" * 40)

    def test_candidate_rejects_modified_appimage(self):
        self.image.write_bytes(self.image.read_bytes() + b"changed")
        with self.assertRaises(ValueError):
            release.candidate(self.root, self.version, self.commit)


if __name__ == "__main__":
    unittest.main()
