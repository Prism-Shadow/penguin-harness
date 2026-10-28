"""Build a complete host runtime from a pinned git archive into a fresh directory.

Usage: prepare_runtime.py ARCHIVE DEST --revision COMMIT --sha256 ARCHIVE_SHA
                          --node NODE24 --pnpm PNPM_ENTRY_JS
The controller creates ARCHIVE using git archive COMMIT. Never overlay a prior install.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(archive, dest, revision, checksum, node, pnpm):
    if sha(archive) != checksum:
        raise ValueError("Source archive checksum mismatch")
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise ValueError("Pin a full git commit")
    dest.mkdir(parents=True, exist_ok=False)
    source = dest / "source"
    source.mkdir()
    # No inherited dependencies, build outputs, credentials or archive path escapes.
    with tarfile.open(archive) as tar:
        seen = set()
        for member in tar.getmembers():
            p = Path(member.name)
            if member.name in seen or p.is_absolute() or ".." in p.parts or not (member.isdir() or member.isfile() or member.issym()) or any(
                    part in ("node_modules", "dist", ".git", ".project_config.toml", ".env") for part in p.parts):
                raise ValueError("Source archive contains a forbidden member")
            seen.add(member.name)
            if member.issym():
                link = Path(member.linkname)
                if link.is_absolute() or ".." in link.parts:
                    raise ValueError("Source archive link escapes its source directory")
        tar.extractall(source)
    lock = source / "pnpm-lock.yaml"
    lock_hash = sha(lock)
    env = {**os.environ, "PATH": str(node.parent) + os.pathsep + os.environ.get("PATH", "")}
    version = subprocess.check_output([str(node), "--version"], text=True).strip()
    if int(version.lstrip("v").split(".")[0]) < 24:
        raise ValueError("Node 24+ is required")
    actual_pnpm = subprocess.check_output([str(node), str(pnpm), "--version"], env=env, text=True).strip()
    declared = json.loads((source / "package.json").read_text())["packageManager"].split("+", 1)[0]
    if declared != "pnpm@" + actual_pnpm:
        raise ValueError("pnpm version differs from the pinned source packageManager")
    commands = [["install", "--frozen-lockfile", "--filter", "@prismshadow/penguin-core..."],
                ["--filter", "@prismshadow/penguin-core", "build"]]
    for i, args in enumerate(commands):
        with (dest / f"build-{i}.log").open("wb") as log:
            subprocess.run([str(node), str(pnpm), *args], cwd=source, env=env,
                           stdout=log, stderr=subprocess.STDOUT, check=True, timeout=1800)
    if sha(lock) != lock_hash:
        raise ValueError("Build changed the lockfile")
    sdk = source / "packages/core/dist/index.js"
    request = dest / "probe-request.json"
    request.write_text(json.dumps({"executor": {"sdk": str(sdk)}, "check_session": False}))
    subprocess.run([str(node), str(Path(__file__).with_name("runtime.mjs")), str(request),
                    str(dest / "probe-report.json")], check=True, timeout=60)
    probe = json.loads((dest / "probe-report.json").read_text())
    manifest = {"source_revision": revision, "source_archive_sha256": checksum, "lock_sha256": lock_hash,
                "node": str(node), "node_version": version, "pnpm_version": actual_pnpm,
                "sdk": str(sdk), "runtime_fingerprint": probe["fingerprint"], "probe": probe}
    (dest / "runtime-manifest.json").write_text(json.dumps(manifest, indent=2))
    return {k: v for k, v in manifest.items() if k != "probe"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("dest", type=Path)
    for name in ("revision", "sha256", "node", "pnpm"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.archive.resolve(), args.dest.resolve(), args.revision, args.sha256,
                             Path(args.node).resolve(), Path(args.pnpm).resolve()), indent=2))
