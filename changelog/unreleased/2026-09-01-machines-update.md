# Handing a machine this build, and restarting it onto what it has

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`, `cli`
- **PR:** [#576](https://github.com/Prism-Shadow/penguin-harness/pull/576)

[中文版](2026-09-01-machines-update.zh.md)

A machine that already carries the right release but different pushed state is a **hot update, not an install**. It now goes over that machine's own update channel, which asks the machine and reports its answer — refusals included.

## Why not just copy the files over

Streaming the store across and restarting the process replaces the code under a server without ever asking whether it can run what it was handed. A runtime older than the pushed platform warns, falls back to its packaged default, and carries on serving — so from here the restart reads as a success, and the machine is recorded at a version it is not running. Asking the machine means a runtime that cannot claim this platform **refuses in words**.

The hand-over carries the platform, CLI and web bundles **and the native assets**: a platform resolves `node-pty` out of its assets directory and nowhere else, so a hand-over without them leaves every terminal on that machine unable to start. Exec bits travel with the files, and `spawn-helper` by name as well as by mode, because a Windows sender has no exec bit to read.

## Files are not the process

Installing replaces the program **on disk**. A server that was up is then restarted onto it, or it would report the new version and behave like the old one. A server that was **down is left down**: installing software is not a decision that the machine should be serving.

That is also why **Restart** is a control of its own — a machine's files can be brought forward while it runs (a replicated store, an install that already matched), and only a restart makes the process match them. The stop is checked: a start after a stop that did not happen finds the port still held, and a readiness probe that only asks "does a server answer" reads that as success.

A restart re-raises the forward it dropped. Without that it is a quiet disconnect — the proxy answers 503 for every call to that machine until somebody presses Connect.

## When the version already matches and the update still fails

The job comes back **offering** to install anyway (`replaceProgram`): the release over there matches, so the installer is skipped, and the only thing that can still change the machine is installing it regardless — which replicates the store the update channel needs. Offered rather than done, and never inferred: it stops a server other people may be using.

An App that boots also hands its build to every machine recorded at a different one, five at a time.

## `penguin server stop`

```bash
penguin server stop
# {"ok":true,"pid":41233}
```

Machine-facing, like `penguin server status`: a controller restarting a machine's server needs to stop it and know that it stopped, and asking the machine's own CLI keeps the answer on the side that has Node. A root nothing is serving answers `{"ok":true}` — the outcome asked for, not a failure.

There is deliberately **no SIGKILL**. A server that has not let go of its lock 15 seconds after SIGTERM is reported, with the port it still holds; it may be holding a database or finishing a task, and destroying that on a timeout is not a controller's call to make.

## Details

The far-side scripts a build ships — the installers and the appliers — now come from one list (`scripts/far-side-scripts.mjs`), shared by the packaged build and the hot push. Two hand-kept copies had already drifted once.
