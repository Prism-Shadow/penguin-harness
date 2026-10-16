# The Plugins page reads the machine it views: installed plugins show the version on disk, other platforms' sandbox backends are marked and not installable

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`

[中文版](2026-10-09-plugins-page-platform-and-version.zh.md)

The Plugins page showed a registry entry's version for a plugin that was installed — so a copy installed at 0.2.2 read as the 0.2.3 the index lists — and a sandbox backend for another platform (the macOS or the Windows one, on Linux) was offered as a plain install: the button worked, and only a keyword hinted at the mismatch.

## Changes

- `GET /api/projects/:projectId/plugins/installed` reports, for every installed plugin, the `version` of the copy this server resolves — read from its own `package.json`, which is what is on disk and can lag the registry's listing — and the response carries this server's `platform` (`process.platform`).
- An index entry may name `os`, the platforms the plugin runs on (`process.platform` words; absent means every platform). The builtin index reads it from the package's own `penguinOs` field — npm's own `os` would make npm refuse the package on every other platform, and the builtin prefix installs every backend on every platform it is built on — and the sandbox backends declare theirs: bubblewrap Linux, Seatbelt macOS, WSL Windows; the DSH one runs everywhere and says nothing.
- The Plugins page shows an installed row's version from the machine in view's own answer — the machine it views is the one whose copy it states — and an available entry for another platform is kept but marked `for macOS only` / `for Windows only`, its Install disabled with the reason in its tooltip, and sorted after the rest.
- An installed row's description is honest about the registry's answer: before it arrives the line is left blank rather than claiming "no entry", and a failed request says the source is unavailable instead.
