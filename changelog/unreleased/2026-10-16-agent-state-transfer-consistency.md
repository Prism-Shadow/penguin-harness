# Serialized Agent State transfers

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1175](https://github.com/Prism-Shadow/penguin-harness/pull/1175)

[中文版](2026-10-16-agent-state-transfer-consistency.zh.md)

Serialized snapshot creation and package imports for each Agent. Concurrent imports checked the version committed by the preceding transfer, and failed transfers released the queue for subsequent requests.

## Details

- Keyed transfer queues by the real Agent directory, so filesystem aliases shared the same queue, and retained in-flight queues across platform reloads.
- Preserved the current vault by stopping imports when reading it failed for reasons other than a missing file.
- Retained the previous Agent State in staging when both replacement and rollback failed, and included its recovery path in the error.
- Removed incomplete snapshot archives after packing or publication failed.
- Added HTTP scenarios covering concurrent transfers, filesystem aliases, platform reloads, independent Agents, archive-based Agent creation, and recovery from real filesystem failures.
