---
name: pdf-tools
description: Inspect and merge existing PDF files fully offline with bundled deterministic tooling. Use for reading page counts and extractable text or combining PDFs in a specified order while preserving every source file. When selected, first read this installed Skill's SKILL.md in full, then use only its bundled scripts/bootstrap.py helper; never write an ad-hoc PDF script, rewrite PDF objects directly, or install dependencies online.
short_description: Inspect and merge PDFs with the bundled offline helper.
short_description_zh: 使用内置离线工具检查和合并 PDF 文件。
version: 1
updated: 2026-08-11T06:00:00Z
---

# PDF Tools

Use the fixed helper shipped with this Skill. Do not install packages, access the
network, generate another processing script, or rewrite PDF objects directly.

## Before you start

Require existing `.pdf` inputs and either an inspection request or an explicit
merge order. For a merge, require at least two inputs and a distinct new `.pdf`
output path. Ask only when a required value is missing.

Set `SKILL_DIR` to the directory containing this `SKILL.md`. The offline profile
supplies all Python packages but requires system CPython 3.9-3.13 with `venv`.
Set `PYTHON=python3` on Linux/macOS or `PYTHON=python` on Windows, then run:

```bash
"$PYTHON" -I "$SKILL_DIR/scripts/bootstrap.py" inspect \
  --input "/absolute/input.pdf"

"$PYTHON" -I "$SKILL_DIR/scripts/bootstrap.py" merge \
  --input "/absolute/first.pdf" \
  --input "/absolute/second.pdf" \
  --output "/absolute/output.pdf"
```

Repeat `--input` in the exact required page order. The bootstrap creates and
reuses `shared_env/pdf-tools`; never create or select an environment yourself.
The helper refuses encrypted inputs, input/output aliasing, and existing outputs.
It saves the merged file, reopens it with `pypdf`, verifies page order and source
hashes, and returns JSON. Report the verified output path from that result.

This first version only inspects and merges PDFs. It does not edit text already
painted on a page, perform OCR, fill forms, or add signatures. State that those
operations are outside the current Helper's scope instead of writing a replacement
script.
