---
name: word-docx
description: Inspect and edit Microsoft Word .docx files fully offline with bundled deterministic tooling. Use for reading paragraphs, appending headings or paragraphs, and replacing ordinary text while preserving the source file. When selected, first read this installed Skill's SKILL.md in full, then use only its bundled scripts/bootstrap.py helper; never write an ad-hoc DOCX editing script or install dependencies online.
short_description: Inspect and edit DOCX files with the bundled offline helper.
short_description_zh: 使用内置离线工具检查和编辑 DOCX 文件。
version: 2
updated: 2026-08-10T07:18:32Z
---

# Word DOCX

Use the fixed helper shipped with this Skill. Do not install packages, access the
network, generate another editing script, or edit DOCX XML directly.

## Before you start

Require an existing `.docx` input, a concrete requested change, and a distinct new
`.docx` output path. Ask only when one of these is missing.

Set `SKILL_DIR` to the directory containing this `SKILL.md`. The enhanced package
supplies all Python packages but requires system CPython 3.9-3.13 with `venv`;
report the bootstrap error if that prerequisite is absent. Run one command:

```bash
python3 -I "$SKILL_DIR/scripts/bootstrap.py" inspect --input "/absolute/input.docx"

python3 -I "$SKILL_DIR/scripts/bootstrap.py" append \
  --input "/absolute/input.docx" \
  --output "/absolute/output.docx" \
  --heading "New heading" \
  --paragraph "New paragraph"

python3 -I "$SKILL_DIR/scripts/bootstrap.py" replace \
  --input "/absolute/input.docx" \
  --output "/absolute/output.docx" \
  --old "old text" \
  --new "new text"
```

`--paragraph` may be repeated. `append` also accepts `--heading-level 1` through
`9`. Replacement operates within ordinary text runs so character formatting is
preserved; text split across runs, fields, or hyperlinks is deliberately left unchanged.
The bootstrap creates and reuses the controlled Agent environment
`shared_env/word-docx`; never create or select an environment yourself.

The helper refuses to overwrite the input or an existing output. It saves the new
file, reopens it with `python-docx`, verifies the requested content, and returns a
JSON result. Report the verified output path from that result.
