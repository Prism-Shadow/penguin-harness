# Project tool model migration

- **Date:** 2026-11-19
- **Type:** process
- **Scope:** `core`, `server`, `cli`
- **PR:** [#1597](https://github.com/Prism-Shadow/penguin-harness/pull/1597)

[中文版](2026-11-19-backward-compatibility.zh.md)

Opening an existing Project moves its vision model to `tools.i2t`, its transcript editing model to `tools.t2t`, and the six capability bindings into the same table. Existing tool selections take precedence. Editing retains its on/off setting. If editing previously used the default chat model, that model becomes the text tool. Once the old keys have been removed, clearing a binding stays cleared.

The release maintainer will review the file migration at the 0.3.0 release and remove it once the supported upgrade paths have crossed this step. The previous web API and the CLI commands `image`, `video`, `tts`, and `stt` continue to use these same bindings.
