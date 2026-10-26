# A machine whose server predates the API socket says it needs a restart

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`, `web`, `ui`, `docs`

[中文版](2026-10-26-machine-restart-needed.zh.md)

A conversation on a remote machine whose server process started before 0.2.17 loaded its history but never updated live, and the reply showed only after a page refresh. That server answers HTTP and leaves the API socket's handshake unanswered, and streams are never forwarded over HTTP. Such a machine now reads as needing a restart, on the Machines page and above the conversation's composer, until a handshake completes.

## Details

- When a dial to a machine's API socket times out, this server asks the same port for HTTP. If the machine's server answers, its socket reads `unanswered` instead of `failed`, and every stream refused for it is answered `502 machine_socket_unavailable` with a message that names the remedy: restart that machine from the Machines page. Nothing restarts it automatically.
- The reading is kept in memory and holds through further dials. It clears once a handshake completes, as after the restart. Entering and leaving it is pushed as `machines_changed`, so open pages pick it up without a reload.
- The Machines page shows the machine as **Restart needed**, with the reason on the pill's hover, even when its recorded version is current. In its dialog **Restart server** is the primary action, unless **Update** is on offer, and the API socket line reads **Unanswered**.
- A conversation on such a machine shows a notice above the composer: live updates from that machine are not reaching the page, and why, with a button that opens the Machines page. The stream keeps retrying in the background and opens by itself once the machine has restarted.

## Machines updated while their server ran

An update this server hands to a machine while that machine's server runs replaces the platform and leaves the server process alone. This server hands its build to every machine on another build when it starts, so once it ran 0.2.17, such a machine read as current, offered no **Update**, and still had no API socket. The 0.2.17 release notes' advice to update each machine from the Machines page does not reach that case. Such a machine now reads as **Restart needed**: restarting its server from the Machines page loads the build already on its disk, and no reinstall is needed.
