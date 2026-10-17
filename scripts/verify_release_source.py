#!/usr/bin/env python3
"""Require release builds to come from the unified main release line."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(["git", *args], text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result


def verify(event: str, ref: str, sha: str, branch: str = "main") -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("GITHUB_SHA must be a full commit SHA")
    if event not in {"workflow_dispatch", "push"}:
        raise ValueError(f"Unsupported release event: {event}")

    checkout = git("rev-parse", "HEAD^{commit}").stdout.strip()
    if checkout != sha:
        raise ValueError("Checked out commit does not match GITHUB_SHA")

    expected_ref = f"refs/heads/{branch}"
    if event == "workflow_dispatch":
        if ref != expected_ref:
            raise ValueError(f"Manual release builds must run from {expected_ref}; got {ref}")
        return f"Manual build source verified: {branch} ({sha[:12]})"

    if not re.fullmatch(r"refs/tags/v\d+\.\d+\.\d+", ref):
        raise ValueError(f"Release tags must use vX.Y.Z; got {ref}")
    tagged = git("rev-parse", f"{ref}^{{commit}}").stdout.strip()
    if tagged != sha:
        raise ValueError("Release tag does not point to GITHUB_SHA")

    fetch = git("fetch", "--no-tags", "origin", branch, "--unshallow", check=False)
    if fetch.returncode:
        fetch = git("fetch", "--no-tags", "origin", branch, check=False)
    if fetch.returncode:
        raise RuntimeError(f"Could not fetch origin/{branch}: {fetch.stderr.strip()}")
    ancestry = git("merge-base", "--is-ancestor", sha, "FETCH_HEAD", check=False)
    if ancestry.returncode:
        raise ValueError(f"Release tag {ref} is not an ancestor of origin/{branch}")
    return f"Release source verified: {ref} is included in origin/{branch} ({sha[:12]})"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--branch", default="main")
    args = parser.parse_args()
    try:
        print(verify(args.event, args.ref, args.sha, args.branch))
    except (ValueError, RuntimeError) as exc:
        print(f"Release source rejected: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
