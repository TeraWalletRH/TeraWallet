#!/usr/bin/env python3
"""
Tera Wallet Public Repo Sync Script
====================================
Syncs the local `main` branch to the public Open Source repository (TeraWalletRH/TeraWallet)
while rewriting all commit authors & committers to:
  Tera <terawalletrh@outlook.com>

Commit messages are also scrubbed of AI-assistant attribution trailers so the
public mirror carries only the project's own authorship.

File contents are scrubbed of secret-shaped test fixtures. A sample key in a
test is harmless here but trips GitHub's push protection on the public mirror,
which rejects the entire push. Rewriting it in the export stream keeps the public
history pushable without rewriting `main`, which Lovable depends on.

Keeps the primary `origin` (NotADeveloper7/terrawallet) untouched for Vercel & Lovable compatibility.
"""

import os
import re
import sys
import subprocess

PUBLIC_AUTHOR_NAME = "Tera"
PUBLIC_AUTHOR_EMAIL = "terawalletrh@outlook.com"
REMOTE_PUBLIC = "origin-public"
TARGET_BRANCH = "main"
LOCAL_EXPORT_REF = "public-main"

# Attribution trailers stripped from every commit message in the public mirror.
DROP_LINE_PREFIXES = (
    b"co-authored-by: claude",
    b"claude-session:",
)
DROP_LINE_SUBSTRINGS = (
    b"generated with [claude code]",
    b"claude.ai/code/session",
)

# Secret-shaped strings replaced in file contents on the way to the public
# mirror. These are test fixtures: the shape is what a scanner recognises, and
# the shape is all that is removed. A test that asserts a credential is refused
# keeps passing, because the gate matches on the field name rather than on the
# token format.
#
# Never add a pattern that could match something under public/tera/wallet/.
# Those files are hashed into manifest.json, and changing a byte there would make
# the published build fail its own integrity check on the public mirror only.
SECRET_PATTERNS = (
    (re.compile(rb"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}"), b"EXAMPLE_REDACTED_FIXTURE"),
    (re.compile(rb"\bghp_[A-Za-z0-9]{36}\b"), b"EXAMPLE_REDACTED_FIXTURE"),
    (re.compile(rb"\bgithub_pat_[A-Za-z0-9_]{50,}"), b"EXAMPLE_REDACTED_FIXTURE"),
)


def is_attribution_line(line: bytes) -> bool:
    """True when a commit-message line is AI-assistant attribution."""
    probe = line.strip().lower()
    if not probe:
        return False
    if probe.startswith(DROP_LINE_PREFIXES):
        return True
    return any(frag in probe for frag in DROP_LINE_SUBSTRINGS)


def scrub_message(msg: bytes) -> bytes:
    """Removes attribution trailers and any blank lines they leave behind."""
    kept = [line for line in msg.split(b"\n") if not is_attribution_line(line)]
    while kept and not kept[-1].strip():
        kept.pop()
    return b"\n".join(kept) + b"\n"


def scrub_blob(blob: bytes):
    """Replaces secret-shaped strings in one file blob.

    Returns the blob and the number of replacements, so the caller can restate
    the byte count fast-import expects and report what changed instead of
    rewriting the tree silently.
    """
    hits = 0
    for pattern, replacement in SECRET_PATTERNS:
        blob, found = pattern.subn(replacement, blob)
        hits += found
    return blob, hits


