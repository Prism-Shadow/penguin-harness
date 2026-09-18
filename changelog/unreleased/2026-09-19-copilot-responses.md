# Copilot catalog routing and Responses support

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `core`, `server`, `docs`
- **PR:** [#6](https://github.com/nicolaepocroianu/penguin-harness/pull/6)

[中文版](2026-09-19-copilot-responses.zh.md)

Updated the development AgentHub adapter patch to request Copilot's agentic-workflows catalog and support models advertising the Responses API.

## Details

- Selected Responses or Chat Completions from model metadata and kept the selection stable for each model client.
- Preserved Penguin's tool execution, approvals, history, cancellation, and retry ownership.
- Excluded models explicitly disabled by policy and kept credentials scoped to the project.
