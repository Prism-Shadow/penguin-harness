PenguinHarness 0.2.21 is a hotfix release on top of 0.2.20. Terminals open again on Linux systems whose glibc is older than 2.42, which 0.2.19 and 0.2.20 broke for servers, the Linux desktop app and remote machines alike. The server no longer exits when a socket arrives while it starts, and it refuses a malformed WebSocket request instead of stopping. A conversation on a remote machine that cannot be reached stops retrying after five attempts and shows the cached copy. Memory opened from a conversation's **Shortcuts** loads, and the **Browser** panel opens its first tab by itself. A QQ bot connected through **Remote control** now carries images, files and voice messages in both directions.

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
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:0.2.21
```

`0.2.21` is built from this release's tag. `latest` follows changes to the image's runtime or build inputs on `main`. The example publishes the port on the host's loopback, so a fresh deployment answers only on the machine running Docker.

## Highlights

### Terminals open again on Linux

In 0.2.19 and 0.2.20, every terminal on a Linux system with a glibc older than 2.42 failed with `terminal_spawn_failed` ([#1900](https://github.com/Prism-Shadow/penguin-harness/issues/1900)). That covers Debian 12 and 13, Ubuntu up to 25.04, and RHEL 8 and 9. node-pty's Linux binding is compiled at install time, and the release shipped the copy its `ubuntu-latest` runner compiled. That runner had moved to Ubuntu 26.04, whose glibc gives `cfsetispeed` and `cfsetospeed` new symbol versions, so the binding needed GLIBC_2.42. The Linux desktop app carried the same binding, and the install image the desktop app pushes to machines carried no Linux binding at all.

Both Linux bindings, x64 and arm64, are now built in a `manylinux_2_28` container and need glibc 2.28, the same floor as the bundled Node. The Linux tarballs, the npm package's carried store, the desktop app's own node-pty and the install image it pushes to machines all carry both. Systems with glibc 2.28 to 2.33, such as RHEL 8 and Debian 11, also get terminals: through 0.2.18 the binding needed 2.34, and the machine check no longer warns that terminals need it.

The release no longer takes this on trust. `scripts/check-native-glibc.mjs` reads the symbol versions of every Linux `*.node` in what ships — the payload tarballs, the npm package's carried store, the desktop app's `dist/` and plugins — and fails the release, the desktop build and CI's npm packaging when one needs a glibc newer than 2.28 or when an expected binding is missing.

### A conversation on an unreachable machine shows the cached copy

Opening a conversation on a remote machine that cannot be reached no longer retries without end. Each wait names its reason and its attempt out of five, for example "Can't reach the server on Office, retrying in 2 s (attempt 2/5)".

![A conversation on the machine Office after the retries stopped: the status line "The server on Office isn't responding. Showing the conversation from the last sync." with Retry, over the cached copy of a real glm-5.3-flash conversation](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/assets/blog-assets/penguinharness-0-2-21-offline-machine-en.png)

After five retries that move nothing (1, 2, 4, 8 and 16 s), the read ends with 503 `machine_unreachable`. The page shows this server's cached copy of the conversation and a status line that names the reason ("The server on Office isn't responding." or "Office isn't answering."), says it is showing the conversation from the last sync, and ends with **Retry**, which makes one attempt. Until a stream from that machine moves again, later reads of it try once and do not retry, so reopening the conversation does not start a new round.

When the machines list already reads the machine as away (reconnecting, reconnecting stopped, password refused, server stopped, never connected), the conversation opens neither its history stream nor its live stream: the cached copy and the status line show at once. The page reads the live history again by itself when the machine's API socket comes back; the hub pushes `machines_changed` whenever that socket connects or closes, so the page never polls. The hub's history read also gained the reason `unreachable`, for a machine whose connection is held but whose server neither the API socket nor the forward reaches; such a machine used to read as "the machine is not answering".

### Memory opened from Shortcuts loads

Since 0.2.19, **Memory** opened from a conversation's **Shortcuts** menu stayed on its loading state, on this server and for a conversation on a machine alike. It now reads the Agent's memory as soon as it opens, from the machine the conversation is on.

![A real glm-5.3-flash answer built from the Agent's memory, with Memory opened from Shortcuts beside it listing three topics of User memory](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/assets/blog-assets/penguinharness-0-2-21-memory-en.png)

A listing that cannot be read shows its failure with **[Report]** instead of waiting. The **Files**, **Memory** and **Agents** jumps opened from **Shortcuts** also reset when their tool closes, so reopening one no longer replays the last jump.

### The Browser panel opens its first tab

Opening the **Browser** panel with no tab now creates one new tab, the way the terminal panel starts its first shell.

![The Browser panel with the first tab it opened by itself: New tab with its blue globe icon in the tab strip, the address bar and the start page of common sites](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/assets/blog-assets/penguinharness-0-2-21-browser-tab-en.png)

It happens once each time the panel is shown, and not when tabs exist or when the built-in browser is unavailable. Closing the last tab leaves the **New tab** button rather than opening another. A new tab's globe icon takes the theme's link colour instead of the faint secondary text colour, so it reads in all four themes and in dark mode.

### A QQ bot carries images, files and voice messages

A conversation connected to a QQ bot through **Remote control** no longer carries text only. The images and files an Agent writes in its reply reach QQ, and the images, files and voice messages a user sends reach the Agent. A voice message arrives as QQ's own transcript, and a quoted message's text appears above the reply as a blockquote.

Outbound files are registered through QQ's rich-media upload API and sent as a `msg_type: 7` passive reply, so no public URL is needed. Files up to 3.5 MB go through `file_data`; larger ones use `upload_prepare`, part uploads, `upload_part_finish` and a merge. A file takes one of the message's passive-reply slots, and only while no text is waiting for the final slot. A file that has no slot, or that QQ refuses, leaves a one-line note in the chat and still files an error record. A picture format QQ refuses is sent again as a file.

## Notable in this release

- **Server**: A socket that arrived while the server was starting or swapping its running modules could end the process, for example a browser tab still open on a previous server that reconnected while a fresh data root started. Until startup has finished, the admin seed included, the server answers every request with 503 and `retry-after`, and closes a WebSocket handshake at once with 1013 (Try Again Later). While a hot update or a re-assembly swaps the running modules, the server authenticates handshakes and re-checks open API sockets with the authentication it resolved last, as its HTTP routes already did. A malformed WebSocket request could stop a running server; it is now refused with 400. A failed handshake of a terminal stream or the API socket is logged and refused with 500, and an API socket whose sign-in check throws is closed with 1011. None of these ends the process.
- **Remote machines**: In the desktop app, opening the browser in a conversation that runs on a remote machine no longer says "The browser is not available right now: the built-in browser needs the PenguinHarness desktop app open…" to someone already in the desktop app. It says the conversation runs on another machine, which has no desktop app, so conversations there cannot use the browser, and it sends that machine no browser request. On the machine, `penguin browser status` says the session's browser is in PenguinHarness on the computer the machine was added from and cannot be reached from the machine now, instead of asking to pair a Chrome. A machine's server is started with `PENGUIN_MACHINE=1`; browser import and clearing data answer `405 not_supported` there.
- **Interface**: The dock's **+** menu no longer lists **Hide launcher**. The entry stays on the floating launcher's own menu, and **Shortcuts launcher** under **Settings › Appearance** shows a hidden launcher again.
- **Interface**: Opening an app no longer highlights the **App Center** row in the sidebar alongside the app's own row; **App Center** is the current page only while its grid shows.
- **Interface**: A notice that wraps, or has a title over its body, keeps its tone dot on the first line instead of centring it on the whole box, in all four themes. A one-line notice looks as before.

### Upgrading

- **Linux desktop app**: Update the app from its About dialog. A `.deb` install updates through the package manager.
- **Linux server or CLI install**: Run `penguin update`, or the install script again.
- **Remote Linux machines**: Update the desktop app or server they were added from first, then **Update** each machine on the **Machines** page, or **Update all**. Terminals there open once the machine runs 0.2.21.
- **npm installs and the Docker image** compile node-pty where they are installed and were not affected.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). On Linux, the bundled runtime and terminals need glibc 2.28 or later. The desktop app and the CLI installers bundle their own runtime. Installing from npm needs Node >= 24; the official Docker image carries its own. Running the built-in Benchmarks needs Docker with Compose v2 and [uv](https://docs.astral.sh/uv/) on the server's machine. The Browser extension needs Chrome 116 or later. All data stays under `~/.penguin/data` — the `/data` volume in the container.

Full detail: [changelog/0.2.21/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.21).
