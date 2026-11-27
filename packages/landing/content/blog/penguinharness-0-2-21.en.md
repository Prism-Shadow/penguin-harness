---
title: "PenguinHarness 0.2.21: terminals on Linux, a steadier server, and offline machines"
date: 2026-11-27
category: news
excerpt: "A hotfix release: terminals open again on Linux systems with glibc older than 2.42, the server no longer exits on a socket that arrives while it starts, a conversation on an unreachable machine shows its cached copy after five retries, Memory opened from Shortcuts loads, the Browser panel opens its first tab by itself, and a QQ bot carries images, files and voice messages."
---

PenguinHarness 0.2.21 is out — a hotfix release on top of 0.2.20. **Terminals open again on Linux systems with glibc older than 2.42.** 0.2.19 and 0.2.20 broke them for servers, the Linux desktop app and remote machines alike. The server no longer exits when a socket arrives while it starts. A conversation on an unreachable machine stops retrying and shows its cached copy. Memory opened from Shortcuts loads. The Browser panel opens its first tab by itself. A QQ bot connected through Remote control now carries images, files and voice messages in both directions. For everything new since 0.2.17, see [the 0.2.20 post](/blog/penguinharness-0-2-20).

## Terminals open again on Linux

**In 0.2.19 and 0.2.20, every terminal on a Linux system with glibc older than 2.42 failed with `terminal_spawn_failed`.** That covers Debian 12 and 13, Ubuntu up to 25.04, and RHEL 8 and 9. The failure was reported in [#1900](https://github.com/Prism-Shadow/penguin-harness/issues/1900). node-pty compiles its Linux binding when it is installed, and the release shipped the copy its `ubuntu-latest` runner compiled. That runner had moved to Ubuntu 26.04. Its glibc gives `cfsetispeed` and `cfsetospeed` new symbol versions, so the binding needed GLIBC_2.42. The Linux desktop app carried the same binding, and the install image the desktop app pushes to machines carried no Linux binding at all.

Both Linux bindings, x64 and arm64, are now built in a `manylinux_2_28` container and need glibc 2.28, the same floor as the bundled Node. The Linux tarballs, the npm package's carried store, the desktop app's own node-pty and the install image it pushes to machines all carry both. Systems with glibc 2.28 to 2.33, such as RHEL 8 and Debian 11, get terminals too: through 0.2.18 the binding needed 2.34, and the machine check no longer warns that terminals need it.

The release now checks this on what it ships. `scripts/check-native-glibc.mjs` reads the symbol versions of every Linux `*.node` in the payload tarballs, the npm package's carried store and the desktop app. It fails the release, the desktop build and CI's npm packaging when one needs a glibc newer than 2.28 or when an expected binding is missing.

## A conversation on an unreachable machine shows the cached copy

**Opening a conversation on a remote machine that cannot be reached no longer retries without end.** Each wait names its reason and its attempt out of five, for example "Can't reach the server on Office, retrying in 2 s (attempt 2/5)". After five retries that move nothing (1, 2, 4, 8 and 16 s), the page shows this server's cached copy of the conversation and a status line that names the reason and ends with **Retry**, which makes one attempt.

![A conversation on the machine Office after the retries stopped: the status line "The server on Office isn't responding. Showing the conversation from the last sync." with Retry, over the cached copy of a real glm-5.3-flash conversation](/blog-assets/penguinharness-0-2-21-offline-machine-en.png)

Until a stream from that machine moves again, later reads of it try once and do not retry, so reopening the conversation does not start a new round. When the machines list already reads the machine as away, the cached copy and the status line show at once. The page reads the live history again by itself when the machine's API socket comes back, without polling.

## Memory opened from Shortcuts loads

**Since 0.2.19, Memory opened from a conversation's Shortcuts menu stuck on its loading state; it now reads the Agent's memory as soon as it opens.** That was true for a conversation on this server and for one on a machine alike. Memory now reads from the machine the conversation is on, and a listing that cannot be read shows its failure with **[Report]** instead of waiting.

![A real glm-5.3-flash answer built from the Agent's memory, with Memory opened from Shortcuts beside it listing three topics of User memory](/blog-assets/penguinharness-0-2-21-memory-en.png)

The **Files**, **Memory** and **Agents** jumps opened from **Shortcuts** also reset when their tool closes, so reopening one no longer replays the last jump.

## The Browser panel opens its first tab

**Opening the Browser panel with no tab now creates one new tab, the way the terminal panel starts its first shell.** It happens once each time the panel is shown, and not when tabs exist or when the built-in browser is unavailable. Closing the last tab leaves the **New tab** button rather than opening another.

![The Browser panel with the first tab it opened by itself: New tab with its blue globe icon in the tab strip, the address bar and the start page of common sites](/blog-assets/penguinharness-0-2-21-browser-tab-en.png)

A new tab's globe icon takes the theme's link colour instead of the faint secondary text colour, so it is legible in all four themes and in dark mode.

## A QQ bot carries images, files and voice messages

**A conversation connected to a QQ bot through Remote control no longer carries text only.** The images and files an Agent writes in its reply reach QQ. The images, files and voice messages you send reach the Agent. A voice message arrives as QQ's own transcript. A quoted message's text appears above the reply as a blockquote.

Files go through QQ's rich-media upload and are sent as a passive reply, so the server needs no public URL. Each file takes one of the replies QQ allows for your message, and only while no text is waiting for the last one. A file that has no reply left, or that QQ refuses, leaves a one-line note in the chat. A picture in a format QQ refuses is sent again as a file.

## Also in this release

- **Server**: A socket that arrived while the server was starting or swapping its running modules could end the process — for example a browser tab still open on a previous server that reconnected while a fresh data root started. Until startup has finished, the server answers every request with 503 and `retry-after`, and closes a WebSocket handshake at once with 1013 (Try Again Later). A malformed WebSocket request could stop a running server; it is now refused with 400. A failed handshake of a terminal stream or the API socket is logged and refused, and none of these ends the process.
- **Remote machines**: In the desktop app, the browser in a conversation that runs on a remote machine says the conversation runs on another machine, which has no desktop app, so conversations there cannot use the browser. It no longer asks you to open the desktop app you are already in. On the machine, `penguin browser status` says the session's browser is in PenguinHarness on the computer the machine was added from.
- **WeChat**: Sending an image or file to a WeChat chat no longer fails with "the upload URL was not returned". Images arrive viewable in the WeChat client instead of showing as unavailable.
- **Interface**: The dock's **+** menu no longer lists **Hide launcher**. The entry stays on the floating launcher's own menu, and **Shortcuts launcher** under **Settings › Appearance** shows a hidden launcher again.
- **Interface**: Opening an app no longer highlights the **App Center** row in the sidebar alongside the app's own row.
- **Interface**: A notice that wraps, or has a title over its body, keeps its tone dot on the first line in all four themes.

## Upgrading

- **Linux desktop app.** Update the app from its About dialog. A `.deb` install updates through the package manager.
- **Linux server or CLI install.** Run `penguin update`, or the install script again.
- **Remote Linux machines.** First update the desktop app or server they were added from. Then **Update** each machine on the **Machines** page, or **Update all**. Terminals there open once the machine runs 0.2.21.
- **npm installs and the Docker image** compile node-pty where they are installed and were not affected.

Installers are available at [penguin.ooo/download](https://penguin.ooo/download). Full details are in the [0.2.21 changelog](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.21).
