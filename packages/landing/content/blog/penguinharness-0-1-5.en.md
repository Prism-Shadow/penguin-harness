---
title: "PenguinHarness 0.1.5: offline installs, file attachments, and runs that recover"
date: 2026-07-30
category: news
excerpt: 0.1.5 adds five self-contained offline install bundles, lets the composer attach any file and send images with steering and goals, and retries nearly every LLM failure inside the run. The web-design Skill gains a second visual theme, and penguin-sdk documents thinking and image messages.
---

PenguinHarness 0.1.5 is out. You can now install it on machines with no network at all, attach any type of file in the Web composer, and send images with steering messages and goal objectives. Runs are sturdier too: almost every LLM failure now recovers inside the run, and pressing Stop mid-request can no longer leave a Session stuck.

## Install without a network

The 0.1.5 GitHub Release attaches five self-contained offline bundles: Linux and macOS, each for x64 and arm64, and Windows for x64. Each bundle carries the program archive, its SHA256 checksum and the platform's own installer. Download a bundle on any machine with network access, copy it to the target machine, and run one command.

On Linux or macOS, extract the bundle and run its installer. For the Linux x64 bundle:

```bash
mkdir penguin-offline
tar -xzf penguin-linux-x64-offline.tar.gz -C penguin-offline
./penguin-offline/install.sh
```

On Windows, unzip `penguin-win32-x64-offline.zip` and double-click `install.cmd`, or run `.\install.ps1` in PowerShell.

Offline installs always verify the SHA256 checksum. With no network to download the archive again, a corrupted archive has to stop the install. A renamed archive still installs, because each package now records its target platform inside.

The Windows package also bundles MinGit under `git/`, so `exec_command` has a real bash even on a machine without Git for Windows. If you have Git for Windows installed, it still takes precedence, because its MSYS userland is more complete. MinGit's GPLv2 obligations are recorded in a new `THIRD-PARTY-NOTICES.md` at the repository root.

The install instructions were rewritten to match. The README now gives every method as a complete block you can copy and paste: Linux, macOS, Windows, npm and the offline bundles. The landing page's install section switches by operating system and method instead of listing everything at once.

## Attach any file, steer with images

The Web composer now attaches files of any type, not just images. Attachments are written to the Session scratchpad and passed to the model as `[attached file: <path>]` lines, with non-ASCII file names preserved, so the model reads them with its usual file tools.

Images now reach every kind of input. A steering message sent mid-run can carry images, and an image with no caption is a complete steering message on its own. Steering does not carry files; an attached file waits for your next regular message. A goal objective accepts images as scratchpad paths. The paths are re-injected as text every round, so they work with every model, with or without vision.

The composer's `@` mention is now an `/agent` command. Both switch commands, `/agent` and `/model`, are available inside an existing Session, not on a new-chat draft, and each places your pick as a chip above the text. The chip is saved with the draft and takes effect only when you press Enter to send: an agent chip hands the conversation off to a new chat with that agent, and a model chip forks the conversation onto the chosen model.

## Runs that recover instead of failing

The classifier that separates transient LLM failures from permanent ones used to work from a list of known errors, so a gateway that described a transient fault in its own words ended the turn. 0.1.5 turns this around: every failure except a rejected credential now retries inside the run. The Web App shows the retry as a live countdown, and the CLI prints a `[retry]` line. Compaction retries under its own shorter budget, and a failure that recovers is no longer reported to the operator as an incident.

Two related fixes:

- Pressing **Stop** mid-request no longer leaves a Session running forever when a provider's stream neither returns data nor fails after the abort.
- In the **Cost Center**, the error table pages back through the whole history, no longer records an ordinary non-zero exit (such as `grep` finding nothing) as an error, and marks entries that come from the environment with `[env]`.

## Skills that design and build better apps

Two built-in Skills took large steps in this release.

### web-design

`web-design` now carries a second complete visual language next to its default GitHub-style simplicity: an opt-in *paper editorial* theme with warm paper tones, system serif display headings and small monospace labels.

It also follows a "ship complete" contract. A one-line request is the whole spec, and every page it delivers includes dark mode, loading/empty/error states, a working keyboard path and zero external requests, without being asked. For chat interfaces, it adds recipes for a collapsible reasoning block and image attachments in the composer.

### penguin-sdk

`penguin-sdk` now documents the thinking and image message kinds that current models emit and accept, along with patterns for building on them:

- Stream `partial_thinking` into its own collapsed channel.
- Build image input with `imageUrlMessage`. When the model config's `vision` flag is off, the image is passed as a file path that the built-in image tools read through the Project's `vision_model`, so the app still works.
- Fix the output format in the persona instead of shipping a Markdown renderer.
- Bridge cross-language BM25 retrieval with a bilingual keyword map built at ingest time.

Because these two Skills now carry the knowledge the draft page's example prompts used to spell out, those prompts are shorter. The draft page also adds an end-to-end example of tuning an agent, built on the agent creation, Benchmark design, evaluation and optimization Skills: it creates, benchmarks and optimizes an agent through isolated CLI sessions.

## Also in 0.1.5

- The default system prompt is about a tenth shorter (1087 → 969 words). It tells the model to reply in the user's language and to install shared tooling into a per-agent `shared_env/` directory. Existing agents keep their own prompt.
- Each navigation entry now has a single name. The Workspace and Agents panels share one width and the same open/closed behavior, Project display names are editable, and the draft page's examples become a fixed-height folder shelf.
- The elapsed-time chip in the chat header survives reloads and counts in-flight events. It follows the server's clock, so live and replayed views agree.
- Pasting CJK text or emoji into `penguin chat` no longer corrupts characters that arrive split across stdin chunks.
- Durations and byte sizes roll over into the next unit instead of printing `1m60s` or `1024KB`.
- `PORT` and `HOST` no longer leak into the commands an agent runs, and the development backend moved to port 7368, out of the way of an installed `penguin web`.
- Three reference blocks in the docs caught up with the code: `run_subagent`'s `provider` argument, the gateway credential table and the Project model entry's `max_tokens`.

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

You can also install from npm with Node >= 24: `npm install -g @prismshadow/penguin-cli`. From this release, you can also install fully offline with the bundles attached to the [v0.1.5 Release](https://github.com/Prism-Shadow/penguin-harness/releases/tag/v0.1.5); the steps are under "Install without a network" above. Every change is described in detail in [changelog/0.1.5](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.1.5).
