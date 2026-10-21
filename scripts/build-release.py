#!/usr/bin/env python3
"""Build a deterministic, generic self-hosting release from public source."""

import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.1.0"
NAME = f"PWA-Invite-Console-v{VERSION}-self-host.zip"
RUNTIME = (
    "admin.css",
    "bust.html",
    "console.css",
    "console.js",
    "icons/icon.svg",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "index.html",
    "manifest.webmanifest",
    "pwa-update.js",
    "sw-update.js",
    "sw.js",
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def add_file(archive, path, data):
    info = zipfile.ZipInfo(path, date_time=(2020, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, data, compresslevel=9)


def build(output):
    output.mkdir(parents=True, exist_ok=True)
    revision = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    site = {name: (ROOT / name).read_bytes() for name in RUNTIME}
    # Never package the tracked owner-specific apps.json.
    site["apps.json"] = (ROOT / "apps.example.json").read_bytes()
    version_input = b"".join(
        name.encode() + b"\0" + digest(site[name]).encode() + b"\n"
        for name in sorted(site)
    )
    build_version = digest(version_input)[:12]
    marker = b"__BUILD_VERSION__"
    if site["sw.js"].count(marker) != 1:
        raise ValueError("expected one service worker version marker")
    site["sw.js"] = site["sw.js"].replace(marker, build_version.encode())
    info = {
        "release": VERSION,
        "source": f"https://github.com/zandaulion/pwa-invite-console/tree/v{VERSION}",
        "source_commit": revision,
        "build_version": build_version,
        "site_sha256": {name: digest(data) for name, data in sorted(site.items())},
    }
    members = {
        "BUILD-INFO.json": (json.dumps(info, indent=2, sort_keys=True) + "\n").encode(),
        "LICENSE": (ROOT / "LICENSE").read_bytes(),
        "RELEASE.md": (ROOT / "RELEASE.md").read_bytes(),
        "apps.example.json": (ROOT / "apps.example.json").read_bytes(),
    }
    members.update({f"site/{name}": data for name, data in site.items()})
    archive_path = output / NAME
    with zipfile.ZipFile(archive_path, "w") as archive:
        for name, data in sorted(members.items()):
            add_file(archive, name, data)
    checksum = digest(archive_path.read_bytes())
    (output / "SHA256SUMS").write_text(f"{checksum}  {NAME}\n")
    print(json.dumps({
        "archive": str(archive_path), "bytes": archive_path.stat().st_size,
        "sha256": checksum, "members": len(members), "build_version": build_version,
        "source_commit": revision,
    }, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path)
    build(parser.parse_args().output_dir)
