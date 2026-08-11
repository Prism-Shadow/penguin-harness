#!/bin/sh
# Run the Linux x64 offline-profile bundle in a read-only, network-disabled Docker container.
# Pull/build the image before disconnecting; this script deliberately never pulls it.
#
# Usage: test-offline-bundle.sh <penguin-offline-linux-x64.tar.gz> [python-image]
set -eu

ROOT_DIR="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
BUNDLE_INPUT="${1:?usage: test-offline-bundle.sh <bundle.tar.gz> [python-image]}"
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

library=/tmp/penguin/lib/node_modules/@prismshadow/penguin-skills/skills
skills=/tmp/data/default_project/agents/default_agent/agent_state/skills
for file in \
  word-docx/SKILL.md word-docx/icon.svg word-docx/scripts/bootstrap.py word-docx/scripts/docx_helper.py word-docx/requirements.lock \
  powerpoint-pptx/SKILL.md powerpoint-pptx/icon.svg powerpoint-pptx/scripts/bootstrap.py powerpoint-pptx/scripts/pptx_helper.py powerpoint-pptx/requirements.lock \
  pdf-tools/SKILL.md pdf-tools/icon.svg pdf-tools/scripts/bootstrap.py pdf-tools/scripts/pdf_helper.py pdf-tools/requirements.lock; do
  test -f "$library/$file"
done
test -f /tmp/penguin/lib/offline/_shared/bootstrap_runtime.py
test "$(find /tmp/penguin/lib/offline/wheels -type f -name '*.whl' | wc -l | tr -d ' ')" = 15

# Prove the installed launcher exports the package's resource root to its Node child. The direct
# Python Helper checks below then reuse the observed value instead of assuming the path.
/tmp/penguin/node/bin/node -e '
  require("node:fs").writeFileSync(
    "/tmp/offline-profile-probe.cjs",
    "require(\"node:fs\").writeFileSync(\"/tmp/offline-root.txt\", process.env.PENGUIN_OFFLINE_ROOT || \"\");"
  )
'
NODE_OPTIONS=--require=/tmp/offline-profile-probe.cjs \
  /tmp/penguin/bin/penguin --version >/tmp/version.log
test "$(cat /tmp/offline-root.txt)" = /tmp/penguin/lib/offline

# Agent initialization happens before model resolution. A clean test home has no model, so the
# command is expected to stop afterwards; its installed Skill tree must still be complete.
PENGUIN_HOME=/tmp/data /tmp/penguin/bin/penguin run --message init >/tmp/init.log 2>&1 || true
for file in \
  word-docx/SKILL.md word-docx/icon.svg word-docx/scripts/bootstrap.py word-docx/scripts/docx_helper.py word-docx/requirements.lock \
  powerpoint-pptx/SKILL.md powerpoint-pptx/icon.svg powerpoint-pptx/scripts/bootstrap.py powerpoint-pptx/scripts/pptx_helper.py powerpoint-pptx/requirements.lock \
  pdf-tools/SKILL.md pdf-tools/icon.svg pdf-tools/scripts/bootstrap.py pdf-tools/scripts/pdf_helper.py pdf-tools/requirements.lock; do
  test -f "$skills/$file"
done

for module in docx pptx pypdf; do
  if python3 -I -c "import $module" >/dev/null 2>&1; then
    echo "error: test image already has $module globally installed" >&2
    exit 1
  fi
done

PENGUIN_OFFLINE_ROOT="$(cat /tmp/offline-root.txt)"
export PENGUIN_OFFLINE_ROOT
export PIP_TARGET=/tmp/escaped-pip-target
export PIP_USER=1
export PYTHONHOME=/tmp/invalid-python-home
export PYTHONPATH=/tmp/invalid-python-path
python3 -I "$skills/word-docx/scripts/bootstrap.py" --help >/tmp/docx-bootstrap.log
python3 -I "$skills/powerpoint-pptx/scripts/bootstrap.py" --help >/tmp/pptx-bootstrap.log
python3 -I "$skills/pdf-tools/scripts/bootstrap.py" --help >/tmp/pdf-bootstrap.log
word_environment=/tmp/data/default_project/agents/default_agent/shared_env/word-docx
pptx_environment=/tmp/data/default_project/agents/default_agent/shared_env/powerpoint-pptx
pdf_environment=/tmp/data/default_project/agents/default_agent/shared_env/pdf-tools
test -x "$word_environment/bin/python"
test -x "$pptx_environment/bin/python"
test -x "$pdf_environment/bin/python"
test ! -e /tmp/escaped-pip-target

"$word_environment/bin/python" -I - <<'PY'
from docx import Document
document = Document()
document.add_paragraph("old text")
document.save("/tmp/input.docx")
PY
source_hash="$(sha256sum /tmp/input.docx | awk '{ print $1 }')"
python3 -I "$skills/word-docx/scripts/bootstrap.py" inspect --input /tmp/input.docx >/tmp/inspect.json
python3 -I "$skills/word-docx/scripts/bootstrap.py" append \
  --input /tmp/input.docx \
  --output /tmp/appended.docx \
  --heading "Offline heading" \
  --paragraph "Offline paragraph" >/tmp/append.json
python3 -I "$skills/word-docx/scripts/bootstrap.py" replace \
  --input /tmp/appended.docx \
  --output /tmp/replaced.docx \
  --old "old text" \
  --new "new text" >/tmp/replace.json
