# Agent config kernel version: dated generations with a smart update

`system_config.yaml` is baked at agent creation and never auto-upgraded, so until now the only way to newer built-in defaults was a full restore that discarded every customization. Agent configs now carry a **kernel version** (#260): a date, `kernel_version: 2026-08-11`, recording which generation of built-in defaults the config was created from or last updated to. Creation and "restore defaults" both stamp it; ordinary config edits never touch it (it is unrelated to `version`, the optimization counter).

## Development-side bumps, mechanically enforced

The version only moves when development changes the defaults, and it cannot be forgotten: a guard test pins the hash of every leaf default to the latest entry of a per-generation history table, so any default change fails CI until `KERNEL_VERSION` gets a new date and the table gains the generation. The history is seeded with two generations — the current defaults and the byte-exact pre-#257 reconstruction — and matching is purely by hash, never by the stored date.

## Update beside restore

An **Update kernel** control sits directly above "restore defaults" on the agent overview, and does a smart merge rather than a wipe: fields still equal to any recorded generation's default advance to the new default; user-modified fields are kept and reported back by readable names; values from generations the table cannot recognize are conservatively kept (restore stays the full-refresh escape hatch). Builtin tools are compared per tool name, so a customized tool description keeps only that tool behind, user-added entries survive, and a deliberately removed default tool is not resurrected. The merge writes through the comment-preserving yaml path and tolerates hand-edited damage (an invalid section node is replaced rather than crashing).

Outdated agents are flagged with the minimal-chrome convention — the kernel-version row plus an update hint on the overview, and an icon-with-tooltip marker on the agent list cards deep-linking there. Outdated uses an ordering compare, so a config stamped by a newer build never nags after a downgrade. Legacy configs predating the stamp count as outdated by design — see the [compat notes](2026-08-11-backward-compatibility.md).
