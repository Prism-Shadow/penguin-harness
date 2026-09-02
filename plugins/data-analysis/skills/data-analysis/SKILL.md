---
name: data-analysis
description: Complete data-analysis tasks with bounded inspection, correct data semantics, native artifact handling, complete delivery, and risk-based verification.
---

# Data Analysis

Deliver the requested result and artifacts. Do not turn the task into a proof
exercise or add evidence, reports, explanations, or intermediate files that
were not requested.

## Before you start

Require a concrete data-analysis task, its available inputs, and the requested
deliverable, location, and format. Ask only when missing information prevents a
defensible result and would materially change the deliverable; otherwise proceed.

## Contract

Read the task, supplied inputs, and relevant data documentation. Identify every
required output path and format, plus only the definitions that can change the
result: scope, observation grain, keys, units, operators, ordering, coverage,
and explicit formatting rules. Treat examples as illustrative unless the task
makes them normative.

If information is incomplete or ambiguous, first resolve it from the supplied
materials. Ask only when the missing choice prevents a defensible result and
would materially change the deliverable. Otherwise choose the best-supported
interpretation and proceed.

## Bounded inspection

For large or unfamiliar inputs, begin with a bounded inventory, schema check,
targeted sample, or narrow query. Expand inspection only when it can change a
selection, transformation, calculation, or output. Do not exhaustively read or
render data merely to increase confidence.

## Data semantics

Compute at the correct row or entity grain. Evaluate conjunctive conditions on
the same record or entity; do not replace row-level matching with unions of
separate field values. Preserve nulls, exclusions, and explicit prohibitions.
Enumerated outputs must cover the complete requested universe.

Ground answer-changing choices in the task and supplied data. Preserve
documented source semantics, units, mappings, and native workflow behavior when
they define the requested result. Do not reproduce an apparent source or tool
defect merely for consistency. When plausible methods disagree, compare only
the smallest answer-changing difference, choose the best-supported method, and
use it consistently.

## Native artifacts

Preserve the requested artifact type and structure. When correctness depends on
spreadsheet formulas, recalculation, formatting, database semantics, document
layout, or export behavior, prefer a tool path that preserves and can verify
those native properties. Restore temporarily changed inputs or formulas before
finalizing. Use intermediate files only when they help produce or verify the
requested deliverable.

## Delivery

As soon as a complete best-supported result exists, write every requested
artifact at its exact path. For a multi-artifact task, establish a valid version
of every artifact before refining any one of them. Do not leave a required
artifact missing while pursuing additional certainty, polish, or diagnostics.
If later evidence changes the result, update the artifact.

## Verification

Choose checks in proportion to answer-changing risk. Use the smallest
independent check that can falsify each load-bearing assumption or computation.
If a check disagrees, isolate and resolve the concrete difference. Do not repeat
equivalent searches, calculations, renders, or inspections once remaining
uncertainty cannot change the deliverable.

## Final check

Reopen the actual deliverables and verify their path, format, schema or
structure, values, coverage, and openability as applicable. Confirm that every
requested artifact exists and reflects the chosen method. Report the output
paths concisely and stop.
