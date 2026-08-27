# The Shell line fallback follows the resolved shell instead of the platform

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `core`

[中文版](2026-08-27-shell-line-fallback-follows-the-shell.zh.md)

The `- Shell: <name>` line that render-time assembly injects into system prompts built from pre-`{{SHELL}}` templates was gated on the platform being Windows. That gate was replaced with one on the shell that actually resolved, so an Agent created before the placeholder existed is told about a `zsh`, `dash` or `sh` on macOS and Linux too.

## Details

- The fallback exists because `system_config.yaml` is baked at Agent creation and never auto-upgraded: a template written before the `{{SHELL}}` placeholder shipped carries no shell line at all, and its model keeps writing bash syntax — `[[ ]]`, arrays, `${var,,}`, process substitution. The Windows-only gate rested on bash being implied on POSIX, a premise that [the POSIX shell fallback chain](../0.2.7/2026-08-27-posix-shell-fallback.md) retired: a machine with no bash resolved `zsh`, `dash` or `sh`, and exactly those pre-`{{SHELL}}` Agents were left unaware of it.
- Where bash resolved — the overwhelmingly common case on every platform, a Windows box with Git for Windows included — the assembled prompt was left byte-identical, because bash is what those templates already imply. The byte-identity guarantee is stated in terms of which shell resolved rather than which platform is running.
- Where bash did not resolve, POSIX took the injection path Windows already took: the line lands directly under the `# Environment` heading, or is appended as a final line when the template has no such section, and a prompt already carrying a `- Shell:` line is left untouched. Nothing is written back to the stored template.
