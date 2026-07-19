---
name: data-analysis
description: Complete data-analysis tasks with bounded evidence inspection, explicit answer-changing decisions, native artifact handling, and final output verification.
short_description: Complete data analysis with a bounded, verified method.
short_description_zh: 以有界、可验证的方法完成数据分析任务。
version: 1
updated: 2026-07-18T00:00:00Z
---

# Data Analysis

## Before you start

Require a concrete data-analysis task, its available inputs, and the requested deliverable, location, and format. If the task or required materials are missing or ambiguous in an answer-changing way, ask before calculating or creating outputs. Otherwise proceed without forcing a fixed analysis template.

## Success criteria

- Derive the final result from one committed method: the selected evidence, answer-changing decisions, transformations, calculations, and judgments.
- Produce every output the task asks for, in the requested location and format, and ensure it reflects the committed method.
- Ground each answer-changing choice in the task materials rather than in a merely plausible nearby match.
- Prefer a complete, simple, defensible deliverable over an elaborate or exhaustive analysis that risks not being delivered.

## Constraints

- Use bounded probes first for large, unfamiliar, or expensive-to-read inputs. Narrow the scope, cap output, or use a timeout before expanding.
- Before calculating or producing final outputs, identify the few decisions that can change the answer, such as inclusion or exclusion, matching, boundary choices, transformations, formulas, and ranking criteria. Adapt this check to the task; do not force a fixed analysis template.
- Compare materially plausible alternatives only when they would change the final output. Use the smallest comparison needed to resolve the choice from the task materials, then commit to a method.
- Once the evidence supports a defensible answer, create the requested output files promptly. Do not continue open-ended thinking, searching, or polishing over alternatives that would not change the delivered answer.
- Use intermediate files only when they help compute or verify the result. Preserve the requested output format and structure unless the task asks for a change.
- Satisfy the requested deliverable with the simplest sufficient artifact and implementation. Avoid optional structure, styling, helper code, or reimplementation that is not required by the task.
- Keep final delivery steps short and robust. Avoid putting a long report, large dataset, or large script into one fragile streamed command when the deliverable can be created by shorter steps. Create the required artifact first, then refine only if the required outputs already exist.
- For spreadsheet or Office deliverables, prefer the tool path that preserves the native artifact contract. If a task depends on Excel formula recalculation, data tables, workbook formatting, or Office export, first check whether native Excel automation such as `xlwings` is available before falling back to LibreOffice or a hand-rolled model. Record formulas or inputs that will be temporarily overwritten, restore them before finalizing, and verify that the requested workbook, deck, document, or PDF can be opened and contains the expected tables, sheets, slides, or sections. Do not dump or reimplement an entire workbook when bounded input changes and output reads can answer the task.
- When creating spreadsheet tables, keep each table as one contiguous rectangle: title or caption, row-axis labels, column-axis labels, and data cells should be adjacent and inspectable together. Do not place row labels or key headers outside the visible table bounds or to the left of the title anchor. If you add decorative axis labels, keep the actual machine-readable row and column values inside the same table rectangle.

## Stop rules

- Before finalizing, inspect the requested outputs and check their location, format, shape, and content against the committed method and the task.
- If a later finding changes the method, assumptions, selections, transformations, calculations, decisions, or coverage, regenerate the affected outputs before finalizing.
- Once the requested outputs exist and the relevant checks pass, stop instead of continuing open-ended exploration.
