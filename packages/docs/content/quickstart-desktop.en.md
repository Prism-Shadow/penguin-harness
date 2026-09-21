---
title: Desktop app
description: Install the PenguinHarness desktop app, configure a model, and run your first Task, with no terminal required.
---

The desktop app is the full Web App as a standalone application. It embeds the server and opens already signed in, so there is no login page, no initial password to copy, and nothing to install from a command line. It also installs the `penguin` command, so the terminal is there when you want it.

## Before you begin

- macOS 11 or later, Windows 10 or later (x64), or Linux (x64).
- An API key for one model provider.

## Download and install

Download the installer for your platform from the [download page](https://penguin.ooo/download), which serves the OSS-accelerated mirror when it is reachable. The same files are attached to every [GitHub Release](https://github.com/Prism-Shadow/penguin-harness/releases).

| Platform | Installers |
| --- | --- |
| macOS 11+ | dmg (Apple Silicon / Intel) |
| Windows 10+ | installer (.exe, x64) |
| Linux (x64) | AppImage / deb |

Install the app and open it. On macOS, drag the app into **Applications** and open it from there.

The macOS builds are Developer ID signed and notarized, and the Windows installers are Authenticode signed, so neither platform needs a first-launch unblock. Linux is the one exception:

> [!INFO]- Double-clicking the Linux AppImage does nothing
>
> Browsers download AppImages without the execute permission. Grant it once, and the app starts normally from then on. The deb package installs through the package manager and is not affected.
>
> ```bash
> chmod +x penguin-desktop-linux-x86_64.AppImage
> ```

The app opens signed in. The window signs itself in, so there is no password to type or to change: in the app's window, **System settings** has no **Account** page with **Change password**.

## Configure a model

PenguinHarness ships with no model credentials. Give it an API key for the model you want to use:

1. In the sidebar, select **Models**. Models are listed in one group per provider, and the default model is marked **Default**.
2. In your provider's group, click **Set key**, enter the API key, and click **Confirm**. The key is written to every model in that group.
3. If you want a model other than the default, open that model and click **Set as default model**.

To add a model that is not listed, click **Add model** in its provider's group and fill in the **Model ID** and **API key**.

A model is always referenced as a `(provider, model_id)` pair: the provider is never inferred from the model id. See [Models & Providers](/models) for the built-in groups.

### Use API keys from your shell profile

API keys already exported in your shell profile (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) work without entering them again. On macOS and Linux, when you launch the app from the Dock or the desktop, it imports the login shell's environment, filling in only the variables the launch itself did not set. The agent shell's `PATH` benefits the same way. Set `PENGUIN_NO_LOGIN_SHELL_ENV` to turn this off.

For an official provider's model with no stored key, the **Models** page shows the detected variable's value masked, just as it shows a stored key: on the model's card, and in the model's dialog, which marks the key as **Read from environment variable**. Gateway groups, and custom or vLLM rows with a base URL of their own, are not matched against these variables — a model there needs its own key.

## Run your first Task

1. In the sidebar, click **New chat**.
2. Pick the agent, the Workspace and the approval mode. You choose the Workspace with the server-side directory browser.
3. Send a first message, for example "Create hello.txt containing Hello, Penguin".

Tool calls appear inline as cards; open one to inspect its arguments and output. With the **Ask every time** (`always-ask`) approval mode, every file write waits for you to click **Allow**. [Tools & Approval](/tools) describes the four approval modes.

## The `penguin` command

The app installs the `penguin` command itself, at every launch, from the CLI bundled inside it. The app and the command always come from the same build, so updating the app updates the command too. No system Node.js is involved: the launcher runs the bundled CLI on the app's own runtime.

| Platform | Where the command goes |
| --- | --- |
| macOS | `/usr/local/bin/penguin`, linked to the app. Creating that directory can need an administrator password. macOS asks only when the plain write is refused, and if you decline, the command is not installed. |
| Windows | The app's `bin` directory is appended to your user `Path`. Open a **new** terminal window afterwards; a terminal that is already running keeps the old `Path`. |
| Linux (deb) | `/usr/bin/penguin`, created by the package's own install script. |
| Linux (AppImage) | `~/.local/bin/penguin`, a wrapper that runs the AppImage. Most distributions put that directory on `PATH` at login. |

The app never replaces an existing `penguin`. If something else already provides the command, such as a [CLI install](/quickstart-cli), a global npm package or a script of your own, the app leaves it exactly as it is and installs nothing. To replace it deliberately, choose **Install 'penguin' Command…** from the application menu. The same menu item installs the command if you declined the macOS administrator prompt.

On macOS, the app does not install the command while it runs from the mounted dmg, because the link would break the moment you eject the disk image. Drag the app into **Applications** and open it from there.

## Share the data root with the CLI

The desktop app uses the same data root as a [CLI install](/quickstart-cli), so you can use the two side by side.

If you later serve that data root over the network with `penguin server`, first give its `admin` a password you can use, because the desktop app deliberately seeds one that nobody can read. Stop the server, then run:

```bash
penguin server reset-admin-password
```

The `admin` account returns to the unclaimed state. When you start the server again, it prints a first-login link where you set the new password.

## Next steps

- [Web App](/web-app): find your way around the interface.
- [Update PenguinHarness](/updates): how the desktop app updates itself.
- [CLI and Web App](/quickstart-cli): a standalone install, for a server or a remote machine. On the same machine you don't need it: the app already provides `penguin`, and installing the CLI puts a second copy on your `PATH`.
- [Architecture](/architecture): how the pieces fit together.
