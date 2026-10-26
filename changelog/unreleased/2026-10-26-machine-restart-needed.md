# A machine whose server predates the API socket says it needs a restart

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`, `web`, `ui`, `docs`
- **PR:** [#1338](https://github.com/Prism-Shadow/penguin-harness/pull/1338)

[中文版](2026-10-26-machine-restart-needed.zh.md)

A conversation on a remote machine that was not running this server's version loaded its history but never updated live, and the reply showed only after a page refresh. A server older than 0.2.17 answers HTTP and leaves the API socket's handshake unanswered, and streams are never forwarded over HTTP. Such a machine now reads as needing a restart, on the Machines page and above the conversation's composer, until a handshake completes.

## Details

- When a dial to a machine's API socket times out, this server asks the same port for HTTP. If the machine's server answers, its socket reads `unanswered` instead of `failed`, and every stream refused for it is answered `502 machine_socket_unavailable` with a message in plain words, without the machine id in front: the machine is on a different version, so click **Restart server** on the Machines page, and reinstall it if that doesn't help. Nothing restarts it automatically.
- The reading is kept in memory and holds through further dials. It clears once a handshake completes, which happens when the machine runs this server's version. Entering and leaving it is pushed as `machines_changed`, so open pages pick it up without a reload.
- The Machines page shows the machine as **Restart needed** even when its recorded version is current. The pill's hover reads "This machine is on a different version, so its conversations won't update by themselves. Click Restart server; if that doesn't help, reinstall it." In its dialog **Restart server** is the primary action, unless **Update** is on offer, and the API socket line reads **Can't connect**.
- A conversation on such a machine shows a notice above the composer, "<machine> is on a different version, so this conversation won't update by itself. Go to Machines and restart it.", with a **Go to Machines** button. The stream keeps retrying in the background and opens by itself once the machine runs this server's version.

## A machine must run this server's version

A remote machine must run the same version as this server. An update this server hands to a machine while that machine's server runs replaces the platform and leaves the server process alone, and this server hands its build to every machine on another build when it starts, so a machine can read as current while it is not running this server's version. Restart it from the Machines page; if it still cannot connect, update or reinstall it so it runs this server's version. The 0.2.17 release notes' advice to update each machine from the Machines page does not reach a machine that already reads as current.
