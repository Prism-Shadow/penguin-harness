# Handing a machine this build, and restarting it onto what it has

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`, `cli`
- **PR:** [#576](https://github.com/Prism-Shadow/penguin-harness/pull/576)

[中文版](2026-09-01-machines-update.zh.md)

A machine that already carries the right release but different pushed state is a **hot update, not an install**. It now goes over that machine's own update channel, which asks the machine and reports its answer — refusals included.

## Over the machine's own update channel

The machine is asked, and a runtime that cannot claim this platform **refuses in words** rather than falling back to its packaged default while the machine is recorded at a version it is not running. Its answer is read in full: a `blocked` outcome is a refusal, and a build the machine took but could not write to its disk is reported as such and not recorded — it is live now and gone at the machine's next restart.

A server that carries no pushed state of its own — a packaged install, a release from a tarball — hands nothing over: a machine already at that release is simply done.

The hand-over carries the platform, CLI and web bundles **and the native assets**: a platform resolves `node-pty` out of its assets directory and nowhere else, so a hand-over without them leaves every terminal on that machine unable to start. Exec bits travel with the files, and `spawn-helper` by name as well as by mode, because a Windows sender has no exec bit to read.

## Files are not the process

Installing replaces the program **on disk**. A server that was up is then restarted onto it, or it would report the new version and behave like the old one. A server that was **down is left down**: installing software is not a decision that the machine should be serving.

That is also why **Restart** is a control of its own — a machine's files can be brought forward while it runs (a replicated store, an install that already matched), and only a restart makes the process match them. The stop is checked: a start after a stop that did not happen finds the port still held, and a readiness probe that only asks "does a server answer" reads that as success.

The connection survives a restart: it is an ssh session to the host, not to the server process, and the server coming back on the same port is reachable through it as before. A restart that fails after an install is the job's outcome, with **Restart** as the next step — not a line in its log under a clean result.

## When the version already matches and the update still fails

The job comes back **offering** to install anyway (`replaceProgram`): the release over there matches, so the installer is skipped, and the only thing that can still change the machine is installing it regardless — which replicates the store the update channel needs. Offered rather than done, and never inferred: it stops a server other people may be using.

An App that boots also hands its build to every machine recorded at a different one, five at a time.

## `penguin server stop`

```bash
penguin server stop
# {"ok":true,"pid":41233}
```

Machine-facing, like `penguin server status`: a controller restarting a machine's server needs to stop it and know that it stopped, and asking the machine's own CLI keeps the answer on the side that has Node. A root nothing is serving answers `{"ok":true}` — the outcome asked for, not a failure.

There is deliberately **no SIGKILL**. A server that has not let go of its lock 15 seconds after SIGTERM is reported, with the port it still holds; it may be holding a database or finishing a task, and destroying that on a timeout is not a controller's call to make. Stopped means the process is gone or the lock is no longer its — a listener that has closed while the server drains is not yet stopped. A server this account cannot signal is reported, not called stopped. On Windows the command refuses: a signal there ends the process outright, which is the destruction it exists not to do.

## Details

The far-side scripts a build ships — the two release installers, the one thing that has to arrive before the CLI does — now come from one list (`scripts/far-side-scripts.mjs`), shared by the packaged build and the hot push. Two hand-kept copies had already drifted once.
