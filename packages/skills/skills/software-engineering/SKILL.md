---
name: software-engineering
description: Complete software-engineering tasks — investigate and review code, implement bug fixes, features and refactors with minimal scope, validate changes, and report verified outcomes.
short_description: Complete software-engineering tasks.
short_description_zh: 完成软件工程任务。
version: 1
updated: 2026-07-18T00:00:00Z
---

# Software Engineering

This skill guides PenguinHarness through general software-engineering work, including code investigation, reviews, bug fixes, features, refactors, and verified handoff.

## Before you start

If the user's message only invokes this skill without a concrete software-engineering task, ask what they want investigated, reviewed, fixed, or implemented. Do not start until the task is clear.

## Workflow

- Match the work to the user's intent. For explanation, review, or planning requests, inspect and report without editing unless a change is also requested. For implementation tasks, carry the requested change through verification and handoff.
- Use the current working directory as the target project and work in place unless the user directs otherwise.
- Preserve worktree changes you did not make. Never revert unrelated user or collaborator work, and do not use destructive Git commands unless explicitly requested.
- Act autonomously and use tools to understand the real code. Resolve minor ambiguity from existing behavior, tests, and repository conventions; ask only when different choices would materially change the requested behavior or scope.
- Before making changes, read the applicable repository instructions (such as `AGENTS.md` or `CLAUDE.md`) and identify the repository-provided build, test, lint, and formatting commands.
- Inspect the relevant implementation, callers, tests, and interfaces before making changes.
- For bug reports, try to reproduce the issue or identify a failing test before editing when feasible. Use the reproduced behavior or failing test to verify the fix afterward.
- Make the smallest coherent change that fully satisfies the request. Follow existing patterns and dependencies, preserve unrelated behavior, and update coupled tests, schemas, configuration, or generated artifacts only when the repository requires it. Never weaken a test to justify the implementation.
- For implementation tasks, do not stop after analysis. Inspect failures, revise the approach, and continue until the change is verified or a concrete blocker remains. Do not repeat a failed action without changing the approach.
- Validate code changes proportionally with repository-provided commands: run the most focused relevant check first and broaden only when useful. Preserve exit status, inspect relevant failure output, and never claim that an unobserved check passed.
- Before finishing a code change, review `git diff` and repository status, remove temporary artifacts, and keep the change limited to the task. Do not commit unless the user or applicable repository instructions require it.

## Handoff

- Keep the final response concise: summarize the outcome or change, list checks actually run and their outcomes, and state any remaining limitation.
