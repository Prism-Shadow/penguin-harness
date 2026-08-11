#!/bin/sh
# Derive one platform-specific offline profile from the canonical standard bundle built from
# the same source revision. The profile currently adds offline DOCX, PPTX and PDF helpers; future
# offline Skills belong in this same overlay instead of creating capability-specific package names.
#
# Usage: package-offline-bundle.sh <standard-bundle> [output-dir]
# Supported standard bundles: Linux/macOS x64/arm64 tarballs and the Windows x64 zip.
# Optional build inputs:
#   PENGUIN_OFFLINE_BUILD_PYTHON  Python with pip (default: python3)
#   PENGUIN_OFFLINE_WHEELHOUSE    Pre-downloaded wheel root; optional <target>/ subdirs
set -eu

ROOT_DIR="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
INPUT="${1:?usage: package-offline-bundle.sh <standard-bundle> [output-dir]}"
OUTPUT_INPUT="${2:-dist-offline}"
BUILD_PYTHON="${PENGUIN_OFFLINE_BUILD_PYTHON:-python3}"
SOURCE_WHEELS="${PENGUIN_OFFLINE_WHEELHOUSE:-}"
SKILLS_ROOT="$ROOT_DIR/packages/skills/offline"
OFFLINE_SKILLS="word-docx powerpoint-pptx pdf-tools"
SHARED_BOOTSTRAP="$SKILLS_ROOT/_shared/bootstrap_runtime.py"

resolve_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$ROOT_DIR/$1" ;;
  esac
}

write_sha256() {
  file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$file")" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$(dirname "$file")" && shasum -a 256 "$(basename "$file")" > "$(basename "$file").sha256")
  else
    echo "error: sha256sum or shasum is required" >&2
    exit 1
  fi
}

INPUT="$(resolve_path "$INPUT")"
OUTPUT_DIR="$(resolve_path "$OUTPUT_INPUT")"
[ -f "$INPUT" ] || {
  echo "error: standard bundle not found: $INPUT" >&2
  exit 1
}
for skill in $OFFLINE_SKILLS; do
  case "$skill" in
    word-docx) helper=scripts/docx_helper.py ;;
    powerpoint-pptx) helper=scripts/pptx_helper.py ;;
    pdf-tools) helper=scripts/pdf_helper.py ;;
  esac
  for file in SKILL.md icon.svg requirements.lock scripts/bootstrap.py "$helper"; do
    [ -f "$SKILLS_ROOT/$skill/$file" ] || {
      echo "error: $skill Skill source is missing $file" >&2
      exit 1
    }
  done
done
[ -f "$SHARED_BOOTSTRAP" ] || {
  echo "error: shared offline bootstrap is missing: $SHARED_BOOTSTRAP" >&2
  exit 1
}
command -v tar >/dev/null 2>&1 || {
  echo "error: tar is required" >&2
  exit 1
}
command -v zip >/dev/null 2>&1 || {
  echo "error: zip is required" >&2
  exit 1
}
command -v unzip >/dev/null 2>&1 || {
  echo "error: unzip is required" >&2
  exit 1
}
command -v "$BUILD_PYTHON" >/dev/null 2>&1 || {
  echo "error: build Python not found: $BUILD_PYTHON" >&2
  exit 1
}
"$BUILD_PYTHON" -m pip --version >/dev/null 2>&1 || {
  echo "error: $BUILD_PYTHON must provide pip for the build step" >&2
  exit 1
}

case "$INPUT" in
  *.zip) FORMAT="zip" ;;
  *.tar.gz) FORMAT="tar" ;;
  *)
    echo "error: standard bundle must be a .tar.gz or .zip file" >&2
    exit 1
    ;;
esac

