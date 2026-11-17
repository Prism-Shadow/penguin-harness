# The compaction e2e test matches the current chat and Trace views

- **Date:** 2026-11-12
- **Type:** process
- **Scope:** `web`
- **PR:** [#1538](https://github.com/Prism-Shadow/penguin-harness/pull/1538)

[中文版](2026-11-12-compaction-e2e-context-ring.zh.md)

Updated three stale assertions in the "compaction mid-turn" web end-to-end test, so it passes again and the checks after its first failure run.

## Details

- The test reads the composer's context ring after a compaction by its role and accessible name, instead of waiting for a `—/240` figure the ring stopped printing in [#442](https://github.com/Prism-Shadow/penguin-harness/pull/442).
- It opens the compaction row's 「压缩结果」 section before looking for the summary, following the two-layer row from [#582](https://github.com/Prism-Shadow/penguin-harness/pull/582).
- It reads each Trace round's number off the round's own row, since the rounds button from [#1305](https://github.com/Prism-Shadow/penguin-harness/pull/1305) also names the round in view.
