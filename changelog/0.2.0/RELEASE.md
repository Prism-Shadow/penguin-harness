PenguinHarness 0.2.0 — one sealed installer bundle per platform (now also served from an OSS mirror), tool output that survives truncation, and long conversations you can actually navigate.

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

**One artifact per target.** Each Release now attaches exactly one file per platform — `penguin-{linux,darwin}-{x64,arm64}.tar.gz`, `penguin-universal.tar.gz`, `penguin-win32-x64.zip` — a flat installer bundle sealing the native installer, the program payload and its checksum. The same file serves online and offline installation: download it anywhere, copy it to the target, extract, and run the bundled `install.sh` / `install.cmd`; checksums are verified unconditionally at both layers. **New download source:** the installers now prefer an Alibaba Cloud OSS mirror carrying the exact same bytes and fall back to GitHub automatically (`PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`).

## Highlights

**Long conversations became navigable.** The composer recalls this session's previous inputs with ↑/↓, shell-style — edits end recall, multi-line entries walk the caret first, IME candidates are untouched. The "Reasoning & Tools" header and the currently scrolled thinking/tool row stick to the top of the stream stacked by level, so a long run collapses from anywhere inside it, per section or as a whole. And a zero-width minimap tick rail overlays the stream's left gutter — one tick per exchange, hover for a question-plus-answer preview card, click to jump — moving into a top-right toolbar dropdown whenever the gutter (or a hover pointer) isn't there.

**Truncated tool output is recoverable.** Output that exceeds the per-call cap in an Agent Session is saved to the Session scratchpad, and the recovery path rides the same truncated result the model and both frontends see — no new tool, no protocol change. Every model-visible path core composes now shares one forward-slash spelling on Windows, and the file tools keep accepting both spellings.

**Steering that survives everything, and a session list that scales.** Mid-run steering messages survive reloads with their content visible, retire exactly once delivered, and now carry file attachments just like images. Tool-card subtitles render once fully formed instead of jittering while arguments stream. The sidebar session list is served straight from the database by default — CLI sessions become an opt-in toggle — and both the lists and the groups themselves page, so many agents and workspaces stay scannable.

**A current model catalog.** The qianwenai groups move to the current lineup (qwen3.8-max and deepseek-v4-flash-0731 in), OpenRouter gains deepseek/deepseek-v4-flash-0731 and openai/gpt-5.6-luna, every gateway row's prices are re-read from the models API, and new Projects default to deepseek-v4-flash — existing Projects keep their stored models and default.

## Notable in this release

- **Installs and upgrades hardened.** In-place upgrades survive filesystems that pin in-use directories, the Windows payload drops its policy-blocked `penguin.ps1` launcher (typing `penguin` is unaffected), the installer broadcasts the user-Path change so new terminals find `penguin`, and hermetic installer tests run in CI.
- **File tools diagnose missing paths.** `read_file` / `edit_file` report the deepest existing ancestor, the first missing segment and nearest-named entries instead of a bare "File not found".
- **Update checks report every outcome.** The manual "Check for updates" row shows a busy spinner, success toasts for both up-to-date and update-found, and the existing failure notices.
- **Evaluation Center case details.** Target-agent task materials are separated from project-member-visible scoring rubrics, Score charts use a padded dynamic axis, and the benchmark Skills write YAML-safe Scoreboard summaries.
- **File summaries move to the Task boundary.** One card per completed Task scanning all of its assistant text; negative existence results are no longer cached, so later Tasks can surface newly created paths.
- **Backward compatibility, recorded once.** The installers keep a content-probed legacy path so pre-0.2.0 releases stay installable; installer scripts saved from older releases break loudly against new assets by design — re-fetch them. See [the batch's compatibility notes](https://github.com/Prism-Shadow/penguin-harness/blob/main/changelog/0.2.0/2026-07-31-backward-compatibility.md).

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The installers bundle their own Node runtime; installing from npm needs Node >= 24. All data stays under `~/.penguin/data`.

Full detail: [changelog/0.2.0/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.0).