validate_archive() {
  "$BUILD_PYTHON" -I - "$1" "$2" "$3" <<'PY'
from pathlib import PurePosixPath
import posixpath
import stat
import sys
import tarfile
import zipfile

archive, kind, archive_format = sys.argv[1:]


def checked_name(raw: str) -> str:
    path = PurePosixPath(raw)
    name = path.as_posix().removeprefix("./")
    if (
        not raw
        or "\\" in raw
        or "\n" in raw
        or "\r" in raw
        or path.is_absolute()
        or ".." in path.parts
    ):
        raise SystemExit(f"error: unsafe archive member: {raw}")
    return name


if archive_format == "tar":
    with tarfile.open(archive, "r:gz") as source:
        members = source.getmembers()
    if kind == "outer":
        expected = {"install.sh", "payload.tar.gz", "payload.tar.gz.sha256"}
        files: set[str] = set()
        for member in members:
            name = checked_name(member.name)
            if name in {"", "."} and member.isdir():
                continue
            if name not in expected or not member.isfile() or name in files:
                raise SystemExit(f"error: unsafe or unexpected outer archive member: {member.name}")
            files.add(name)
        if files != expected:
            raise SystemExit("error: input is not a canonical POSIX Penguin bundle")
        raise SystemExit(0)

    names: set[str] = set()
    links: set[str] = set()
    for member in members:
        name = checked_name(member.name)
        if (
            (name != "penguin" and not name.startswith("penguin/"))
            or name in names
            or not (member.isdir() or member.isfile() or member.issym() or member.islnk())
        ):
            raise SystemExit(f"error: unsafe or unsupported payload member: {member.name}")
        names.add(name)
        if member.issym() or member.islnk():
            target = member.linkname
            if not target or "\\" in target or "\n" in target or "\r" in target:
                raise SystemExit(f"error: unsafe payload link target: {member.name}")
            resolved = (
                posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
                if member.issym()
                else posixpath.normpath(target)
            )
            if posixpath.isabs(target) or (
                resolved != "penguin" and not resolved.startswith("penguin/")
            ):
                raise SystemExit(f"error: payload link escapes penguin/: {member.name}")
            links.add(name)
    for name in names:
        if any(parent.as_posix() in links for parent in PurePosixPath(name).parents):
            raise SystemExit(f"error: payload member traverses a link: {name}")
    raise SystemExit(0)

with zipfile.ZipFile(archive) as source:
    members = source.infolist()
if kind == "outer":
    expected = {"install.cmd", "install.ps1", "payload.zip", "payload.zip.sha256"}
    files: set[str] = set()
    for member in members:
        name = checked_name(member.filename)
        mode = member.external_attr >> 16
        if member.is_dir() or stat.S_ISLNK(mode) or name not in expected or name in files:
            raise SystemExit(f"error: unsafe or unexpected outer archive member: {member.filename}")
        files.add(name)
    if files != expected:
        raise SystemExit("error: input is not a canonical Windows Penguin bundle")
    raise SystemExit(0)

names: set[str] = set()
for member in members:
    name = checked_name(member.filename)
    mode = member.external_attr >> 16
    if (
        (name != "penguin" and not name.startswith("penguin/"))
        or name in names
        or stat.S_ISLNK(mode)
        or (mode and not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)))
    ):
        raise SystemExit(f"error: unsafe or unsupported payload member: {member.filename}")
    names.add(name)
PY
}

if [ -n "$SOURCE_WHEELS" ]; then
  SOURCE_WHEELS="$(resolve_path "$SOURCE_WHEELS")"
  [ -d "$SOURCE_WHEELS" ] || {
    echo "error: wheelhouse not found: $SOURCE_WHEELS" >&2
    exit 1
  }
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM
OUTER="$WORK_DIR/outer"
PAYLOAD="$WORK_DIR/payload"
OFFLINE="$WORK_DIR/offline"
mkdir -p "$OUTER" "$PAYLOAD" "$OFFLINE"

validate_archive "$INPUT" outer "$FORMAT"
if [ "$FORMAT" = "tar" ]; then
  tar -xzf "$INPUT" -C "$OUTER"
  PAYLOAD_NAME="payload.tar.gz"
else
  unzip -q "$INPUT" -d "$OUTER"
  PAYLOAD_NAME="payload.zip"
fi

expected_payload="$(awk 'NR == 1 { print $1 }' "$OUTER/$PAYLOAD_NAME.sha256")"
if command -v sha256sum >/dev/null 2>&1; then
  actual_payload="$(sha256sum "$OUTER/$PAYLOAD_NAME" | awk '{ print $1 }')"
else
  actual_payload="$(shasum -a 256 "$OUTER/$PAYLOAD_NAME" | awk '{ print $1 }')"
fi
[ -n "$expected_payload" ] && [ "$actual_payload" = "$expected_payload" ] || {
  echo "error: standard bundle payload checksum mismatch" >&2
  exit 1
}

validate_archive "$OUTER/$PAYLOAD_NAME" payload "$FORMAT"
if [ "$FORMAT" = "tar" ]; then
  tar -xzf "$OUTER/$PAYLOAD_NAME" -C "$PAYLOAD"
else
  unzip -q "$OUTER/$PAYLOAD_NAME" -d "$PAYLOAD"
fi

MANIFEST="$PAYLOAD/penguin/package-manifest.json"
[ -f "$MANIFEST" ] || {
  echo "error: package-manifest.json is missing" >&2
  exit 1
}
TARGET="$("$BUILD_PYTHON" -I -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["target"])' "$MANIFEST")"
case "$TARGET:$FORMAT" in
  linux-x64:tar|linux-arm64:tar|darwin-x64:tar|darwin-arm64:tar|win32-x64:zip) ;;
  *)
    echo "error: unsupported standard bundle target/format: $TARGET/$FORMAT" >&2
    exit 1
    ;;
