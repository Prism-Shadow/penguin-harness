#!/bin/sh
# Derive a Linux x64 DOCX-enhanced bundle from the canonical lightweight bundle built from
# the same source revision.
# Wheels are downloaded only while building; the generated installer never uses the network.
#
# Usage: package-word-docx-bundle.sh <penguin-linux-x64.tar.gz> [output-dir]
# Optional build inputs:
#   PENGUIN_WORD_DOCX_BUILD_PYTHON  Python with pip (default: python3)
#   PENGUIN_WORD_DOCX_WHEELHOUSE    Pre-downloaded wheel directory (no build-time network)
set -eu

ROOT_DIR="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
INPUT="${1:?usage: package-word-docx-bundle.sh <penguin-linux-x64.tar.gz> [output-dir]}"
OUTPUT_INPUT="${2:-dist-word-docx}"
BUILD_PYTHON="${PENGUIN_WORD_DOCX_BUILD_PYTHON:-python3}"
SOURCE_WHEELS="${PENGUIN_WORD_DOCX_WHEELHOUSE:-}"
SKILL_SOURCE="$ROOT_DIR/packages/skills/offline/word-docx"

resolve_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$ROOT_DIR/$1" ;;
  esac
}

INPUT="$(resolve_path "$INPUT")"
OUTPUT_DIR="$(resolve_path "$OUTPUT_INPUT")"
[ -f "$INPUT" ] || {
  echo "error: standard Linux x64 bundle not found: $INPUT" >&2
  exit 1
}
for file in SKILL.md requirements.lock scripts/bootstrap.py scripts/docx_helper.py; do
  [ -f "$SKILL_SOURCE/$file" ] || {
    echo "error: word-docx Skill source is missing $file" >&2
    exit 1
  }
done
command -v tar >/dev/null 2>&1 || {
  echo "error: tar is required" >&2
  exit 1
}
command -v "$BUILD_PYTHON" >/dev/null 2>&1 || {
  echo "error: build Python not found: $BUILD_PYTHON" >&2
  exit 1
}

