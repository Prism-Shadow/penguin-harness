# Computer Use: agents operate desktop apps through a plugin over agent-desktop

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `plugins`, `server`, `docs`, `ci`
- **PR:** [#1650](https://github.com/Prism-Shadow/penguin-harness/pull/1650)

[中文版](2026-11-19-computer-use-plugin.zh.md)

The new `@penguinharness/computer-use` plugin lets an agent see and operate the apps on the server's desktop with `penguin computer`, on macOS, Windows and Linux, through [agent-desktop](https://github.com/vercel-labs/agent-desktop) 1.3.1. It is not preinstalled and not shipped with the build: an administrator installs it from the plugin market, and installing it on an agent gives the agent the `computer-use` skill.

## Details

- The plugin installs agent-desktop itself, not through npm. It downloads the pinned tarball from the npm registry of Plugin Sources, refuses it unless it matches the pinned sha512, and keeps only this machine's program and helper. Each is checked against its pinned sha256 and stored under `<data root>/cache/computer-use/agent-desktop/1.3.1/` as a private file with one link. A machine outside the six targets shows "unsupported here". An administrator can point it at a program installed by other means.
- `penguin computer <command>` is a member plugin command. It passes agent-desktop's commands and options through after a server-side policy check, and prints agent-desktop's JSON envelope. Each command runs as one process, started by absolute path with a named set of environment variables and the calling Session's own state directory, and is stopped after its own time budget.
- Who may use it: by default only administrators, and Agents in a conversation an administrator drives. An "Allow members" switch, off by default, opens it to every member; its help says this hands them control of the machine's desktop session. The caller's Project must also enable the plugin on this server.
- An Agent counts as the person who last started a run in its conversation, through the plugin-command rules of [2026-11-20-plugin-command-caller](2026-11-20-plugin-command-caller.md): `penguin computer` declares `requiresProjectListing` and `tokenCaller: "session-driver"`, so an Agent's call without its conversation is refused (`session_required`).
- The policy allows observation and semantic actions by default. Physical input, clipboard reads and notification reads each wait for an administrator switch. Commands that would act on the focused window must name their app, exactly as `list-apps` prints it; an alias, a part of a name or an unlisted window is refused. A target that belongs to PenguinHarness's own process tree is refused, and a reused parent process id is not followed. `launch` takes an installed app's plain name only: no `--arg`, `--env`, `--cwd` or `--cdp`, and no path or script; on Linux the name must be a system desktop entry's id, name or command. A reply that turns out to come from PenguinHarness's own window is discarded. `sandbox`, `mcp`, `session`, `trace`, notification actions, debug captures, combined short options, and text or `launch` inside `batch` are never run. Each refusal is `error: policy_refused: <why and which setting>`.
- `status` adds the plugin's own state and this machine's preconditions under `data.penguin`. `screenshot` hands the PNG back to the terminal as a file, saved in the current directory or `--out-dir`. `--text-file` sends the text to type from a file, on stdin.
- Settings → Plugins gains a Computer Use card: the switches, the program path, a standing line about the risk of leaving the Web App open on the same desktop, agent-desktop's install progress with Install or Retry, and the preconditions of each system in both languages. On macOS it adds Open System Settings. musl or a glibc older than 2.35 shows "unsupported here".
- `scripts/build-plugins.mjs` gains `MARKET_ONLY`: the packages named there are published and listed in the server's embedded index, but not shipped in the builtin prefix. `computer-use` is the one entry.
- A path-filtered workflow, `computer-use-smoke.yml`, runs the plugin's installer and commands on ubuntu-latest (a GTK window under Xvfb), windows-latest (Notepad) and macos-latest (commands that need no Accessibility grant).
- New docs page: Guides › Computer Use. The skill adapts agent-desktop's bundled guides (Apache-2.0), recorded in `THIRD-PARTY-NOTICES.md`.
