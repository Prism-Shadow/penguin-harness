# The hub deletes a remote conversation's cached history a week after its last read

- **Date:** 2026-11-02
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1432](https://github.com/Prism-Shadow/penguin-harness/pull/1432)

[中文版](2026-11-02-history-cache-retention.zh.md)

A server that connects machines no longer kept its copy of their Trace lines for good. A conversation's copy, its subagents' with it, was deleted once nobody had read it for 7 days, and was fetched from the machine again the next time the conversation was opened.

## Details

- A read was any window, folded value, image or Trace panel page of the conversation, whether the machine was asked or the copy answered alone. A conversation an open read was using was never deleted, and the 1 GiB cap stayed as a second bound.
- The check ran as the server started, after each history stream finished, and once a day while the server kept running. A machine's directory that it left empty was removed too, and a server that had never cached anything still created no directory.
- The read time was written into the copy's sidecars at most once an hour and read back at start, so a restart no longer counted every cached conversation as just read.
- Copies already on disk kept their format: those nobody had read for a week were deleted on the first start after the upgrade.