def main():
    print(f"[1/3] Exporting and rewriting commit history for {PUBLIC_AUTHOR_NAME} <{PUBLIC_AUTHOR_EMAIL}>...")

    # Fast export main -> rewrite stream -> fast import to public-main
    p1 = subprocess.Popen(["git", "fast-export", f"refs/heads/{TARGET_BRANCH}"], stdout=subprocess.PIPE)
    p2 = subprocess.Popen(["git", "fast-import", "--force", "--quiet"], stdin=subprocess.PIPE)

    inp = p1.stdout
    out = p2.stdin

    target_header = f"{PUBLIC_AUTHOR_NAME} <{PUBLIC_AUTHOR_EMAIL}>".encode("utf-8")

    # Set once a commit/tag header is seen, so the *next* data block is known to
    # be a message rather than a file blob.
    next_data_is_message = False
    redactions = 0

    while True:
        line = inp.readline()
        if not line:
            break

        if line.startswith(b"author "):
            parts = line.rstrip(b"\r\n").split(b" ")
            tz = parts[-1]
            t = parts[-2]
            out.write(b"author " + target_header + b" " + t + b" " + tz + b"\n")
        elif line.startswith(b"committer "):
            parts = line.rstrip(b"\r\n").split(b" ")
            tz = parts[-1]
            t = parts[-2]
            out.write(b"committer " + target_header + b" " + t + b" " + tz + b"\n")
            next_data_is_message = True
        elif line.startswith(b"tagger "):
            parts = line.rstrip(b"\r\n").split(b" ")
            tz = parts[-1]
            t = parts[-2]
            out.write(b"tagger " + target_header + b" " + t + b" " + tz + b"\n")
            next_data_is_message = True
        elif line.startswith(f"reset refs/heads/{TARGET_BRANCH}".encode("utf-8")):
            out.write(f"reset refs/heads/{LOCAL_EXPORT_REF}\n".encode("utf-8"))
        elif line.startswith(f"commit refs/heads/{TARGET_BRANCH}".encode("utf-8")):
            out.write(f"commit refs/heads/{LOCAL_EXPORT_REF}\n".encode("utf-8"))
        elif line.startswith(b"M ") or line.startswith(b"D ") or line.startswith(b"R ") or line.startswith(b"C "):
            parts = line.rstrip(b"\r\n").split(b" ")
            path = parts[-1]
            if (
                path == b".lovable"
                or path.startswith(b".lovable/")
                or path == b"technical-docs"
                or path.startswith(b"technical-docs/")
                or path == b"FRONTEND_INTEGRATION.md"
            ):

                if len(parts) > 2 and parts[2] == b"inline":

                    data_line = inp.readline()
                    count = int(data_line.split(b" ")[1])
                    inp.read(count)
                continue
            out.write(line)

        elif line.startswith(b"data "):
            count = int(line.split(b" ")[1])
            blob = inp.read(count)
            if next_data_is_message:
                # Commit/tag message: scrub attribution and restate the length.
                blob = scrub_message(blob)
                out.write(b"data " + str(len(blob)).encode("ascii") + b"\n")
                next_data_is_message = False
            else:
                # File blob: byte-exact unless it carries a secret-shaped
                # fixture, which is replaced and the length restated.
                blob, hits = scrub_blob(blob)
                if hits:
                    redactions += hits
                    out.write(b"data " + str(len(blob)).encode("ascii") + b"\n")
                else:
                    out.write(line)
            out.write(blob)
        else:
            out.write(line)

    out.close()
    p2.wait()
    p1.wait()

    if p1.returncode != 0 or p2.returncode != 0:
        print("Error: Fast export/import failed!", file=sys.stderr)
        sys.exit(1)

    print(f"[2/3] Local branch `{LOCAL_EXPORT_REF}` prepared with 100% {PUBLIC_AUTHOR_NAME} authorship.")
    if redactions:
        print(f"      {redactions} secret-shaped fixture(s) replaced in the public copy.")

    # Push to origin-public
    print(f"[3/3] Pushing `{LOCAL_EXPORT_REF}` to `{REMOTE_PUBLIC} {TARGET_BRANCH}`...")
    push_cmd = ["git", "push", REMOTE_PUBLIC, f"{LOCAL_EXPORT_REF}:{TARGET_BRANCH}", "--force"]
    res = subprocess.run(push_cmd)

    if res.returncode == 0:
        print(f"\nSuccessfully synced all commits to {REMOTE_PUBLIC} ({TARGET_BRANCH}) as {PUBLIC_AUTHOR_NAME}!")
    else:
        print(f"\nError: Push to {REMOTE_PUBLIC} failed with exit code {res.returncode}", file=sys.stderr)
        sys.exit(res.returncode)


if __name__ == "__main__":
    main()