test "$source_hash" = "$(sha256sum /tmp/input.docx | awk '{ print $1 }')"

"$word_environment/bin/python" -I - <<'PY'
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

# A DOCX without Word's built-in Heading 1 style must still accept a heading. The helper
# falls back to a bold ordinary paragraph and must leave the source byte-for-byte unchanged.
"$word_environment/bin/python" -I - <<'PY'
from docx import Document

document = Document()
heading = document.styles["Heading 1"]
document.styles.element.remove(heading._element)
document.add_paragraph("Document without heading styles")
document.save("/tmp/no-heading.docx")
assert "Heading 1" not in Document("/tmp/no-heading.docx").styles
PY
no_heading_hash="$(sha256sum /tmp/no-heading.docx | awk '{ print $1 }')"
python3 -I "$skills/word-docx/scripts/bootstrap.py" append \
  --input /tmp/no-heading.docx \
  --output /tmp/no-heading-appended.docx \
  --heading "Fallback heading" >/tmp/no-heading-append.json
test "$no_heading_hash" = "$(sha256sum /tmp/no-heading.docx | awk '{ print $1 }')"

"$word_environment/bin/python" -I - <<'PY'
import json
from docx import Document

with open("/tmp/no-heading-append.json", encoding="utf-8") as result:
    assert json.load(result)["verified"] is True
document = Document("/tmp/no-heading-appended.docx")
paragraph = next(item for item in document.paragraphs if item.text == "Fallback heading")
assert "Heading 1" not in document.styles
assert any(run.text == "Fallback heading" and run.bold is True for run in paragraph.runs)
PY

# PPTX: preserve three existing slides, append one slide, then reopen and inspect its text.
"$pptx_environment/bin/python" -I - <<'PY'
from pptx import Presentation

presentation = Presentation()
for title, body in (("Slide 1", "Body 1"), ("Slide 2", "Body 2"), ("Slide 3", "Body 3")):
    slide = presentation.slides.add_slide(presentation.slide_layouts[1])
    slide.shapes.title.text = title
    slide.placeholders[1].text = body
presentation.save("/tmp/input.pptx")
PY
pptx_hash="$(sha256sum /tmp/input.pptx | awk '{ print $1 }')"
python3 -I "$skills/powerpoint-pptx/scripts/bootstrap.py" inspect \
  --input /tmp/input.pptx >/tmp/pptx-inspect.json
python3 -I "$skills/powerpoint-pptx/scripts/bootstrap.py" append-slide \
  --input /tmp/input.pptx \
  --output /tmp/output.pptx \
  --title "Slide 4" \
  --body "Offline PPTX body" >/tmp/pptx-append.json
test "$pptx_hash" = "$(sha256sum /tmp/input.pptx | awk '{ print $1 }')"

"$pptx_environment/bin/python" -I - <<'PY'
import json
from pptx import Presentation

for path in ("/tmp/pptx-inspect.json", "/tmp/pptx-append.json"):
    with open(path, encoding="utf-8") as result:
        assert json.load(result)["verified"] is True
presentation = Presentation("/tmp/output.pptx")
assert len(presentation.slides) == 4
texts = [shape.text for shape in presentation.slides[-1].shapes if getattr(shape, "has_text_frame", False)]
assert "Slide 4" in texts
assert "Offline PPTX body" in texts
PY

# PDF: merge two pages and one appendix page; distinct widths prove the requested page order.
"$pdf_environment/bin/python" -I - <<'PY'
from pypdf import PdfWriter

main = PdfWriter()
main.add_blank_page(width=200, height=500)
main.add_blank_page(width=300, height=500)
with open("/tmp/main.pdf", "wb") as output:
    main.write(output)
appendix = PdfWriter()
appendix.add_blank_page(width=400, height=500)
with open("/tmp/appendix.pdf", "wb") as output:
    appendix.write(output)
PY
main_hash="$(sha256sum /tmp/main.pdf | awk '{ print $1 }')"
appendix_hash="$(sha256sum /tmp/appendix.pdf | awk '{ print $1 }')"
python3 -I "$skills/pdf-tools/scripts/bootstrap.py" inspect \
  --input /tmp/main.pdf >/tmp/pdf-inspect.json
python3 -I "$skills/pdf-tools/scripts/bootstrap.py" merge \
  --input /tmp/main.pdf \
  --input /tmp/appendix.pdf \
  --output /tmp/output.pdf >/tmp/pdf-merge.json
test "$main_hash" = "$(sha256sum /tmp/main.pdf | awk '{ print $1 }')"
test "$appendix_hash" = "$(sha256sum /tmp/appendix.pdf | awk '{ print $1 }')"

"$pdf_environment/bin/python" -I - <<'PY'
import json
from pypdf import PdfReader

for path in ("/tmp/pdf-inspect.json", "/tmp/pdf-merge.json"):
    with open(path, encoding="utf-8") as result:
        assert json.load(result)["verified"] is True
reader = PdfReader("/tmp/output.pdf")
assert [float(page.mediabox.width) for page in reader.pages] == [200.0, 300.0, 400.0]
PY

for module in docx pptx pypdf; do
  if python3 -I -c "import $module" >/dev/null 2>&1; then
    echo "error: $module leaked into the system Python" >&2
    exit 1
  fi
done
echo "Offline profile DOCX/PPTX/PDF acceptance passed (Docker --network none)."
CONTAINER