validate_archive() {
  "$BUILD_PYTHON" -I - "$1" "$2" <<'PY'
from pathlib import PurePosixPath
import posixpath
import sys
import tarfile

archive, kind = sys.argv[1:]
with tarfile.open(archive, "r:gz") as bundle:
    members = bundle.getmembers()

if kind == "outer":
    expected = {"install.sh", "payload.tar.gz", "payload.tar.gz.sha256"}
    files = set()
    for member in members:
        name = PurePosixPath(member.name).as_posix().removeprefix("./")
        if name in {"", "."} and member.isdir():
            continue
        if name not in expected or not member.isfile() or name in files:
            raise SystemExit(f"error: unsafe or unexpected outer archive member: {member.name}")
        files.add(name)
    if files != expected:
        raise SystemExit("error: input is not a canonical POSIX Penguin bundle")
    raise SystemExit(0)

names = set()
links = set()
for member in members:
    raw = member.name
    path = PurePosixPath(raw)
    name = path.as_posix()
    if (
        not raw
        or "\\" in raw
        or "\n" in raw
        or "\r" in raw
        or path.is_absolute()
        or ".." in path.parts
        or (name != "penguin" and not name.startswith("penguin/"))
        or name in names
    ):
        raise SystemExit(f"error: unsafe payload archive member: {raw}")
    if not (member.isdir() or member.isfile() or member.issym() or member.islnk()):
        raise SystemExit(f"error: unsupported payload archive member type: {raw}")
    names.add(name)
    if member.issym() or member.islnk():
        target = member.linkname
        if not target or "\\" in target or "\n" in target or "\r" in target:
            raise SystemExit(f"error: unsafe payload link target: {raw}")
        if member.issym():
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
        else:
            resolved = posixpath.normpath(target)
        if posixpath.isabs(target) or (
            resolved != "penguin" and not resolved.startswith("penguin/")
        ):
            raise SystemExit(f"error: payload link escapes penguin/: {raw}")
        links.add(name)

for name in names:
    for parent in PurePosixPath(name).parents:
        if parent.as_posix() in links:
            raise SystemExit(f"error: payload member traverses a link: {name}")
PY
}
"$BUILD_PYTHON" -m pip --version >/dev/null 2>&1 || {
  echo "error: $BUILD_PYTHON must provide pip for the build step" >&2
  exit 1
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
ENHANCED="$WORK_DIR/enhanced"
mkdir -p "$OUTER" "$PAYLOAD" "$ENHANCED"

validate_archive "$INPUT" outer
tar -xzf "$INPUT" -C "$OUTER"

expected_payload="$(awk 'NR == 1 { print $1 }' "$OUTER/payload.tar.gz.sha256")"
if command -v sha256sum >/dev/null 2>&1; then
  actual_payload="$(sha256sum "$OUTER/payload.tar.gz" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual_payload="$(shasum -a 256 "$OUTER/payload.tar.gz" | awk '{ print $1 }')"
else
  echo "error: sha256sum or shasum is required" >&2
  exit 1
fi
[ -n "$expected_payload" ] && [ "$actual_payload" = "$expected_payload" ] || {
  echo "error: standard bundle payload checksum mismatch" >&2
  exit 1
}

validate_archive "$OUTER/payload.tar.gz" payload
tar -xzf "$OUTER/payload.tar.gz" -C "$PAYLOAD"
MANIFEST="$PAYLOAD/penguin/package-manifest.json"
[ -f "$MANIFEST" ] || {
  echo "error: package-manifest.json is missing" >&2
  exit 1
}
target="$(sed -n 's/.*"target"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -n 1)"
[ "$target" = "linux-x64" ] || {
  echo "error: expected a linux-x64 payload, found: ${target:-unknown}" >&2
  exit 1
}

LIBRARY="$PAYLOAD/penguin/lib/node_modules/@prismshadow/penguin-skills/skills"
[ -d "$LIBRARY" ] && [ ! -L "$LIBRARY" ] || {
  echo "error: deployed Skill library not found: $LIBRARY" >&2
  exit 1
}
[ ! -e "$PAYLOAD/penguin/lib/offline" ] || {
  echo "error: standard bundle unexpectedly contains offline resources" >&2
  exit 1
}
[ ! -e "$LIBRARY/word-docx" ] || {
  echo "error: standard bundle already contains word-docx" >&2
  exit 1
}
for file in SKILL.md requirements.lock scripts/bootstrap.py scripts/docx_helper.py; do
  mkdir -p "$LIBRARY/word-docx/$(dirname "$file")"
  cp "$SKILL_SOURCE/$file" "$LIBRARY/word-docx/$file"
done

# Reject legacy or mismatched standard bundles without executing any code from the input archive.
# The deployed loader and installer must be byte-identical to this checkout's current build.
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

WHEELS="$PAYLOAD/penguin/lib/offline/word-docx/wheels"
mkdir -p "$WHEELS"
if [ -n "$SOURCE_WHEELS" ]; then
  export PIP_NO_INDEX=1
  export PIP_FIND_LINKS="$SOURCE_WHEELS"
fi
for minor in 39 310 311 312 313; do
  "$BUILD_PYTHON" -m pip download \
    --disable-pip-version-check \
    --no-deps \
    --only-binary=:all: \
    --platform manylinux_2_17_x86_64 \
    --implementation cp \
    --python-version "$minor" \
    --abi "cp$minor" \
    --require-hashes \
    --requirement "$SKILL_SOURCE/requirements.lock" \
    --dest "$WHEELS"
done
[ "$(find "$WHEELS" -maxdepth 1 -type f -name '*.whl' | wc -l | tr -d ' ')" = "7" ] || {
  echo "error: expected seven locked wheels (five Python ABIs plus two universal wheels)" >&2
  exit 1
}

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

tar -czf "$ENHANCED/payload.tar.gz" -C "$PAYLOAD" penguin
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$ENHANCED" && sha256sum payload.tar.gz > payload.tar.gz.sha256)
else
  (cd "$ENHANCED" && shasum -a 256 payload.tar.gz > payload.tar.gz.sha256)
fi
cp "$OUTER/install.sh" "$ENHANCED/install.sh"
chmod +x "$ENHANCED/install.sh"

mkdir -p "$OUTPUT_DIR"
OUTPUT="$OUTPUT_DIR/penguin-word-docx-linux-x64.tar.gz"
rm -f "$OUTPUT" "$OUTPUT.sha256"
tar -czf "$OUTPUT" -C "$ENHANCED" .
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && sha256sum "$(basename "$OUTPUT")" > "$(basename "$OUTPUT").sha256")
else
  (cd "$OUTPUT_DIR" && shasum -a 256 "$(basename "$OUTPUT")" > "$(basename "$OUTPUT").sha256")
fi

echo "Created $OUTPUT"
echo "Python prerequisite on the target: CPython 3.9-3.13 with venv support."
