# Computer Use

Your Agents see and operate the apps on your computer's desktop with `penguin computer`, through [agent-desktop](https://github.com/vercel-labs/agent-desktop): they read a window as its accessibility tree, click, type, select and wait through each element's accessibility API, take window screenshots, and launch or quit apps — on macOS, Windows and Linux. A Skill, `computer-use`, teaches them the observe → act → verify loop.

## Install

1. PenguinHarness ships **Computer Use**. An administrator selects **Enable server module** in the plugin market to load it for the current Project. The plugin then downloads agent-desktop 1.3.1 from the npm registry of **Plugin Sources** (then its npm registry mirror, when chosen; an address is given up only after 30 s without data), checks it against the digests pinned in this package, and keeps only this machine's program, under `<data root>/cache/computer-use/`.
2. Install the plugin on an Agent (its Plugins tab). The Agent gets the `computer-use` Skill.
3. Check **Settings → Plugins → Computer Use**: it shows agent-desktop's state and what this machine still needs.

| System | Needs |
| --- | --- |
| macOS 13+ | The Accessibility permission for PenguinHarness (or the terminal that started the server); Screen Recording for screenshots. The card's **Open System Settings** shows where. |
| Windows 10 1809+ | The server running on the signed-in user's desktop (not as a service, over SSH or in Session 0); the Visual C++ runtime. |
| Linux (glibc 2.35+) | A desktop session: its display, session bus and accessibility bus, and a window manager. On Wayland there is no pointer input. |

A machine that cannot reach the npm registry can point **agent-desktop program path** (an advanced setting) at a program installed by other means. The server uses the bundled plugin without npm. A machine with Computer Use switched off keeps it off until an administrator enables it in Settings. The package has no dependencies and no install scripts.

## Who may use it

By default only administrators, and Agents in a conversation an administrator drives; **Allow members** on the card opens it to every member of a Project that has the plugin enabled, which hands them control of this machine's desktop session. A Project must have the plugin enabled on the server (installing it on one of the Project's Agents does that). An Agent counts as the signed-in person whose message its conversation is working on right now (the command declares `tokenCaller: "session-driver"`, a platform rule of plugin commands); its call must name the conversation. That holds for people without exception; for Agents it is best effort — an Agent can name another conversation of a Project it reaches and borrow the person whose run is in progress there — until each conversation has a credential of its own.

**Do not leave the Web App open on this desktop while an Agent uses Computer Use**: an Agent can operate any window on this desktop, including a browser tab showing the PenguinHarness Web App, where it could approve its own requests or change settings. Only the desktop app's own windows are protected.

## What an Agent can do

By default: read windows (`snapshot`, `find`, `get`, `is`, `wait`, `screenshot`), act on elements semantically (`click`, `type`, `set-value`, `select`, `toggle`, `check`, `expand`, `scroll-to` …), manage windows, launch and quit apps, write the clipboard, and press keys in a named app. The Skill has the Agent ask you before it launches, quits, moves windows or writes the clipboard, and before anything that pays, sends or deletes.

Off until an administrator allows it on the card: physical input (the real mouse and keyboard), reading the clipboard, reading notifications. Never: operating PenguinHarness's own windows, agent-desktop's sandboxes, MCP server, cursor overlay, sessions and traces, notification actions, debug captures, and `launch` with `--cdp`, `--arg`, `--env` or `--cwd`, or with a path or a script: `launch` takes an installed app's plain name (on Linux a system desktop entry's id, name or command, never a terminal emulator, launched with a PATH of system directories only; on Windows a program in System32; on macOS an app's name or bundle ID). Apps are named exactly as `list-apps` prints them, and a reply that came from PenguinHarness's own window is discarded.

It shares the desktop with the person at the computer: when "Pause while the user is active" is enabled (off by default), commands that change the desktop are refused if their last keyboard or mouse input was under 3 seconds ago (`user_active`; nothing pauses where the idle time cannot be read, such as Wayland), and a `press` goes only to a window that is already focused (`window_not_focused`, naming the `focus-window` to run). `penguin computer status` reports the focused window, the displays and the user's idle seconds.

Removing the plugin leaves its data in the server's data root: `cache/computer-use/` (agent-desktop, about 16 MB) and `computer-use/state/` (each conversation's snapshots, removed after 14 days unused). Delete them by hand if you want them gone.

agent-desktop runs as the server's own user, outside the Agent sandbox: turning Computer Use on lets an Agent do what the desktop lets it do. Each `penguin computer` command is still a shell command of the Agent's, under its approval rules.

## Commands

```bash
penguin computer status
penguin computer snapshot --app "Calculator" -i --compact
penguin computer click @s8f3k2p9:e12
penguin computer type @s8f3k2p9:e3 "hello"          # or --text-file <file> for a secret
penguin computer wait --element @s8f3k2p9:e9 --predicate actionable
penguin computer screenshot --app "Calculator" calc.png --out-dir shots
```

The commands and options are agent-desktop's (`penguin computer <command> --help`); each prints agent-desktop's JSON envelope.

## Licence

Apache-2.0. The Skill adapts agent-desktop's bundled guides (Apache-2.0); see `THIRD-PARTY-NOTICES.md`. agent-desktop itself is downloaded at run time, not shipped in this package.
