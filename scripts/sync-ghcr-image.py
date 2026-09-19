#!/usr/bin/env python3
"""
Sync Docker image from terawalletrh/terawallet-backend:latest
to notadeveloper7/terrawallet-backend:latest on GitHub Container Registry (ghcr.io)
using cross-repository blob mounting.
"""

import base64
import json
import urllib.request
import urllib.error

SRC_REPO = "terawalletrh/terawallet-backend"
DST_REPO = "notadeveloper7/terrawallet-backend"
SRC_TAG = "latest"

TOKEN_SRC_AUTH = "EXAMPLE_REDACTED_FIXTURE"
TOKEN_DST_AUTH = "EXAMPLE_REDACTED_FIXTURE"

def get_tokens():
    # Public token for source pull
    url_src = f"https://ghcr.io/token?service=ghcr.io&scope=repository:{SRC_REPO}:pull"
    with urllib.request.urlopen(url_src) as r:
        src_token = json.loads(r.read())["token"]

    # Basic auth token for destination push
    basic = base64.b64encode(f"NotADeveloper7:{TOKEN_DST_AUTH}".encode()).decode()
    req = urllib.request.Request(
        f"https://ghcr.io/token?service=ghcr.io&scope=repository:{DST_REPO}:pull,push",
        headers={"Authorization": f"Basic {basic}"}
    )
    with urllib.request.urlopen(req) as r:
        dst_token = json.loads(r.read())["token"]

    return src_token, dst_token

def fetch_manifest(token, repo, ref):
    req = urllib.request.Request(
        f"https://ghcr.io/v2/{repo}/manifests/{ref}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": (
                "application/vnd.docker.distribution.manifest.v2+json, "
                "application/vnd.oci.image.index.v1+json, "
                "application/vnd.oci.image.manifest.v1+json"
            ),
        }
    )
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        content_type = r.headers.get("Content-Type")
        return json.loads(raw), raw, content_type

def mount_blob(dst_token, digest):
    mount_url = f"https://ghcr.io/v2/{DST_REPO}/blobs/uploads/?mount={digest}&from={SRC_REPO}"
    req = urllib.request.Request(
        mount_url,
        method="POST",
        headers={"Authorization": f"Bearer {dst_token}"}
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status in (200, 201)
    except urllib.error.HTTPError as e:
        print(f"Mount error for {digest}: {e.code}")
        return False

def put_manifest(dst_token, repo, tag_or_digest, raw_manifest, content_type):
    url = f"https://ghcr.io/v2/{repo}/manifests/{tag_or_digest}"
    req = urllib.request.Request(
        url,
        data=raw_manifest,
        method="PUT",
        headers={
            "Authorization": f"Bearer {dst_token}",
            "Content-Type": content_type,
        }
    )
    with urllib.request.urlopen(req) as r:
        print(f"Put manifest {tag_or_digest} -> status {r.status}")

def main():
    print("1. Acquiring tokens...")
    src_token, dst_token = get_tokens()

    print(f"2. Fetching root manifest for {SRC_REPO}:{SRC_TAG}...")
    root_data, root_raw, root_ct = fetch_manifest(src_token, SRC_REPO, SRC_TAG)

    child_manifests = []
    if "manifests" in root_data:
        for m in root_data["manifests"]:
            digest = m["digest"]
            c_data, c_raw, c_ct = fetch_manifest(src_token, SRC_REPO, digest)
            child_manifests.append((digest, c_data, c_raw, c_ct))
    else:
        child_manifests.append(("latest", root_data, root_raw, root_ct))

    # Collect all blobs to mount
    blobs_to_mount = set()
    for digest, c_data, _, _ in child_manifests:
        if "config" in c_data and "digest" in c_data["config"]:
            blobs_to_mount.add(c_data["config"]["digest"])
        for layer in c_data.get("layers", []):
            if "digest" in layer:
                blobs_to_mount.add(layer["digest"])

    print(f"3. Mounting {len(blobs_to_mount)} blobs into {DST_REPO}...")
    for b in sorted(blobs_to_mount):
        ok = mount_blob(dst_token, b)
        print(f"   Mount {b[:20]}... -> {'OK' if ok else 'FAIL'}")

    print("4. Putting child manifests into destination...")
    for digest, _, c_raw, c_ct in child_manifests:
        put_manifest(dst_token, DST_REPO, digest, c_raw, c_ct)

    print(f"5. Putting root manifest as tag 'latest' into {DST_REPO}...")
    put_manifest(dst_token, DST_REPO, "latest", root_raw, root_ct)

    print("Done! Container image synced successfully.")

if __name__ == "__main__":
    main()
