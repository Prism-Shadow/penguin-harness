# Design RFCs (PRFC)

This directory is PenguinHarness's design RFC surface: one design decision per document, named `PRFC-NNNN-slug.md`. Every document here was migrated from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design), where the same files live under its `rfcs/` directory. The migration collected both states: the documents landed on that repository's default branch, and the drafts still carried by its open or draft design pull requests. The landed documents are in this directory; each draft arrives in its own pull request, and until then its index row names the document without a link.

[中文版](README.zh.md)

## Conventions for this surface

1. **An RFC and the implementation changes it corresponds to are never submitted in the same pull request**; the two merge independently.
2. **Once an RFC has landed, it should not be modified frequently.**
3. **When a modification is truly needed, the version number (rev) must be raised** — e.g. `v2.0.0`.
4. **Every modification lists that revision's change items at the end of the document, under a `## Changes` section** — `### v2.0.0` with `- Added…` / `- Removed…` / `- Updated…` entries.

## Shape of a document

Each document keeps its original title line (`# PRFC-NNNN …`), metadata bullets and body; section names follow the Rust RFC template. Every RFC is a pair — `PRFC-NNNN-slug.md` in English and `PRFC-NNNN-slug.zh.md` in Chinese, the same design in both languages — and the language link at the top of each file switches between them; the index below links the English file. The migration added exactly two things to each file:

- a **provenance marker** right under the title: the source file in the design repository, its state there — landed on the default branch, or the open or draft design PR that carries the draft — and the current rev;
- a **`## Changes` section at the end**, recording every revision the document goes through, starting at `v1.0.0`.

The body carries the design repository's text. Where an RFC has pending revisions not yet integrated, the body keeps the current landed version and the provenance marker records the pending items; when the design repository settles them, the update arrives here as a rev bump with its change items listed in the `## Changes` section.

## Numbering

Numbers and filenames carry over from the design repository unchanged. Two drafts share the number `0005` — PRFC-0005-mechanisms-not-implementations.md and PRFC-0005-plugin-versioning.md — two independent design lines that each took the number before either landed; they are distinct documents, not revisions of one another. The number `0013` is retired: the HMR RFC was drafted as PRFC-0013 and renumbered to PRFC-0002 before it landed.

## Index

| Document | Title | Status |
| --- | --- | --- |
| [PRFC-0001-module.md](PRFC-0001-module.md) | Module | landed |
| [PRFC-0002-hmr.md](PRFC-0002-hmr.md) | HMR v1: one layer at `/api/hmr`, depends only on http and log | landed |
| [PRFC-0003-plugin.md](PRFC-0003-plugin.md) | Plugin | landed |
| PRFC-0004-plugin-scope.md | Plugin Scope | draft |
| PRFC-0005-mechanisms-not-implementations.md | Depend on Mechanisms, Not Implementations | draft |
| PRFC-0005-plugin-versioning.md | Plugin Versioning | draft |
| PRFC-0006-plugin-distribution.md | Plugin Distribution and Installation | draft |
| [PRFC-0007-schema-migrations.md](PRFC-0007-schema-migrations.md) | Schema changes are ordered, timestamped migrations that run once | landed |
| PRFC-0008-telemetry.md | Telemetry: let the system say where time goes and where messages stop | draft |
| [PRFC-0009-sandbox.md](PRFC-0009-sandbox.md) | Sandbox: policy fails closed, backend is a plugin | landed |
| PRFC-0010-ui-modules.md | UI Modules: Web App is a module tree, pages and global UI are contributions | open |
| PRFC-0011-single-socket.md | Single Socket | draft |
| PRFC-0012-chat-bots.md | Chat bots that start agents from chat are a plugin concern | draft |
| [PRFC-0014-workflow.md](PRFC-0014-workflow.md) | Workflow: a module tree in the Agent directory | landed |
| [PRFC-0015-agent-state.md](PRFC-0015-agent-state.md) | Agent State Component: hand off state during HMR, running tasks are not interrupted | landed |
| PRFC-0016-company-proposals.md | Company Mode Proposals: a person reads one, an Agent builds one simultaneously | draft |
| PRFC-0017-session-surface.md | Session Surface | draft |
| [PRFC-0018-amsp.md](PRFC-0018-amsp.md) | AMSP and Agent API | landed |
| [PRFC-0019-rsi-toolkits.md](PRFC-0019-rsi-toolkits.md) | RSI Toolkits | landed |
| [PRFC-0020-agent-workbench.md](PRFC-0020-agent-workbench.md) | Agent Workbench: app naming, plugin distribution, and product support | landed |
| [PRFC-0022-rfc-invariant.md](PRFC-0022-rfc-invariant.md) | RFC Invariants: a permanent section for what must always hold | draft |
