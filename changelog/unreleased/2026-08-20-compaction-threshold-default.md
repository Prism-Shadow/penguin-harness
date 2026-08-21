# Compaction threshold default raised to 256000

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `core`, `docs`
- **PR:** [#366](https://github.com/Prism-Shadow/penguin-harness/pull/366)

[中文版](2026-08-20-compaction-threshold-default.zh.md)

Newly created Agents are seeded with `compaction.max_context_length: 256000` instead of
`128000`. The effective threshold is the smaller of that number and the model's
`context_window − COMPACTION_HEADROOM` (2048), taken at every use, so a small-window model
compacts exactly where it did before while a big-window model carries twice the context it
used to before compaction folds it.

## Details

- The seeded value moved into a named constant, `DEFAULT_MAX_CONTEXT_LENGTH` in
  `packages/core/src/state/default-config.ts`. The Agent composition layer reads the same
  constant as its fallback for a config carrying no `compaction` section, so the two sites
  cannot drift apart the way two literals could.
- With the new seed, a 32768-token window still fires compaction at 30720 and a
  200000-token window fires at 197952. A window above 258048 — nearly every entry in the
  built-in model catalog — fires at the seeded 256000 itself.
- A model entry with no usable `context_window` derives from the assumed window of 128000 —
  `DEFAULT_CONTEXT_WINDOW`, a separate constant that happened to hold the same value as the
  old threshold default — and therefore compacts at 125952. A test pins that backstop
  against the shipped constant rather than a stand-in literal, and the comments at both
  constants now name the other one so the two 128000s are not read as one fact.

## Compatibility

- Existing Agents are not migrated. An Agent runs from its `system_config.yaml` verbatim, so
  every Agent already on disk keeps the `compaction.max_context_length` it stores — 128000
  for anything created before this change. Only Projects and Agents created afterwards are
  seeded with 256000.
- Three ways to adopt it on an existing Agent, none automatic: edit
  `compaction.max_context_length` on the **Runtime** tab of the Agent's settings page (or in
  `system_config.yaml` directly), run **Update kernel**, or **Restore default
  configuration**.
- Changing a built-in default advanced `KERNEL_VERSION` to generation `2026-08-20`, with
  `compaction.max_context_length` as its only changed leaf, so existing Agents show the
  kernel-update hint. Under **Update kernel** a stored value still equal to a recorded
  generation's default advances to 256000; a value the user edited is kept and reported.

## Docs

- The bilingual configuration and agent-loop pages record the new default and state which
  number actually fires — the smaller of the seeded threshold and the model window's cap —
  plus what an entry without a `context_window` derives.
