# Machines work from a source checkout and on machines of another kind, stay connected on their own, and are managed from a toolbar

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`, `web`, `tooling`, `ci`, `docs`
- **PR:** [#1023](https://github.com/Prism-Shadow/penguin-harness/pull/1023)

[中文版](2026-10-10-machines-dev-image.zh.md)

A server running from a source checkout (`pnpm dev`, `pnpm desktop`) builds its own install image at every install or use. Before, such a server had no image at all: the Machines page disabled "Add machines…" and "Enable", every install answered `409` `no_install_image`, and the notice promised an image after "the first hot push", which never produced one. Installs also reach machines of another OS or architecture than the server's, machines with no route to the release downloads, and hosts added from the page, and every failure on the way says what it means. Machines are added from a dialog, stay connected on their own once enabled, and every surface reads one live account of them, so a job's steps advance as they happen and the new-chat page no longer says a connected machine is not connected.

## Details

- The image is built with the hot push's own packer. `scripts/deploy.mjs --out <file>` packs the same version a push sends (web dist, platform and CLI bundles, node-pty, TypeScript, the installers, the builtin plugins and the plugin library) and writes the gzipped upgrade body to a file instead of pushing it. It takes no target and no credential, and builds the web dist into a directory of its own beside that file: `pnpm desktop` and the dev server serve `packages/web/dist` to the page in use, so the image never rebuilds it in place. A push still builds in place, as before.
- The server lays that body down as an hmr store under `<root>/machines/checkout-image/<id>/hmr`, never in its own `<root>/hmr`, and installs it like the state of a hot-pushed server: the far side downloads the release named by the checkout's `VERSION`, and the store is replicated over ssh. Images are named by their content. A build keeps the image it replaces and any image a job is still installing, and removes the rest.
- The version is `<VERSION>+hmr.<platform sha>`, the form a hot-pushed server reports. An unchanged tree rebuilds to the same image, so a machine already on it is not reinstalled. After a change to the platform, machines on the previous image read as behind it.
- One build serves a whole batch, and a job that starts while a build runs joins it. Nothing is built when the server starts or when the page lists machines. A build that runs past 20 minutes is stopped together with everything it started (pnpm, vite, plugin installs), and so is a build still running when the server exits: Ctrl-C in the dev terminal, a dev-server restart, the desktop quitting.
- `GET /api/projects/:projectId/machines` gained `checkoutImage` (`unbuilt`, `building`, `built`, or `failed` with the build's last lines), present only for a checkout. `imageVersion` names the image the checkout last built, and stays `null` before the first build.
- A build that fails ends its job at the step `build the install image` with the build's last lines, and offers no forced install. The Machines page shows the same lines in a notice until a build succeeds.
- A hand-over through a machine's update channel, at an install or at the sweep a server runs when it starts, sends the build of the plan being installed, so a checkout hands over its image.
- `no_install_image` is now answered only by a server that is neither installed nor a checkout of this repository, and its message and the page's notice say so. A server installed as a dependency into another pnpm workspace is not a checkout, and never runs that workspace's `scripts/deploy.mjs`.
- The provenance a push or an install image records (`source.repo`, shown by `GET /api/version` and the harness history on the machine that receives it) names the origin remote without the user and password an https clone can carry.
- `deploy.mjs` runs `pnpm` through a shell on Windows, where it is a `.cmd` shim.

## Machines of another kind

- A platform pushed to a machine opens terminals with node-pty from the release installed there, which was published for that machine, before the copy the push carried, which was built on the pushing machine. A Mac's build carried node-pty's darwin and win32 bindings only, so every terminal on a Linux machine failed with "Failed to load native module: pty.node". The spawn-helper repair follows the copy that loaded, and a machine where no copy loads says so in one sentence, with the dynamic linker's words for a binding that is there but refused (a glibc older than it was built against) rather than node-pty's last miss.
- The release payloads carry node-pty's linux-arm64 binding (`prebuilds/linux-arm64/pty.node`), built once in the release under QEMU. No release before carried one, so terminals failed on every arm64 Linux machine.
- The hmr state an install replicates is packed in process (a portable tar), not by the server machine's `tar`. On macOS, `bsdtar` added an AppleDouble `._<name>` member for every file with extended attributes, and the machine unpacked `archives/._node-pty.tgz` as an archive. The platform's own unpack skips `._*` names as well.
- A machine that reaches neither GitHub nor the OSS mirror, or has no `curl`, gets the release package from the server instead: fetched once from the mirror or GitHub, checked against its published checksum, kept under `<root>/machines/releases/v<version>/`, sent over the ssh session and installed with `--archive`. A release that neither source has stops the install at `download the release`.
- The transfer of the replicated store gets a deadline sized for a slow uplink rather than a fixed ten minutes.
- Builds are compared by the files their `harness.json` names rather than by its text, so a machine that took a build through its update channel reads as carrying it. Enabling a machine already on the image's version still hands over a build whose web, CLI or assets changed.

## Failures in plain words

- ssh's fixed diagnostics lead with what they mean and what to do: an unknown or changed host key, a refused key, an unusable key file, a host name that does not resolve, a refused or silent port, a connection dropped before sign-in, a broken ssh config. ssh's own words follow. Such a failure no longer tries a second, Windows connection, no longer offers the forced install, and a job checks ssh before it builds its image. A failed job carries the reason (`sshReason`), so the page says it in its own language with ssh's words under it, and a job ssh refuses at the start fails at its first step.
- A host block the page writes ends with `StrictHostKeyChecking accept-new`: every connection here runs in BatchMode, which cannot answer ssh's first-connection question, so a host added from the page failed with "Host key verification failed".
- A machine reads as connected only while its connection is held. The ssh session an install or a connection check opened stays up until it idles out, and made a machine whose install had just failed read as connected meanwhile.
- One `Include` line may name several files.
- A server start that dies on a port another program holds says so, and offers no forced install; a crash's stack trace becomes its error line.
- The installer's progress bars stay out of the job log, and an installer failure is quoted by its `error:` lines, led by the program's own error when the installer points at it.
- `POST /api/projects/:projectId/machines/:machineId/diagnose` checks a machine without writing anything there: ssh sign-in, the system (a glibc older than the release's Node needs, and musl, fail by name; one too old for its terminals is a caveat), the tools the installer runs, whether the machine reaches the release, free disk, and the port its server would use. It is no longer a button: the server runs it after a job fails at a step it can explain, and after a machine it keeps connected fails to come back three times in a row, and the Machine dialog shows its answer, check by check, as the explanation.

## Adding machines

- The "Add machines…" dropdown became the **Add machine** dialog: one line on what happens, a tab that picks hosts from the ssh config (a search, a row to tick per host with how its block reaches it) and a tab that fills a new host in by hand (name, host, user name, port 22 unless changed, private key), and a footer with Cancel, Add and "Install and connect right after adding", ticked from the start. The header button moved to the primary look at the end of the title row, as on the Agents and Plugins pages.
- `POST /api/projects/:projectId/machines/add` puts machines on a Project's list with nothing installed, and `MachineInfo.member` says which are on it. `GET /api/projects/:projectId/machines/ssh-hosts` lists every host with the user, host and port its own block names.
- A machine is on the list from the moment it is asked for, so its card shows the install as it runs and keeps a first install that failed, with Retry. Deleting it takes the card and the failed job away. A machine added without installing reads **Not installed**, and its dialog offers Enable.

## Kept connected

- A machine once enabled (or started) is kept connected by the server (`MachineInfo.keepConnected`) until it is stopped, deleted or disconnected. When its ssh session drops, its server stops or restarts, or this server restarts, the server brings it back on its own: it probes the machine, starts its server if it is not running, holds the connection again and hands over the Model config. A failed attempt waits twice as long as the one before, from 5 seconds up to 5 minutes, and a job working on the machine is waited for. While it lasts the machine carries `reconnect` (`since`, `attempts`, `nextAt`, `lastError`, `sshReason`, `diagnosis`), and the card and the dialog say **Reconnecting…**, for how long once it passes a minute; after three failures in a row the connection check runs and the dialog shows its answer.
- A SOCKS dial through a machine's session fails at once when the machine refuses the channel. ssh closes such a socket without a SOCKS reply, and the dial waited for good: a request to a machine whose server had died hung instead of failing, and a server that died went unnoticed.

## One event stream for the page

- The server subscribes to every connected machine's `GET /api/events` over its ssh session and republishes each event on its own user stream as `machine_event` (`{machineId, event}`), to admins. The page used to open a stream per connected machine through the `/server/<id>` proxy, and a browser allows six HTTP/1.1 connections to one origin: with five machines connected, every other request of the page waited behind the streams for good — the Machines page froze, and an Add never reached the server.
- Every change to the machines list — a job queued, started, on its next step, logging a line, done; a connection held or dropped; a reconnect under way; a machine joining or leaving a Project — is told to admins as `machines_changed`, a few times a second at most. The page reads the list again on it, rather than polling every 1.5 seconds.
- The Machines page, the new-chat page, the session list and the terminals read one account of the machines (`state/machines.tsx`). The new-chat page asked a machine for its Agents once, when its workspace was picked, and kept the answer: a machine that was still connecting then read "That machine is not connected" for as long as the draft stayed open, while the Machines page showed it connected. It now asks whenever the machine becomes connected, and says why it cannot otherwise — reconnecting, stopped, not on this Project's list, or the machine's own failure.

## Job steps

- Every job carries its own `steps`, and its `phase` only moves forward. A source checkout's image build is a step of its own, **Build the install image**; it used to run under **Check the machine**, which the stepper then showed for the minutes the build took, and a connect behind an install no longer sends the stepper back to the first step.
- One job runs per machine, a few machines side by side: a verb on one machine is no longer refused because another machine's job is running.

## The Machines page

- A card carries the Agents page's quick buttons: **Use** starts a new conversation in the machine's temporary workspace on that machine, **Settings** opens the Machine dialog, and **Delete** takes the machine off this Project after a confirmation that says the connection drops while the program, its data and the ssh host stay. While Use waits, the card says why in a muted line: reconnecting, server stopped, not installed, the last job failed.
- The Machine dialog's verbs are one toolbar under its header: **Update** (only while the machine carries another build; **Enable** when nothing is installed), **Stop server** or **Start server**, **Restart server**, **Configure SSH** and **Uninstall**. One muted sentence under it says why the greyed ones wait. Disable, Disconnect, Remove from Project, Check connection, Reconnect and the description beside every verb are gone.
- `POST /api/projects/:projectId/machines/:machineId/stop` stops the machine's server and stops keeping it connected; it reads **Stopped** until it is started again. `POST …/uninstall` stops it and removes the program, and with `{removeData: true}` its data directory; its confirmation names the program directory and asks about the data directory, unticked. Both are jobs with steps and a log, and change nothing on a machine they cannot reach.
- A job's log has a copy button, as a code block does.

