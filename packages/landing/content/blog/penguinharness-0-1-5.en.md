---
title: "PenguinHarness 0.1.5: offline installs, richer input, and runs that recover"
date: 2026-07-30
category: news
excerpt: 0.1.5 widens where PenguinHarness runs and what it can take in. Five self-contained offline bundles install it on machines with no network at all; the composer attaches any file and images now reach steering and goal objectives; nearly every LLM failure recovers inside the run instead of killing the turn; and the built-in skills learned a second visual language plus the thinking and image message kinds. Here is what shipped.
---

PenguinHarness 0.1.5 is out. The release widens both ends of the pipe: where the harness can be installed — including machines that never touch the internet — and what you can hand it once it is running. In between, runs got sturdier: almost every LLM failure now recovers inside the run, and a mid-request Stop can no longer strand a Session. Feature by feature:

## Install with no network at all

Every GitHub Release now attaches **five self-contained offline bundles** — Linux and macOS in x64 and arm64, Windows in x64. Each bundle carries the program archive, its SHA256 checksum and the platform's own installer, so the whole flow is: download on any networked machine, copy to the target, run one command.

```bash
mkdir penguin-offline
tar -xzf penguin-linux-x64-offline.tar.gz -C penguin-offline
./penguin-offline/install.sh
```

On Windows, unzip `penguin-win32-x64-offline.zip` and double-click `install.cmd` — or run `.\install.ps1` in PowerShell. Offline installs verify the SHA256 unconditionally (there is no network to re-download from, so a corrupted archive must be caught, not tolerated), the POSIX bundles pass their payload to the installer explicitly rather than letting a script scan its directory, and a renamed archive still installs because platform packages now carry a target manifest inside.

The Windows package also grew a floor to stand on: it bundles MinGit under `git/`, so `exec_command` has a real bash even on a machine with no Git for Windows installed. Your own Git for Windows still wins when present — its MSYS userland is the fuller one — and the GPLv2 obligations are recorded in the new root `THIRD-PARTY-NOTICES.md`.

The install story around the bundles is redone to match: the README now spells out every method — Linux, macOS, Windows, npm, and the offline packages — each as a complete copy-paste block, and the landing page's install sections switch by OS and method instead of listing everything at once.

## Attach anything, steer with images

The Web composer can now attach **files of any type**, not just images. Attachments are written into the Session scratchpad and handed to the model as `[attached file: <path>]` lines — non-ASCII filenames preserved — so the model reads them with its normal file tools, and the same attachment flow works mid-run.

Images, meanwhile, now reach **every** input. Mid-run steering carries them (an image with no caption is a complete steering message by itself), and a goal objective accepts images as scratchpad paths — re-injected as text every round, they work on every model, vision or not.

The composer's `@` mention grew up into an `/agent` command, and both switch commands (`/agent`, `/model`) now stage their pick as a chip beside the text — cached with the draft, applied only when Enter sends, and session-only.

## Runs that recover instead of dying

The classifier separating transient from permanent LLM failures used to be an allowlist: a gateway that worded a transient fault its own way killed the turn. 0.1.5 inverts it — **every failure except a rejected credential now retries inside the run**, with the retry visible in both frontends as a live countdown, compaction retrying under its own shorter budget, and a recovered failure no longer reported to the operator as an incident.

Two companions to that: pressing Stop mid-request can no longer leave a Session running forever when a provider's stream neither yields nor rejects after the abort; and the Cost center's error table now pages back through the whole history, stops recording an ordinary non-zero exit (`grep` finding nothing) as an error, and labels environment-sourced entries `[env]`.

## Skills that design — and build — better apps

The built-in skill library took two big steps this release:

- **web-design** now carries a second complete visual language — an opt-in *paper editorial* theme with warm paper tones, system-serif display headings and mono micro-labels — next to the default GitHub-style simplicity, plus a "ship complete" contract: a one-line request is the whole spec, and every delivered page includes dark mode, loading/empty/error states, a working keyboard path and zero external requests, unasked. Chat interfaces gained recipes for a collapsible reasoning block and composer image attachments.
- **penguin-sdk** documents the message kinds modern models actually emit and accept: stream `partial_thinking` into its own collapsed channel, build image input with `imageUrlMessage` (with the config `vision` flag degrading gracefully through the project's `vision_model`), fix the output format in the persona instead of shipping a Markdown renderer, and bridge cross-language BM25 retrieval with an ingest-time bilingual keyword map.

On top of both, the Web App's draft page gained an end-to-end **agent tuning example** — create, benchmark and optimize an Agent through isolated CLI sessions — and its example prompts got shorter, because the skills now carry the knowledge the prompts used to spell out.

## Also in 0.1.5

- The default system prompt is about a tenth shorter (1087 → 969 words), pins replies to the user's language, and directs shared tooling into a per-Agent `shared_env/` directory. Existing Agents keep their own prompt.
- Navigation entries settle on one name each; the Workspace and Agents panels share one width and one open/closed lifetime; Project display names are editable; the draft page's examples became a fixed-height folder shelf.
- The chat header's elapsed chip survives reloads and counts in-flight events — anchored to the server's clock, so live and replayed views agree.
- Pasting CJK or emoji into `penguin chat` no longer corrupts characters torn across stdin chunks.
- Duration and byte formatting carry into the next unit instead of printing `1m60s` or `1024KB`.
- `PORT` / `HOST` no longer leak into commands the Agent runs, and the development backend moved to port 7368, out of the installed `penguin web`'s way.
- Docs catch up in three reference blocks: `run_subagent`'s `provider` argument, the gateway credential table, and the Project model entry's `max_tokens`.

## Install or upgrade

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell):

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

Or `npm install -g @prismshadow/penguin-cli` with Node >= 24 — and from this release, fully offline from the [Release assets](https://github.com/Prism-Shadow/penguin-harness/releases). Full detail per change: [changelog/0.1.5](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.1.5).
