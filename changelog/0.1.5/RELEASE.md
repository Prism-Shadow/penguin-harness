PenguinHarness 0.1.5 — offline installs for every platform, attachments and images in every input, and runs that recover instead of dying.

## Install

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell):

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

Linux, macOS and Windows, with a bundled Node runtime. Or via npm (needs Node >= 24):

```sh
npm install -g @prismshadow/penguin-cli
```

**New: fully offline installs.** This release attaches five self-contained offline bundles — `penguin-linux-{x64,arm64}-offline.tar.gz`, `penguin-darwin-{x64,arm64}-offline.tar.gz`, `penguin-win32-x64-offline.zip` — each carrying the program archive, its SHA256 checksum and the platform's installer. Download on a networked machine, copy to the target, extract, and run `./install.sh` (POSIX) or double-click `install.cmd` (Windows); offline installs verify the checksum unconditionally.

## Highlights

**Offline install everywhere.** Every platform archive now ships wrapped as a self-contained offline bundle, `install.sh` / `install.ps1` accept a verified local archive (`--archive` / `PENGUIN_ARCHIVE`) while keeping their online behavior, POSIX bundles pass their payload explicitly so the online installer never trusts archives found beside a temporary script, and renamed archives still install thanks to an embedded target manifest. The Windows package also bundles MinGit, so `exec_command` has a real bash even on a machine with no Git for Windows — your own installation still wins when present, and GPLv2 obligations are recorded in `THIRD-PARTY-NOTICES.md`.

**Attachments and images reach every input.** The Web composer attaches files of any type — written to the Session scratchpad and handed to the model as `[attached file: <path>]` lines, non-ASCII names preserved. Images now ride mid-run steering (an uncaptioned image is a complete steering message) and goal objectives (as scratchpad paths, re-injected as text every round, so they work on every model). The `@` mention becomes an `/agent` command, and both switch commands stage their pick as a chip until Enter sends.

**LLM failures recover in-run.** The transient-vs-permanent classifier is inverted: every failure except a rejected credential now retries inside the run — visible in both frontends as a live countdown — with compaction retrying under its own shorter budget and recovered failures no longer reported as operator incidents. Pressing Stop mid-request can no longer strand a Session when a provider's stream neither yields nor rejects after the abort.

**A skill library that designs and builds better apps.** web-design gains an opt-in paper editorial theme and a ship-complete contract (a one-line request is the whole spec — dark mode, loading/empty/error states, keyboard path and zero external requests included unasked), plus recipes for collapsible thinking blocks and composer attachments; penguin-sdk documents the thinking and image message kinds, a plain-text output contract, and cross-language BM25 retrieval. The Web draft page adds an end-to-end agent tuning example.

## Notable in this release

- **A shorter default system prompt.** About a tenth smaller (1087 → 969 words), pinned to the user's language, with shared tooling installed once into a per-Agent `shared_env/` directory. Existing Agents keep their own prompt.
- **Web App refinements.** Navigation names unified; the Workspace and Agents panels share one width and lifetime; Project display names editable; the draft examples become a fixed-height folder shelf; the session elapsed chip survives reloads and counts in-flight events.
- **Cost center, honest errors.** The error table pages through the whole history, ordinary non-zero exits are no longer recorded as errors, and environment-sourced entries read `[env]`.
- **CLI paste fix.** CJK and emoji pasted into `penguin chat` no longer corrupt when the terminal splits stdin blocks mid-character.
- **Formatting carries.** Duration and byte abbreviations roll into the next unit instead of printing `1m60s` or `1024KB`.
- **Cleaner harness env.** `PORT` / `HOST` and internal CLI plumbing no longer reach commands the Agent runs, and the development backend moves to port 7368, out of an installed `penguin web`'s way.
- **Docs catch up.** `run_subagent`'s `provider` argument, the gateway credential groups, and the Project model entry's `max_tokens` are documented.
- **A refreshed front door.** README and landing unify on the new tagline pair, the README spells out every install method per-OS with offline bundles in a collapsible, and the landing page switches install methods by OS instead of listing them all.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The installers bundle their own Node runtime; installing from npm needs Node >= 24. All data stays under `~/.penguin/data`.

Full detail: [changelog/0.1.5/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.1.5).
