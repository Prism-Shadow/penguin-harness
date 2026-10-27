PenguinHarness 0.2.18 is a fix release on top of 0.2.17. Settings and unsent drafts now follow your account instead of the browser, workbench pages can follow their agent live, and local pages no longer wait for remote machines or the internet. It also fixes the TokenDance authorization redirect, deletion of a large agent, and request counts in the Cost Center.

## Install

**Desktop app**: get your platform's installer from [penguin.ooo/download](https://penguin.ooo/download) — the page measures both sources on every visit and keeps GitHub unless the OSS mirror is measurably faster. A manual selector sits beside the result. The macOS builds are Developer ID signed and notarized, and the Windows installers are Authenticode-signed. Neither platform needs a first-launch unblock.

**Windows desktop app of 0.2.16 or earlier: install this release by hand once**, as for 0.2.17. The updater of 0.2.16 and earlier refuses installers signed with the new certificate. Download the installer from [penguin.ooo/download](https://penguin.ooo/download) and run it.

CLI / server (Linux, macOS; bundled Node runtime):

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell):

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

Or via npm (needs Node >= 24):

```sh
npm install -g @prismshadow/penguin-cli
```

Or the official Docker image (`linux/amd64` and `linux/arm64`):

```sh
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:0.2.18
```

`0.2.18` is built from this release's tag. `latest` follows changes to the image's runtime or build inputs on `main`. The example publishes the port on the host's loopback, so a fresh deployment answers only on the machine running Docker.

## Highlights

### Settings and drafts follow the account

The preferences on the Settings pages and the Web App's unsent drafts are now stored on the account, on the server. Another browser or the desktop app signed in to the same account shows the same theme, language, background image and drafts. Each browser keeps a cache for its first frame, and the server's copy wins.

On a browser's first sign-in after the upgrade, its existing preferences and drafts are handed to the account once, if the account has none yet. Panel widths, the dock layout, folds, pins and other layout state stay in the browser.

### Workbenches follow their agent live

A workbench can follow the Sessions it starts while the agent works, reading the same AMSP records as the chat. A page imports `../sdk/workbench.js`, served beside every workbench, for `followSession()` and `abortSession()`. A handler calls `WorkbenchHost.subscribe(sessionId, listener)`. Workbench pages also take the app's whole theme through `/workbench-ui.css`.

The built-in PenguinHarness Support workbench uses this: while a question runs, its dialog shows the answer as it is written, says what the agent is doing, and offers **Stop**.

## Notable in this release

- **Local first:** pages show what this server holds without waiting for a connected machine or the internet, and each machine joins a list when it answers. The server no longer waits for the schedulers' first pass before it serves pages. The desktop app picks its update feed only once its window is shown.
- **Retries:** machine reconnects and model request retries share one row with **Retry now** and **Stop retrying**. A machine's automatic reconnects stop after five failed attempts in a row (it was eight), the first 15 s after the machine is lost, and a person can stop them at any point.
- **Remote machines:** a machine whose server predates the API socket reads as **Restart needed**, on the **Machines** page and above the conversation's composer.
- **Deleting an agent** moves its folder aside at once and removes the files in the background, with a progress card; the app keeps answering in the meantime.
- **Sign-in and origins:** connecting TokenDance from the Models page redirects back to the address the browser is on, port included. Through Penguin Remote, the desktop sees the browser's `https://` address, and a Penguin Remote session counts as the person's sign-in, so it can pair the Chrome extension. Behind a trusted proxy, the origin check reads one forwarded scheme with the raw `Host`, and refuses a write whose `Sec-Fetch-Site` is not `same-origin`.
- **SDK:** `SessionReader` retries history after `408` and `429`, keeps its retry delays and cancellation, and skips fragments a history snapshot already holds. Leaving a model stream before its stop cancels the upstream request.
- **Fixes:** dock panels stay with their own Session; the Cost Center counts a metered request once after an abnormal finish; goal budgets include usage from before a mid-round compaction; the terminal panel reads "Terminal" in English.

### Upgrading

- **Remote machines:** a machine must run the server's version. Update each machine to 0.2.18 from the **Machines** page (**Update**, or **Update all**). If it shows the server's version but still cannot connect, use **Restart server**.
- **Update installed plugins** whose content changed: `goal` (budgets across a compaction), `penguin-support` (live answers; the built-in copy on the default Project is not updated automatically) and `agent-development` (the `penguin-plugin` and `penguin-sdk` Skills for live workbenches).

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime. Installing from npm needs Node >= 24; the official Docker image carries its own. Running the built-in Benchmarks needs Docker with Compose v2 and [uv](https://docs.astral.sh/uv/) on the server's machine. The Browser extension needs Chrome 116 or later. All data stays under `~/.penguin/data` — the `/data` volume in the container.

Full detail: [changelog/0.2.18/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.18).
