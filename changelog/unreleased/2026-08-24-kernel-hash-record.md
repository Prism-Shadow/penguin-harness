# The kernel hash record keeps only the hashes a config update can match

- **Date:** 2026-08-24
- **Type:** refactor
- **Scope:** `core`, `docs`
- **PR:** [#N](https://github.com/Prism-Shadow/penguin-harness/pull/N)

[中文版](2026-08-24-kernel-hash-record.zh.md)

Replaced `KERNEL_HASH_HISTORY` — six generations of built-in defaults, each a full snapshot of every kernel-managed leaf — with `KERNEL_HISTORY`, a flat per-leaf record. The snapshots held 158 leaf hashes, 121 of them repeats of a value the kernel update could never consult: it short-circuits on a stored value equal to the current default *before* it looks anything up, so an unchanged leaf's hash decided nothing however many generations repeated it. The record keeps the 37 distinct `(leaf, hash)` pairs, split by the job each one does. Nothing about the update's behaviour moved: every stored value that advanced before still advances, every value kept is still kept, including on configs sitting on the oldest recorded generation.

## Details

- Split the record into three fields. `current` pins the hash of every leaf of today's defaults and anchors the drift guard. `superseded` lists, per leaf and oldest first, the default values earlier kernels shipped — 8 hashes over 6 leaves (`system_prompt`, `compaction.max_context_length`, `memory.prompt`, `tools.builtin.exec_command`, `tools.builtin.input_command`, `tools.builtin.run_subagent`), the only hashes that can turn an untouched old default into an advance. `addedIn` dates the arrival of leaves the record did not start with, and decides whether a default tool missing from a stored `tools.builtin` array is a deliberate removal or a tool the config simply predates; dating it against `KERNEL_VERSION` ages an entry out of "new" at the next bump without an edit.
- Pointed `applyKernelUpdate` at the record through two new helpers, `isSupersededDefault` and `isNewInCurrentKernel`, in place of the generation scans it built per call, and changed its test seam to take a `KernelHistory`. Removed `historicalHashesFor` along with the table it read.
- Carried the per-generation narrative over as comments on the record: the pre-[#257](https://github.com/Prism-Shadow/penguin-harness/pull/257) template with its hardcoded Vault and Skills sections, the toggles generation, `run_subagent` gaining `thinking_level` and then the widened `max` ladder, `compaction.max_context_length` rising to 256000, and the background-execution batch alongside the reworded memory prompt.
- Reworked the pinned-hash guard to compare the recomputed defaults against `KERNEL_HISTORY.current` and report drift as `added` / `changed` / `removed` leaf lists, with the failure message spelling out the edit each list needs — where a changed leaf's previous hash goes, and that a newly added leaf needs an `addedIn` entry to reach existing configs.
- Added an equivalence proof: for all 158 `(leaf, hash)` pairs the generation snapshots recorded, the record reaches the same advance / keep / already-current verdict the table did, and each leaf's `addedIn` date matches its first appearance there. Kept the retired table as a frozen test fixture so the proof keeps running as later kernels append to `superseded`.
- Updated the developer paragraph in the configuration guide to describe the new record and the edits a default change calls for.
