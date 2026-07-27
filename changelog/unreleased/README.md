# Unreleased

Changes since v0.1.2. The version number is assigned at release, when this folder is renamed.

- [2026-07-26] Windows support: shell resolution for command sessions (Git-Bash → pwsh → powershell, `PENGUIN_SHELL` override) with a new `{{SHELL}}` prompt placeholder and an assembly-time Shell-line fallback for existing agents, whole-tree kill semantics, the `install.ps1` one-liner with kind-preserving user-Path registration, the `penguin-win32-x64.zip` release package, a `ci-windows` job, and a win32 symlink-upload sandbox fix. ([details](2026-07-26-windows-support.md))
