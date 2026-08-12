---
name: powerpoint-pptx
description: Inspect Microsoft PowerPoint .pptx files and append a title-and-body slide fully offline with bundled deterministic tooling. Use for reading slide text or adding a final slide while preserving the source file. When selected, first read this installed Skill's SKILL.md in full, then use only its bundled scripts/bootstrap.py helper; never write an ad-hoc PPTX script, edit OOXML directly, or install dependencies online.
short_description: Inspect PPTX files and append slides with the bundled offline helper.
short_description_zh: 使用内置离线工具检查 PPTX 并追加幻灯片。
version: 1
updated: 2026-08-11T06:00:00Z
---

# PowerPoint PPTX

Use the fixed helper shipped with this Skill. Do not install packages, access the
network, generate another editing script, or edit PPTX OOXML directly.

## Before you start

Require an existing `.pptx` input and either an inspection request or a title and
body for one new slide. For an edit, require a distinct new `.pptx` output path.
Ask only when a required value is missing.

Set `SKILL_DIR` to the directory containing this `SKILL.md`. The offline profile
supplies all Python packages but requires system CPython 3.9-3.13 with `venv`.
Set `PYTHON=python3` on Linux/macOS or `PYTHON=python` on Windows, then run:

```bash
"$PYTHON" -I "$SKILL_DIR/scripts/bootstrap.py" inspect \
  --input "/absolute/input.pptx"

"$PYTHON" -I "$SKILL_DIR/scripts/bootstrap.py" append-slide \
  --input "/absolute/input.pptx" \
  --output "/absolute/output.pptx" \
  --title "New slide title" \
  --body "New slide body"
```

The bootstrap creates and reuses `shared_env/powerpoint-pptx`; never create or
select an environment yourself. The helper refuses to overwrite its input or an
existing output. It preserves existing slides, saves the new file, reopens it with
`python-pptx`, verifies the slide count and text, and returns JSON. Report the
verified output path from that result.

This first version only inspects text and appends one title-and-body slide. If the
request needs arbitrary shape edits, animations, charts, notes, or layout redesign,
state that the operation is outside this Helper's current scope instead of writing
a replacement script.
