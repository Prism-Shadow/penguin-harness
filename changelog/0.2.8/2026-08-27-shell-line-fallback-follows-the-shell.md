# The Shell line fallback follows the resolved shell instead of the platform

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `core`
- **PR:** [#487](https://github.com/Prism-Shadow/penguin-harness/pull/487)

[中文版](2026-08-27-shell-line-fallback-follows-the-shell.zh.md)

The `- Shell: <name>` line that render-time assembly injects into system prompts built from pre-`{{SHELL}}` templates was gated on the platform being Windows. That gate was replaced with one on the shell that actually resolved, so a pre-`{{SHELL}}` Agent on macOS or Linux is told about a `zsh`, `dash` or `sh` too.

## Details

- The line was injected on Windows alone, because bash was taken as implied everywhere else. `system_config.yaml` is baked at Agent creation and never auto-upgraded, so a template written before the `{{SHELL}}` placeholder shipped carried no shell line at all and left its model writing bash syntax — `[[ ]]`, arrays, `${var,,}`, process substitution. [The POSIX shell fallback chain](../0.2.7/2026-08-27-posix-shell-fallback.md) retired the premise the gate rested on: a machine with no bash resolved `zsh`, `dash` or `sh`, and exactly those pre-`{{SHELL}}` Agents were left unaware of it.
- Where bash resolved — the overwhelmingly common case on every platform, a Windows box with Git for Windows included — the assembled prompt was left byte-identical, because bash is what those templates already imply. That byte-identity guarantee was restated in terms of which shell resolved rather than which platform is running.
- Where bash did not resolve, POSIX took the injection path Windows already took: the line landed directly under the `# Environment` heading, or was appended as a final line when the template had no such section, and a prompt already carrying a `- Shell:` line was left untouched. Nothing was written back to the stored template.
- The design spec was updated to match ([penguin-harness-design #69](https://github.com/Prism-Shadow/penguin-harness-design/pull/69)).
