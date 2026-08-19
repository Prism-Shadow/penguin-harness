# Backward compatibility in this batch

- **Date:** 2026-07-31
- **Type:** process
- **Scope:** `tooling`, `core`
- **PR:** [#142](https://github.com/Prism-Shadow/penguin-harness/pull/142), [#145](https://github.com/Prism-Shadow/penguin-harness/pull/145)

[中文版](2026-07-31-backward-compatibility.zh.md)

Per the repo rule, every compatibility decision of the batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Installers keep a legacy program-archive path for pre-0.1.6 releases

From this batch on, the canonical Release artifact is a flat installer bundle whose payload sits inside as `payload.tar.gz` / `payload.zip`. Releases up to v0.1.5 shipped the program tree directly (top-level `penguin/`) under the same asset names, and users can still pin those versions or hold such files locally.

**Old shape tolerated:** any archive without a top-level `payload.*` is treated as a program archive. `--version` pins at pre-0.1.6 releases download the old raw asset and install through this path; `--archive` / `-ArchivePath` accepts a legacy raw archive (adjacent `.sha256` still required, renamed files still fall back to the canonical asset checksum plus the manifest rule) as well as the new bundle or its inner payload.

**Scope:** the shape probe and the program-archive branch in `install.sh` and `install.ps1` only. Release packaging, CI and docs describe exclusively the new shape; no on-disk user data is involved (`~/.penguin/data` was never part of install or upgrade).

**User action:** none for the documented flows.

**Removal:** the legacy branch should stay while pre-0.1.6 releases remain plausible `--version` targets. Whoever prepares the release that drops support for installing pre-0.1.6 versions deletes the program-archive branch and the `tar -tzf` / zip-entry probes with it; the sites in both installers reference this file.

## Installer scripts saved from releases up to v0.1.5 cannot install newer assets

This is a deliberate incompatibility, not a handled one: the old installers download the asset under the same name, pass the outer checksum, then fail with their "unexpected archive layout: top-level penguin/ missing" error because the new artifact is a bundle. The documented install commands are unaffected — the penguin.ooo forwarders fetch the installer attached to the latest Release at run time — and the fix for a saved old script is to re-fetch it. Old releases' own assets are untouched: an old installer pinned at an old version keeps working forever.

## The Windows payload drops its penguin.ps1 launcher

This is a deliberate removal with a self-cleaning upgrade path, not a tolerated old shape. Typing `penguin` is unaffected — PowerShell and cmd.exe both resolve `bin\penguin.cmd`, which is exempt from the execution policy that used to block the `.ps1` launcher on default client Windows. Only direct `.\penguin.ps1` invocations need to switch to `penguin` / `penguin.cmd`. Installs made before this change keep their old launcher until the next upgrade: the installer swaps `bin\` wholesale, so re-running it removes the stale `penguin.ps1` along with the rest of the old `bin\` — which is also the fix for machines already showing the "running scripts is disabled" error. Nothing reads or regenerates the file anymore; no removal follow-up is needed.

## The recover-truncated-tool-output batch needs no handling

`EnvironmentConfig.sessionScratchpadDir` is additive and optional: standalone SDK embedders that never pass it keep the exact previous truncation behavior, existing Traces replay unchanged, and no stored format changes shape. Recorded here only to state that the check was made.