esac

LIBRARY="$PAYLOAD/penguin/lib/node_modules/@prismshadow/penguin-skills/skills"
[ -d "$LIBRARY" ] && [ ! -L "$LIBRARY" ] || {
  echo "error: deployed Skill library not found: $LIBRARY" >&2
  exit 1
}
[ ! -e "$PAYLOAD/penguin/lib/offline" ] || {
  echo "error: standard bundle unexpectedly contains an offline profile" >&2
  exit 1
}
for skill in $OFFLINE_SKILLS; do
  [ ! -e "$LIBRARY/$skill" ] || {
    echo "error: standard bundle already contains $skill" >&2
    exit 1
  }
  case "$skill" in
    word-docx) helper=scripts/docx_helper.py ;;
    powerpoint-pptx) helper=scripts/pptx_helper.py ;;
    pdf-tools) helper=scripts/pdf_helper.py ;;
  esac
  for file in SKILL.md icon.svg requirements.lock scripts/bootstrap.py "$helper"; do
    mkdir -p "$LIBRARY/$skill/$(dirname "$file")"
    cp "$SKILLS_ROOT/$skill/$file" "$LIBRARY/$skill/$file"
  done
done

# Reject legacy or mismatched standard bundles without executing input package code.
SKILLS_ENTRY="$PAYLOAD/penguin/lib/node_modules/@prismshadow/penguin-skills/dist/index.js"
CORE_ENTRY="$PAYLOAD/penguin/lib/node_modules/@prismshadow/penguin-core/dist/index.js"
[ -f "$SKILLS_ENTRY" ] && [ ! -L "$SKILLS_ENTRY" ] && \
  [ -f "$CORE_ENTRY" ] && [ ! -L "$CORE_ENTRY" ] || {
  echo "error: standard bundle is missing the deployed skills or core entry" >&2
  exit 1
}
cmp "$ROOT_DIR/packages/skills/dist/index.js" "$SKILLS_ENTRY" >/dev/null 2>&1 && \
  cmp "$ROOT_DIR/packages/core/dist/index.js" "$CORE_ENTRY" >/dev/null 2>&1 || {
  echo "error: standard bundle does not match this checkout's current build" >&2
  exit 1
}
if [ "$FORMAT" = "tar" ]; then
  cmp "$ROOT_DIR/install.sh" "$OUTER/install.sh" >/dev/null 2>&1 || {
    echo "error: standard bundle installer does not match this checkout" >&2
    exit 1
  }
else
  cmp "$ROOT_DIR/install.ps1" "$OUTER/install.ps1" >/dev/null 2>&1 && \
    cmp "$ROOT_DIR/install.cmd" "$OUTER/install.cmd" >/dev/null 2>&1 || {
    echo "error: standard bundle installers do not match this checkout" >&2
    exit 1
  }
fi

OFFLINE_ROOT="$PAYLOAD/penguin/lib/offline"
WHEELS="$OFFLINE_ROOT/wheels"
mkdir -p "$WHEELS" "$OFFLINE_ROOT/_shared"
cp "$SHARED_BOOTSTRAP" "$OFFLINE_ROOT/_shared/bootstrap_runtime.py"
printf '{"schemaVersion":1,"profile":"offline","target":"%s","capabilities":["word-docx","powerpoint-pptx","pdf-tools"]}\n' \
  "$TARGET" > "$OFFLINE_ROOT/profile.json"

if [ -n "$SOURCE_WHEELS" ]; then
  WHEEL_LINKS="$SOURCE_WHEELS"
  [ ! -d "$SOURCE_WHEELS/$TARGET" ] || WHEEL_LINKS="$SOURCE_WHEELS/$TARGET"
  export PIP_CONFIG_FILE="$("$BUILD_PYTHON" -I -c 'import os; print(os.devnull)')"
  export PIP_FIND_LINKS="$WHEEL_LINKS"
  export PIP_NO_INDEX=1
fi

wheel_platform() {
  minor="$1"
  case "$TARGET" in
    linux-x64) printf '%s\n' manylinux_2_17_x86_64 ;;
    linux-arm64) printf '%s\n' manylinux_2_17_aarch64 ;;
    darwin-x64) printf '%s\n' macosx_10_13_x86_64 ;;
    darwin-arm64) printf '%s\n' macosx_11_0_arm64 ;;
    win32-x64) printf '%s\n' win_amd64 ;;
  esac
}

