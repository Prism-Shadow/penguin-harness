# Backward compatibility: stored `read_image` / `describe_image` entries and the older `read_file`

- **Date:** 2026-09-02
- **Type:** process
- **Scope:** `core`, `web`
- **PR:** [#588](https://github.com/Prism-Shadow/penguin-harness/pull/588)
- **Breaking:** yes — the `read_image` and `describe_image` tool names are gone; an existing Agent's stored entries stop assembling, and a model calling either gets the unknown-tool reply until the Agent's kernel is updated

[中文版](2026-09-02-backward-compatibility-read-file-images.zh.md)

[Image reading folds into `read_file`](2026-09-02-read-file-images.md) removes two built-in tools that every existing Agent's `system_config.yaml` lists under `tools.builtin`, and changes the definition of a third. Nothing on disk is rewritten; this entry records what an existing install sees and what, if anything, to do.

## Stored tool entries: skipped, not migrated

An Agent created before this release carries a `read_image` (`forModel: vision`) and a `describe_image` (`forModel: text-only`) entry, and a `read_file` entry with the text-only description, no `prompt` argument and a 30000 ms timeout. Chosen: the precedent set when `kill_command` / `kill_subagent` left — an entry whose name has no factory in the registry is **skipped at assembly**: not listed to the model, and a call by the old name gets the standard unknown-tool reply. No alias, no load-time rewrite. The stored `read_file` entry still assembles onto the new implementation, so its image branch already works; the model is merely told the old description, has no `prompt` in its schema, and keeps the 30000 ms timeout.

Without any action, such an Agent therefore loses its image tools by name and gains image reading under `read_file` without being told. To adopt the current definitions:

- **Kernel update** (the badge on the Agents page, or the settings page's kernel action): the kernel version advanced to `2026-09-02`, so every existing Agent is flagged. A tools tab the user never edited advances whole — the new `read_file` entry in, the two image entries out. A tools tab with any customization is kept, as always; restoring the default config or a hand edit (copy the entry from `packages/core/src/state/default-config.ts`) is the recourse there.
- Nothing else. The skip is the registry's standing behavior, not a shim: there is no compatibility code to remove later.

Alternatives not taken: a load-time migration that rewrites `tools.builtin` in place (a silent edit of a user-owned file), and keeping `read_image` / `describe_image` assembling as aliases of `read_file` for a few releases (three names on the model's tool list, and the same cleanup deferred).

## Old Traces

Traces written before this release carry `read_image` / `describe_image` tool calls. They render as before — the tool name and its arguments — and the Web tool card previews them by their `source` argument like a file path (`LEGACY_IMAGE_TOOLS` in `tool-call-card.tsx`). That mapping is display-only and can go once Traces from before 2026-09-02 no longer need rendering; nobody is scheduled to remove it.

## Compatibility

No action is required to keep working: an existing Agent reads images through `read_file` as soon as it tries, but is only told so — and only gets `prompt` and the 60000 ms timeout — after a kernel update or a default restore, and until then a model that still calls `read_image` / `describe_image` gets the unknown-tool reply. Scripts and prompts that name those tools switch to `read_file`.
