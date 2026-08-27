---
title: Desktop app
description: A double-click install that opens already signed in — the route that asks the least of a terminal.
---

The full Web experience as a standalone application: it embeds the server and opens already signed in — no login page, no initial password to copy, and nothing to install from a command line. The user menu leaves out **Change password** accordingly: the window signs itself in, so there is no password to type or to change. It also installs the `penguin` command for you, so the terminal is there when you want it. It shares its data root with a [CLI install](/quickstart-cli), so the two can be mixed freely — if you later serve that root over the network with `penguin server`, give its admin a usable password first with `penguin server reset-admin-password` (server stopped), since the desktop app deliberately seeds one nobody can read.

## Download and install

Get the installer for your platform from the [download page](https://penguin.ooo/download) (it serves the OSS-accelerated mirror when reachable); the same files are attached to every [GitHub Release](https://github.com/Prism-Shadow/penguin-harness/releases).

| Platform | Installers |
| --- | --- |
| macOS 11+ | dmg (Apple Silicon / Intel) |
| Windows 10+ | installer (.exe, x64) |
| Linux (x64) | AppImage / deb |

The macOS builds are Developer ID signed and notarized, and the Windows installers are Authenticode signed, so neither platform needs a first-launch unblock. Linux is the one exception:

> [!INFO]- Double-clicking the Linux AppImage does nothing
>
> Browsers download AppImages without the execute permission. Grant it once and the app starts normally from then on (the deb package installs through the package manager and is not affected):
>
> ```bash
> chmod +x penguin-desktop-linux-x86_64.AppImage
> ```

## The `penguin` command

The app installs the `penguin` command itself, at every launch, from the CLI bundled inside it. The two always come from the same build, so updating the app updates the command with it, and no system Node.js is involved — the launcher runs the bundled CLI on the app's own runtime.

| Platform | Where the command goes |
| --- | --- |
| macOS | `/usr/local/bin/penguin`, linked to the app. Creating that directory can need an administrator password; macOS asks only when the plain write is refused, and declining leaves the command uninstalled. |
| Windows | the app's `bin` directory is appended to your user `Path`. Open a **new** terminal window afterwards — an already-running one keeps the old `Path`. |
| Linux (deb) | `/usr/bin/penguin`, created by the package's own install script. |
| Linux (AppImage) | `~/.local/bin/penguin`, a wrapper that runs the AppImage. Most distributions put that directory on `PATH` at login. |

**An existing `penguin` is never replaced.** If something else already provides the command — a [CLI install](/quickstart-cli), a global npm package, a script of your own — the app leaves it exactly as it is and installs nothing. Choose **Install 'penguin' Command…** from the application menu to replace it deliberately; that menu item is also the way back if you declined the macOS administrator prompt.

On macOS the app will not install the command while it is running from the mounted dmg, because the link would break the moment you eject it. Drag the app into **Applications** and open it from there.

## Configure a model

Open the app, go to the **Models** page in the sidebar, click "Add model" and fill in the Provider, model id and API key, then set it as the default.

API keys already exported in your shell profile (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) work without re-entering them: on macOS and Linux the app imports the login shell's environment when launched from the Dock or desktop, filling only variables the launch itself did not set (the agent shell's `PATH` benefits the same way; set `PENGUIN_NO_LOGIN_SHELL_ENV` to opt out). For an official-provider model without a stored key, the Models page shows the detected variable's value masked, exactly as a stored key is shown: on the card, and in the model's dialog, which marks it as read from an environment variable (gateway and custom groups are not matched against these variables).

A model is always referenced as a `(provider, model_id)` pair — the Provider is never inferred from the model id. See [Models & Providers](/models) for the built-in groups.

## Run your first Task

Back on the **Chat** page, start a new session: pick the Agent, the Workspace (chosen with the server-side directory browser) and the approval mode, then send a first message such as "Create hello.txt containing Hello, Penguin".

Tool calls expand inline as cards you can open to inspect arguments and output; with the `always-ask` approval mode, every file write waits for you to click Allow. The four approval modes are described in [Tools & Approval](/tools).

## Next steps

- [Web App Guide](/web-app): every page of the interface, one by one.
- [CLI and Web App](/quickstart-cli): a standalone install, for a server or a remote machine. On the same machine you do not need one — the app already provides `penguin` — and installing it puts a second copy on your `PATH`.
- [Architecture Overview](/architecture): how the pieces fit together.