for minor in 39 310 311 312 313; do
  platform="$(wheel_platform "$minor")"
  "$BUILD_PYTHON" -m pip download \
    --disable-pip-version-check \
    --no-deps \
    --only-binary=:all: \
    --platform "$platform" \
    --implementation cp \
    --python-version "$minor" \
    --abi "cp$minor" \
    --require-hashes \
    --requirement "$SKILLS_ROOT/word-docx/requirements.lock" \
    --requirement "$SKILLS_ROOT/powerpoint-pptx/requirements.lock" \
    --requirement "$SKILLS_ROOT/pdf-tools/requirements.lock" \
    --dest "$WHEELS"
done
[ "$(find "$WHEELS" -maxdepth 1 -type f -name '*.whl' | wc -l | tr -d ' ')" = "15" ] || {
  echo "error: expected fifteen locked wheels for $TARGET" >&2
  exit 1
}

# The earlier DOCX profile stored its wheels at offline/word-docx/wheels. Existing Agents keep
# their installed bootstrap across an application update, so retain that lookup path for POSIX
# test/development upgrades without duplicating the wheel payload. Zip archives do not preserve
# this symlink portably; no DOCX offline profile has been released yet, so Windows has no public
# compatibility requirement.
if [ "$FORMAT" = "tar" ]; then
  mkdir -p "$OFFLINE_ROOT/word-docx"
  ln -s ../wheels "$OFFLINE_ROOT/word-docx/wheels"
fi

if [ "$FORMAT" = "tar" ]; then
  LAUNCHER="$PAYLOAD/penguin/bin/penguin"
  grep -Fq 'export PENGUIN_WEB_DIST=' "$LAUNCHER" || {
    echo "error: standard launcher does not expose PENGUIN_WEB_DIST" >&2
    exit 1
  }
  [ "$(grep -c 'PENGUIN_OFFLINE_ROOT' "$LAUNCHER" || true)" = "0" ] || {
    echo "error: standard launcher already defines PENGUIN_OFFLINE_ROOT" >&2
    exit 1
  }
  awk '
    { print }
    /export PENGUIN_WEB_DIST=/ {
      print "export PENGUIN_OFFLINE_ROOT=\"${PENGUIN_OFFLINE_ROOT:-$DIR/lib/offline}\""
    }
  ' "$LAUNCHER" > "$WORK_DIR/launcher"
  mv "$WORK_DIR/launcher" "$LAUNCHER"
  chmod +x "$LAUNCHER"

  tar -czf "$OFFLINE/payload.tar.gz" -C "$PAYLOAD" penguin
  write_sha256 "$OFFLINE/payload.tar.gz"
  cp "$OUTER/install.sh" "$OFFLINE/install.sh"
  chmod +x "$OFFLINE/install.sh"
  OUTPUT="$OUTPUT_DIR/penguin-offline-$TARGET.tar.gz"
  mkdir -p "$OUTPUT_DIR"
  rm -f "$OUTPUT" "$OUTPUT.sha256"
  tar -czf "$OUTPUT" -C "$OFFLINE" install.sh payload.tar.gz payload.tar.gz.sha256
else
  LAUNCHER="$PAYLOAD/penguin/bin/penguin.cmd"
  "$BUILD_PYTHON" -I - "$LAUNCHER" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
data = path.read_bytes()
if b"PENGUIN_OFFLINE_ROOT" in data:
    raise SystemExit("error: standard launcher already defines PENGUIN_OFFLINE_ROOT")
marker = b'if not defined PENGUIN_WEB_DIST set "PENGUIN_WEB_DIST=%DIR%\\web"'
if marker not in data:
    raise SystemExit("error: standard launcher does not expose PENGUIN_WEB_DIST")
newline = b"\r\n" if b"\r\n" in data else b"\n"
addition = b'if not defined PENGUIN_OFFLINE_ROOT set "PENGUIN_OFFLINE_ROOT=%DIR%\\lib\\offline"'
path.write_bytes(data.replace(marker + newline, marker + newline + addition + newline, 1))
PY

  (cd "$PAYLOAD" && zip -qr "$OFFLINE/payload.zip" penguin)
  write_sha256 "$OFFLINE/payload.zip"
  cp "$OUTER/install.ps1" "$OUTER/install.cmd" "$OFFLINE/"
  OUTPUT="$OUTPUT_DIR/penguin-offline-$TARGET.zip"
  mkdir -p "$OUTPUT_DIR"
  rm -f "$OUTPUT" "$OUTPUT.sha256"
  (cd "$OFFLINE" && zip -q "$OUTPUT" install.cmd install.ps1 payload.zip payload.zip.sha256)
fi
write_sha256 "$OUTPUT"

echo "Created $OUTPUT"
echo "Python prerequisite on the target: CPython 3.9-3.13 with venv support."
