# Machines work from a source checkout and on machines of another kind, and are added from a dialog

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`, `web`, `tooling`, `ci`, `docs`
- **PR:** [#1023](https://github.com/Prism-Shadow/penguin-harness/pull/1023)

[中文版](2026-10-10-machines-dev-image.zh.md)

A server running from a source checkout (`pnpm dev`, `pnpm desktop`) builds its own install image at every install or use. Before, such a server had no image at all: the Machines page disabled "Add machines…" and "Enable", every install answered `409` `no_install_image`, and the notice promised an image after "the first hot push", which never produced one. Installs also reach machines of another OS or architecture than the server's, machines with no route to the release downloads, and hosts added from the page, and every failure on the way says what it means. Machines are added from a dialog.

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

- A platform pushed to a machine opens terminals with node-pty from the release installed there, which was published for that machine, before the copy the push carried, which was built on the pushing machine. A Mac's build carried node-pty's darwin and win32 bindings only, so every terminal on a Linux machine failed with "Failed to load native module: pty.node". The spawn-helper repair follows the copy that loaded, and a machine where no copy loads says so in one sentence.
- The release payloads carry node-pty's linux-arm64 binding (`prebuilds/linux-arm64/pty.node`), built once in the release under QEMU. No release before carried one, so terminals failed on every arm64 Linux machine.
- The hmr state an install replicates is packed in process (a portable tar), not by the server machine's `tar`. On macOS, `bsdtar` added an AppleDouble `._<name>` member for every file with extended attributes, and the machine unpacked `archives/._node-pty.tgz` as an archive. The platform's own unpack skips `._*` names as well.
- A machine that reaches neither GitHub nor the OSS mirror, or has no `curl`, gets the release package from the server instead: fetched once from the mirror or GitHub, checked against its published checksum, kept under `<root>/machines/releases/v<version>/`, sent over the ssh session and installed with `--archive`. A release that neither source has stops the install at `download the release`.
- The transfer of the replicated store gets a deadline sized for a slow uplink rather than a fixed ten minutes.
- Builds are compared by the files their `harness.json` names rather than by its text, so a machine that took a build through its update channel reads as carrying it. Enabling a machine already on the image's version still hands over a build whose web, CLI or assets changed.

## Failures in plain words

- ssh's fixed diagnostics lead with what they mean and what to do: an unknown or changed host key, a refused key, an unusable key file, a host name that does not resolve, a refused or silent port, a connection dropped before sign-in, a broken ssh config. ssh's own words follow. Such a failure no longer tries a second, Windows connection, no longer offers the forced install, and a job checks ssh before it builds its image.
- A host block the page writes ends with `StrictHostKeyChecking accept-new`: every connection here runs in BatchMode, which cannot answer ssh's first-connection question, so a host added from the page failed with "Host key verification failed".
- One `Include` line may name several files.
- A server start that dies on a port another program holds says so, and offers no forced install; a crash's stack trace becomes its error line.
- The installer's progress bars stay out of the job log, and an installer failure is quoted by its `error:` lines.
- `POST /api/projects/:projectId/machines/:machineId/diagnose` checks a machine without writing anything there: ssh sign-in, the system, the tools the installer runs, whether the machine reaches the release, free disk, and the port its server would use. The Machine dialog runs it as **Check connection** and says each result in a sentence.

## Adding machines

- The "Add machines…" dropdown became the **Add machine** dialog: one line on what happens, a tab that picks hosts from the ssh config (a search, a row to tick per host with how its block reaches it) and a tab that fills a new host in by hand (name, host, user name, port 22 unless changed, private key), and a footer with Cancel, Add and "Install and connect right after adding", ticked from the start. The header button moved to the primary look at the end of the title row, as on the Agents and Plugins pages.
- `POST /api/projects/:projectId/machines/add` puts machines on a Project's list with nothing installed, and `MachineInfo.member` says which are on it. `GET /api/projects/:projectId/machines/ssh-hosts` lists every host with the user, host and port its own block names.
- A machine is on the list from the moment it is asked for, so its card shows the install as it runs and keeps a first install that failed, with Retry. Disabling it takes the card and the failed job away. A machine added without installing reads **Not installed** and offers Enable.

