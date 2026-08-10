#!/bin/sh
# Run the enhanced Linux x64 bundle in a read-only, network-disabled Docker container.
# Pull/build the image before disconnecting; this script deliberately never pulls it.
#
# Usage: test-word-docx-offline.sh <penguin-word-docx-linux-x64.tar.gz> [python-image]
set -eu

ROOT_DIR="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
BUNDLE_INPUT="${1:?usage: test-word-docx-offline.sh <bundle.tar.gz> [python-image]}"
IMAGE="${2:-python:3.13-slim}"
case "$BUNDLE_INPUT" in
  /*) BUNDLE="$BUNDLE_INPUT" ;;
  *) BUNDLE="$ROOT_DIR/$BUNDLE_INPUT" ;;
esac
[ -f "$BUNDLE" ] || {
  echo "error: bundle not found: $BUNDLE" >&2
  exit 1
}
command -v docker >/dev/null 2>&1 || {
  echo "error: docker is required" >&2
  exit 1
}
USE_SUDO=0
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    USE_SUDO=1
  else
    echo "error: current user cannot access the Docker daemon" >&2
    exit 1
  fi
fi
run_docker() {
  if [ "$USE_SUDO" -eq 1 ]; then sudo -n docker "$@"; else docker "$@"; fi
}
run_docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  echo "error: Docker image is not local: $IMAGE (pull it before the offline test)" >&2
  exit 1
}

run_docker run --rm \
  --interactive \
  --network none \
  --read-only \
  --tmpfs /tmp:exec,mode=1777 \
  --mount "type=bind,src=$BUNDLE,dst=/bundle.tar.gz,readonly" \
  --env HOME=/tmp/home \
  "$IMAGE" sh -s <<'CONTAINER'
set -eu

mkdir -p /tmp/bundle /tmp/home
tar -xzf /bundle.tar.gz -C /tmp/bundle
PENGUIN_INSTALL_DIR=/tmp/penguin \
PENGUIN_BIN_DIR=/tmp/bin \
PENGUIN_HOME=/tmp/data \
  /tmp/bundle/install.sh >/tmp/install.log

library=/tmp/penguin/lib/node_modules/@prismshadow/penguin-skills/skills/word-docx
skill=/tmp/data/default_project/agents/default_agent/agent_state/skills/word-docx
test -f "$library/scripts/bootstrap.py"
test -f "$library/scripts/docx_helper.py"
test -f "$library/requirements.lock"
test "$(find /tmp/penguin/lib/offline/word-docx/wheels -type f -name '*.whl' | wc -l | tr -d ' ')" = 7

# Agent initialization happens before model resolution. A clean test home has no model, so the
# command is expected to stop afterwards; its installed Skill tree must still be complete.
PENGUIN_HOME=/tmp/data /tmp/penguin/bin/penguin run --message init >/tmp/init.log 2>&1 || true
test -f "$skill/scripts/bootstrap.py"
test -f "$skill/scripts/docx_helper.py"
test -f "$skill/requirements.lock"

if python3 -I -c 'import docx' >/dev/null 2>&1; then
  echo "error: test image already has python-docx globally installed" >&2
  exit 1
fi

export PENGUIN_OFFLINE_ROOT=/tmp/penguin/lib/offline
export PIP_TARGET=/tmp/escaped-pip-target
export PIP_USER=1
export PYTHONHOME=/tmp/invalid-python-home
export PYTHONPATH=/tmp/invalid-python-path
python3 -I "$skill/scripts/bootstrap.py" --help >/tmp/bootstrap.log
environment=/tmp/data/default_project/agents/default_agent/shared_env/word-docx
test -x "$environment/bin/python"
test ! -e /tmp/escaped-pip-target

"$environment/bin/python" -I - <<'PY'
from docx import Document
document = Document()
document.add_paragraph("old text")
document.save("/tmp/input.docx")
PY
source_hash="$(sha256sum /tmp/input.docx | awk '{ print $1 }')"
python3 -I "$skill/scripts/bootstrap.py" inspect --input /tmp/input.docx >/tmp/inspect.json
python3 -I "$skill/scripts/bootstrap.py" append \
  --input /tmp/input.docx \
  --output /tmp/appended.docx \
  --heading "Offline heading" \
  --paragraph "Offline paragraph" >/tmp/append.json
python3 -I "$skill/scripts/bootstrap.py" replace \
  --input /tmp/appended.docx \
  --output /tmp/replaced.docx \
  --old "old text" \
  --new "new text" >/tmp/replace.json
test "$source_hash" = "$(sha256sum /tmp/input.docx | awk '{ print $1 }')"

"$environment/bin/python" -I - <<'PY'
import json
from docx import Document

for path in ("/tmp/inspect.json", "/tmp/append.json", "/tmp/replace.json"):
    with open(path, encoding="utf-8") as result:
        assert json.load(result)["verified"] is True
texts = [paragraph.text for paragraph in Document("/tmp/replaced.docx").paragraphs]
assert "new text" in texts
assert "Offline heading" in texts
assert "Offline paragraph" in texts
PY

if python3 -I -c 'import docx' >/dev/null 2>&1; then
  echo "error: python-docx leaked into the system Python" >&2
  exit 1
fi
echo "Offline word-docx acceptance passed (Docker --network none)."
CONTAINER
