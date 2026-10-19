#!/usr/bin/env python3
"""Validate native compositor images and decoded PCM, then discard raw audio."""
import array
import json
import math
import sys
import wave
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

root = Path(sys.argv[1])
report = json.loads((root / "playback.json").read_text())
evidence = {"ok": bool(report.get("ok")), "pictures": {}, "audio": {}, "limits": [
    "Ubuntu 24.04 x86_64 / Xvfb / software graphics and decoding",
    "PulseAudio null sink validates PCM, not physical speaker output",
    "Does not validate physical GPUs, other distributions, or packaged installers",
]}
for stage in ("first-a", "first-b", "after-seek", "second-a", "second-b"):
    try:
        sample = json.loads((root / (stage + ".json")).read_text())["sample"]
        picture = Image.open(root / (stage + ".png")).convert("RGB")
        rect = sample["rect"]
        sx, sy = picture.width / sample["viewport"]["width"], picture.height / sample["viewport"]["height"]
        # Use the centre of the video to exclude the app's sidebar and controls.
        # For portrait movies, the middle column is inside the displayed image.
        x, y, w, h = rect["x"], rect["y"], rect["width"], rect["height"]
        crop = picture.crop((int((x + w * .4) * sx), int((y + h * .2) * sy),
                             int((x + w * .6) * sx), int((y + h * .7) * sy))).resize((64, 64))
        stat = ImageStat.Stat(crop)
        entry = {"mean_rgb": stat.mean, "spread_rgb": stat.stddev, "time": sample["time"]}
        evidence["pictures"][stage] = entry
        if max(stat.mean) < 8 or max(stat.stddev) < 3:
            evidence["ok"] = False
        if stage.endswith("-b"):
            first = Image.open(root / (stage.replace("-b", "-a") + ".png")).convert("RGB")
            diff = sum(ImageStat.Stat(ImageChops.difference(first, picture)).mean) / 3
            entry["compositor_difference"] = diff
            if diff < .3:
                evidence["ok"] = False
    except (OSError, KeyError, ValueError) as error:
        evidence["pictures"][stage] = {"error": type(error).__name__}
        evidence["ok"] = False
for stage in ("first-a", "second-a"):
    path = root / (stage + ".wav")
    try:
        with wave.open(str(path), "rb") as wav:
            assert wav.getsampwidth() == 2 and wav.getnchannels() == 1
            pcm = array.array("h", wav.readframes(wav.getnframes()))
            if sys.byteorder != "little":
                pcm.byteswap()
            rms = math.sqrt(sum(int(x) ** 2 for x in pcm) / max(len(pcm), 1))
            evidence["audio"][stage] = {"rms_pcm16": rms, "samples": len(pcm), "sample_rate": wav.getframerate()}
            if rms < 5 or len(pcm) < 16000:
                evidence["ok"] = False
    except (OSError, AssertionError, wave.Error) as error:
        evidence["audio"][stage] = {"error": type(error).__name__}
        evidence["ok"] = False
    finally:
        path.unlink(missing_ok=True)
(root / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
print(json.dumps(evidence, ensure_ascii=False, indent=2))
sys.exit(0 if evidence["ok"] else 1)
