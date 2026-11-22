---
title: Computer Use
description: Let your agents see and operate the apps on your computer's desktop with penguin computer — a plugin over agent-desktop, on macOS, Windows and Linux.
---

The **Computer Use** plugin lets an agent work in the desktop apps of the computer PenguinHarness runs on. The agent runs `penguin computer` in its shell: it reads an app's window as its accessibility tree, clicks, types, selects and waits through each element's accessibility API, takes window screenshots, and launches or quits apps. Underneath is [agent-desktop](https://github.com/vercel-labs/agent-desktop), which uses each system's accessibility interface — Accessibility on macOS, UI Automation on Windows, AT-SPI on Linux. The plugin's `computer-use` skill teaches the agent to observe, act and then check what happened.

For websites, use the [Built-in Browser](/builtin-browser) instead.

## Before you begin

- Computer Use acts on the desktop of the machine the server runs on, as the server's own user. With the desktop app that is your computer; with a server on another machine, it is that machine's desktop.
- It runs outside the agent sandbox: once it is on, an agent can do what that desktop lets it do. Each `penguin computer` command is still a shell command of the agent's, under its approval mode.
- Installing the plugin and its settings are for administrators.
- **Who may use it.** By default only administrators, and agents in a conversation an administrator drives, may run `penguin computer`; the Project must also have the plugin enabled on this server. On a single-user desktop you are the administrator, so your agents can use it. An administrator can turn on **Allow members** on the card — that hands every member of a Project with the plugin control of this machine's desktop session, which is as much as letting them run programs on it. Everyone else's commands are refused: `admin_only` when members are not allowed, `plugin_not_enabled` when the Project has not enabled the plugin.
- **How an agent counts.** An agent's shell holds the server's local API token, which stands for the administrator. For `penguin computer` the server instead counts the agent as the signed-in person whose message its conversation is working on right now, and checks that person's access to the Project. A scheduled run counts as the person who saved the schedule with their own sign-in, until an agent or anyone else changes its file. An agent's call that names no conversation is refused with `session_required`. With no such run in progress it is refused with `driver_unknown`: idle, a schedule nobody signed for, the Agent API, company mode, a goal, or a run someone else wrote into. This holds without exception for people signing in; for agents it is best effort. An agent can name another conversation of a Project it reaches and borrow the person whose run is in progress there, and real confinement waits for each conversation to get a credential of its own.

> **Do not leave the Web App open on this desktop while an agent uses Computer Use.** An agent with Computer Use can operate any window on this desktop, including a browser tab showing the PenguinHarness Web App, where it could approve its own requests or change settings. Only the desktop app's own windows are protected.

## Install it

1. Open **Settings → Plugins**, find **Computer Use** in the plugin market, and install it on the server.
2. The plugin downloads agent-desktop 1.3.1 (about 16 MB) from the npm registry chosen under **Plugin Sources**, checks it against the digests pinned in the plugin, and keeps only this machine's program in the data root, under `cache/computer-use/`. The **Computer Use** card under Settings → Plugins shows its progress.
3. Install the plugin on an agent from the agent's **Plugins** tab. The agent gets the `computer-use` skill, and the Project gets the plugin enabled on this server.

Computer Use has a version of its own, separate from PenguinHarness's: it started at 0.1.0 and moves only when the plugin itself changes.

Installing a plugin from the market (or from a zip) runs npm on the server machine, and the desktop app does not bring npm of its own yet: on a machine without npm the install says so. The download of agent-desktop itself needs no npm. It tries the registry chosen under **Plugin Sources** first, then the **npm registry mirror** when it is chosen under Plugin mirrors; mirrors configured only in an `.npmrc` file are not read. A slow link is fine: an address is given up only after 30 seconds without data, and the whole download after 30 minutes. Removing the plugin stops a download in progress.

If the download fails, the card says so with the error under its details: choose another registry or add the npm registry mirror under **Plugin Sources**, then select **Retry**. A machine that cannot reach any npm registry can use an agent-desktop program installed by other means: give its absolute path in **agent-desktop program path**, under the card's advanced settings.

## Grant what your system needs

The Computer Use card lists what this machine still needs; select **Check again** after you change something.

| System | What it needs |
| --- | --- |
| macOS 13 or later | The **Accessibility** permission for PenguinHarness — or, for a server you started from a terminal, for that terminal. **Screen Recording** too, for screenshots. **Open System Settings** on the card opens the right place and names the app to allow. |
| Windows 10 1809 or later | The server running on your signed-in desktop: not as a service, over SSH or in Session 0, and not behind the lock screen. Apps running as administrator can be read but not operated. The Visual C++ runtime must be installed. |
| Linux, glibc 2.35 or later | A desktop session: its display, session bus and accessibility bus, and a window manager. On Wayland there is no pointer input, the first screenshot asks for your consent, and wlroots compositors are not supported. |

## What an agent can do

By default an agent can:

- read windows: `snapshot`, `find`, `get`, `is`, `wait`, `screenshot`;
- act on elements through their accessibility API: `click`, `type`, `set-value`, `select`, `toggle`, `check`, `expand`, `scroll-to` and the rest;
- move, resize, minimize and focus windows, launch and quit apps, and write the clipboard;
- press keys, in an app it names.

The skill tells the agent to ask you before it launches or quits an app, moves windows or writes the clipboard, and before anything that pays, sends, deletes or changes a setting.

Every command that reads or acts on a window must name its app, so an agent never acts on whatever window happens to have focus. Computer Use never operates PenguinHarness itself — the desktop app's windows, the server, or anything they started.

### Sharing the desktop with you

An agent works on the same screen you do, so the plugin keeps it out of your way:

- **It pauses while you are using the computer.** While your last keyboard or mouse input was less than 3 seconds ago, commands that change the desktop are refused (`user_active`) and the agent is told to ask you first; reading the screen still works. Turn this off with **Pause while the user is active** on the card. It needs to read how long you have been idle: on macOS and Windows it always can; on Linux it can under X11 (with `xprintidle`, or Python and libXss, both present on most desktops), not on Wayland — there the card says the pause cannot work and nothing pauses.
- **Keystrokes go to the window you can see is active.** A key `press` goes to whichever window has focus, so it is refused while the window the agent names is not the focused one (`window_not_focused`); the agent is told which window to bring forward with `focus-window`, after asking you. It never takes focus silently.
- `penguin computer status` shows the agent the focused window, your displays and their positions, and how long you have been idle, so it can tell when you are working.

### What stays off unless you allow it

| Setting | Allows |
| --- | --- |
| **Allow physical input** | The real mouse and keyboard: clicks at coordinates, hovering, dragging, double-clicks, focus changes and the scroll wheel. They move your pointer and take keyboard focus away from whatever you are doing. Without it, an agent acts through each element's accessibility API, which leaves the pointer alone but cannot drive every app — some Electron and canvas apps only react to real input. |
| **Allow reading the clipboard** | `clipboard-get`: whatever was last copied, which may be a password. |
| **Allow reading notifications** | `list-notifications`: notifications from every app. |

All three are off by default, and so is **Allow members** (see [Before you begin](#before-you-begin)). Never offered at all: agent-desktop's sandboxes, MCP server, cursor overlay, sessions and traces, acting on notifications, debug captures, and launching an app with arguments, an environment or a working directory.

`launch` takes an installed app's plain name, never a path, a script or a bundle given by name, so it cannot run a program an agent wrote to disk or open a debugging port:

| System | What `launch` accepts |
| --- | --- |
| Linux | The id, name or command of a desktop entry in a system applications directory (`/usr/share/applications` and the others of `XDG_DATA_DIRS` that the server's user can neither write nor owns), such as `gnome-calculator`, `Calculator` or `org.gnome.Calculator`. A command counts only when one entry alone runs it, and never a shell or interpreter such as `sh`. The entry's program must be in a system directory too: the launch runs with a `PATH` of only the system directories of the server's `PATH`. Entries in your own folders, hidden ones, those that run in a terminal and terminal emulators are not offered. |
| Windows | A program in System32 or the Windows directory, such as `notepad` or `notepad.exe`. |
| macOS | An app's name or bundle ID, such as `Calculator` or `com.apple.calculator`. macOS resolves the name itself, which can include an app in a folder you can write, such as `~/Applications`. |

Typing into a terminal app that is already open remains possible; do not leave one open for an agent you do not trust with it.

An agent names each app exactly as `penguin computer list-apps` prints it; a bundle ID, a part of a name or a window that `list-windows` does not show is refused, so the plugin always knows which process a command reaches. After a command runs, the window agent-desktop reports it read or acted on is checked once more, and a reply from PenguinHarness's own window is discarded.

To stop all of it, turn off the **Computer Use** switch on the card: every command is then refused.

## Where its data is

Removing the plugin does not delete what it kept in the server's data root (`~/.penguin/data` by default):

- `cache/computer-use/` — the downloaded agent-desktop (about 16 MB);
- `computer-use/state/` — each conversation's snapshots, which hold text read from the screen; a conversation's folder is removed after 14 days unused.

Delete both folders by hand after removing the plugin if you want them gone.

## Drive it from the command line

`penguin computer` takes agent-desktop's commands and options, and prints agent-desktop's JSON envelope:

```bash
penguin computer status
penguin computer snapshot --app "Calculator" -i --compact
penguin computer click @s8f3k2p9:e12
penguin computer type @s8f3k2p9:e3 "hello"
penguin computer wait --element @s8f3k2p9:e9 --predicate actionable
penguin computer screenshot --app "Calculator" calc.png --out-dir shots
```

- `status` adds the plugin's own state under `data.penguin`: whether it is on, agent-desktop's install (`install`), the settings, this machine's `checks`, and the `desktop` now — the focused window, the displays with their bounds, and the user's input idle seconds (`null` where they cannot be read). It exits with code 1 when Computer Use cannot run.
- A screenshot is saved where you run the command (or in `--out-dir`), never over an existing file.
- `--text-file <file>` gives the text of `type`, `set-value` or `clipboard-set` from a file, so a secret never appears on a command line.
- `penguin computer <command> --help` prints agent-desktop's help for one command.
- What the plugin refuses is one line, `error: <code>: <why>`, with exit code 1: `policy_refused`, `user_active` (you are using the computer) or `window_not_focused` (the named window is not the focused one), among others.

Refs (`@s8f3k2p9:e12`) belong to the snapshot that produced them and to the conversation that took it: take a new snapshot after the window changes.
