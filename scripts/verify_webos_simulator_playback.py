#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


def fail(message):
    raise SystemExit("webOS Simulator playback verification: FAIL: " + message)


if len(sys.argv) != 2:
    fail("usage: verify_webos_simulator_playback.py REPORT.json")

report_path = Path(sys.argv[1])
try:
    report = json.loads(report_path.read_text(encoding="utf-8"))
except Exception as error:
    fail("report is missing or invalid JSON: " + str(error))

serialized = json.dumps(report, ensure_ascii=False)
if re.search(r"https?://", serialized, re.I):
    fail("report contains a URL")
for field in ("url", "path", "token", "key", "authorization", "cookie", "responseBody"):
    if re.search(r'"' + re.escape(field) + r'"\s*:', serialized, re.I):
        fail("report contains a forbidden field: " + field)
if report.get("platform") != "webOS TV 26 Simulator" or report.get("redacted") is not True:
    fail("report is not identified as a redacted Simulator run")
if report.get("accountStubbed") is not True:
    fail("report must disclose the Simulator-only guest account response")
if report.get("ok") is not True or report.get("stage") != "passed":
    fail("playback probe failed at " + str(report.get("stage")) + ": " + str(report.get("failure", "unknown failure")))

requests = report.get("requests", [])
for vid_key in ("episode1", "episode2"):
    if not any(item.get("endpoint") == "play/info" and item.get(vid_key) is True and item.get("status") == 200 and item.get("ok") is True for item in requests):
        fail("missing successful play/info response for " + vid_key)

steps = {item.get("stage"): item for item in report.get("steps", [])}
required = ("episode-1-a", "episode-1-b", "episode-1-seek", "episode-2-a", "episode-2-b")
missing = [stage for stage in required if stage not in steps]
if missing:
    fail("missing playback samples: " + ", ".join(missing))

first_a, first_b = steps["episode-1-a"], steps["episode-1-b"]
if not first_a.get("episode1Source") or not first_b.get("episode1Source"):
    fail("episode 1 did not use the expected media source")
if first_b.get("currentTime", 0) - first_a.get("currentTime", 0) < 2:
    fail("episode 1 playback clock did not advance")
if min(first_b.get("videoWidth", 0), first_b.get("videoHeight", 0)) <= 0:
    fail("episode 1 has no decoded video dimensions")
if first_b.get("presentedFrames", 0) < 20 and first_b.get("decodedFrames", 0) < 20:
    fail("episode 1 has no decoded or presented frame evidence")

seek = steps["episode-1-seek"]
if seek.get("episode1Source") is not True or seek.get("seeking") is True:
    fail("seek did not settle on episode 1")
second_a, second_b = steps["episode-2-a"], steps["episode-2-b"]
if not second_a.get("episode2Source") or not second_b.get("episode2Source"):
    fail("D-pad episode change did not select episode 2")
if second_b.get("currentTime", 0) - second_a.get("currentTime", 0) < 2:
    fail("episode 2 playback clock did not advance")
if min(second_b.get("videoWidth", 0), second_b.get("videoHeight", 0)) <= 0:
    fail("episode 2 has no decoded video dimensions")
if any(item.get("mediaError", 0) for item in report.get("steps", [])):
    fail("HTMLMediaElement reported a playback error")

print("webOS Simulator playback verification: PASS")
print("platform: webOS TV 26 Simulator (not an LG TV)")
print("account: Simulator-only anonymous status response; playback APIs remain live")
print("series: " + str(report.get("title")))
print("episode 1: {0}x{1}, {2:.1f}s -> {3:.1f}s, presented={4}, decoded={5}, dropped={6}".format(
    first_b["videoWidth"], first_b["videoHeight"], first_a["currentTime"], first_b["currentTime"],
    first_b.get("presentedFrames", 0), first_b.get("decodedFrames", 0), first_b.get("droppedFrames", 0)))
print("seek: settled at {0:.1f}s".format(seek.get("currentTime", 0)))
print("episode 2: {0}x{1}, {2:.1f}s -> {3:.1f}s".format(
    second_b["videoWidth"], second_b["videoHeight"], second_a["currentTime"], second_b["currentTime"]))
