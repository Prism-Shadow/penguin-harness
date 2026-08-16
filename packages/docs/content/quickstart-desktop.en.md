---
title: Desktop app
description: A double-click install that opens already signed in — the route with no terminal at all.
---

The full Web experience as a standalone application: it embeds the server and opens already signed in — no terminal, no login page, no initial password to copy. It shares its data root with a [CLI install](/quickstart-cli), so the two can be mixed freely.

## Download and install

Get the installer for your platform from the [download page](https://penguin.ooo/download) (it serves the OSS-accelerated mirror when reachable); the same files are attached to every [GitHub Release](https://github.com/Prism-Shadow/penguin-harness/releases).

| Platform | Installers |
| --- | --- |
| macOS 11+ | dmg (Apple Silicon / Intel) |
| Windows 10+ | installer (.exe, x64) |
| Linux (x64) | AppImage / deb |

> [!INFO]- The system blocked the first launch? One fix per platform, once
>
> Current builds are unsigned, so the system may block the very first launch. Only your own platform needs anything:
>
> **macOS says "PenguinHarness" is damaged and can't be opened** — macOS quarantines files downloaded from the internet, and the missing signature makes that flag surface as a false "damaged" alert. Drag `PenguinHarness.app` from the dmg into the **Applications** folder, open Terminal (Launchpad → Other → Terminal), paste the command below and press Enter, then type your login password (nothing shows while you type; press Enter when done). Once it finishes, double-click the app — it now opens normally:
>
> ```bash
> sudo xattr -rd com.apple.quarantine /Applications/PenguinHarness.app
> ```
>
> **Windows SmartScreen says "Windows protected your PC"** — the installer is not signed yet, so SmartScreen holds the first run: click **More info**, then **Run anyway** to continue installing — first run only.
>
> **Double-clicking the Linux AppImage does nothing** — browsers download AppImages without the execute permission. Grant it once and the app starts normally from then on (the deb package installs through the package manager and is not affected):
>
> ```bash
> chmod +x penguin-desktop-linux-x86_64.AppImage
> ```

## Configure a model

Open the app, go to the **Models** page in the sidebar, click "Add model" and fill in the Provider, model id and API key, then set it as the default.

A model is always referenced as a `(provider, model_id)` pair — the Provider is never inferred from the model id. See [Models & Providers](/models) for the built-in groups.

## Run your first Task

Back on the **Chat** page, start a new session: pick the Agent, the Workspace (chosen with the server-side directory browser) and the approval mode, then send a first message such as "Create hello.txt containing Hello, Penguin".

Tool calls expand inline as cards you can open to inspect arguments and output; with the `always-ask` approval mode, every file write waits for you to click Allow. The four approval modes are described in [Tools & Approval](/tools).

## Next steps

- [Web App Guide](/web-app): every page of the interface, one by one.
- [CLI and Web App](/quickstart-cli): if you also want the `penguin` command on the same machine.
- [Architecture Overview](/architecture): how the pieces fit together.
