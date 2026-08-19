# Fix: ANSI color codes no longer leak into tool output

- **Date:** 2026-08-04
- **Type:** fix
- **Scope:** `cli`, `core`, `web`
- **PR:** [#187](https://github.com/Prism-Shadow/penguin-harness/pull/187)
- **Issue:** [#102](https://github.com/Prism-Shadow/penguin-harness/issues/102)

[中文版](2026-08-04-ansi-tool-output.zh.md)

A nested `penguin run` driven through `exec_command` and polled with `input_command` filled Web tool cards with `[36m`/`[0m` fragments spliced into words ([#102](https://github.com/Prism-Shadow/penguin-harness/issues/102)). Three layers each contributed, and each is fixed:

- **CLI**: the renderer wrote escape codes unconditionally. Color is now decided once per output stream — TTY, `NO_COLOR` unset, `TERM` not `dumb`, with a non-empty `FORCE_COLOR` overriding in either direction, matching Node's own semantics — and every renderer escape routes through that palette, so piped output is plain text.
- **Command tool environment**: the child environment always set `NO_COLOR=1` and `TERM=dumb`, but an inherited `FORCE_COLOR` silently won (Node ignores `NO_COLOR` when `FORCE_COLOR` is set). `FORCE_COLOR` and `CLICOLOR_FORCE` are now stripped — removed, not blanked, since Node reads an empty `FORCE_COLOR` as "on" — so the hardening finally holds; a vault-provided value still passes through by design.
- **Web**: tool output renders through a defensive ANSI stripper (CSI including multi-parameter SGR, OSC, two-byte escapes, and an incomplete trailing sequence cut mid-stream), applied at render time only — historical Traces display clean without their files being rewritten. The Trace event inspector deliberately keeps raw payloads: it is the raw-data view.

Regression tests cover all three layers, including the reported `FORCE_COLOR=3` + `NO_COLOR=1` + `TERM=dumb` combination and sequences split across streaming chunk boundaries.
