---
title: Install PenguinHarness from nothing, at a given release, tag or revision
starts_from: scratch
inputs:
  ref: a release tag (for example v0.2.13), a git tag without a release, or a commit revision
cost: 30
platforms: [linux, macos, windows]
---

## Goal

Starting from a machine with no PenguinHarness on it, install the product at `ref` the way a user
would, and start its server. The task establishes whether the install works and leaves a running,
signed-in product for the tasks that start from it.

## Steps

Every file the product writes must land inside one scratch directory `<SCRATCH>`, created for this
run. Use these names throughout:

- `<DL>` = `<SCRATCH>/dl`: downloaded files, kept unmodified as evidence.
- `<PROD>` = `<SCRATCH>/product`: the install directory (`PENGUIN_INSTALL_DIR`).
- `<H>` = `<SCRATCH>/home`: the `HOME` of every product process. `install.sh` always links the CLI
  into `$HOME/.local/bin` and the data root defaults to `$HOME/.penguin/data`, so only a separate
  `HOME` keeps both inside the scratch directory. On Windows set `USERPROFILE` instead.

1. **Clean state.** Record the OS and version, free disk space, and whether `~/.penguin`,
   `~/.local/bin/penguin` and a `penguin` on `PATH` already exist. Create `<SCRATCH>`, `<DL>`,
   `<PROD>` and `<H>`.
   - Observe: nothing of PenguinHarness exists yet, or what exists is named and left untouched.
   - Screenshot: `s01-01-clean-state.png`.
   - Counter-example: an earlier data root is in use without being recorded; then no later "first
     start" observation counts.

2. **Fetch the product.** Decide the channel from `ref`:
   - **A tag with a GitHub Release.** Download from
     `https://github.com/Prism-Shadow/penguin-harness/releases/download/<ref>/` the installer
     (`install.sh`, or `install.ps1` on Windows), this platform's CLI archive and desktop
     packages, `SHA256SUMS`, `SHA256SUMS.desktop` and `release-download-manifest.tsv`. Give every
     download a stall limit (with curl: `--connect-timeout 30 --speed-limit 20000 --speed-time 60`)
     so a hung transfer fails instead of waiting forever. Check every file's size against the
     manifest and its checksum against the sums files.
   - **A tag without a release, or a revision.** Clone the repository into `<SCRATCH>/src`, check
     out `ref`, then `pnpm install --frozen-lockfile` and `pnpm -r build` (Node >= 24). The CLI is
     `packages/cli/dist/penguin.js`. Desktop packages are out of scope for this channel; say so in
     the report.
   - Observe: the size and checksum result for each file, quoted; or the commit the build ran on.
   - Screenshot: `s02-01-fetched.png`.
   - Counter-example: a size or checksum differs. Stop there and record it as a problem.

3. **Install.** For a release, install offline from the downloaded archive:
   `HOME=<H> PENGUIN_INSTALL_DIR=<PROD> PENGUIN_ARCHIVE=<DL>/<cli archive> sh <DL>/install.sh`
   (on Windows, the same variables with `install.ps1`). For a source build there is no install
   step; the built CLI is the product.
   - Observe: the installer's lines on version, install path and `PATH`, quoted;
     `<PROD>/bin/penguin --version`.
   - Screenshot: `s03-01-install-output.png`.
   - Counter-example: the installer downloads the archive again instead of using the local one, or
     the version is not `ref`.

4. **CLI surface.** Run `penguin --help`, `penguin --version` and `penguin org --help`.
   - Observe: each listed subcommand, present or absent.
   - Screenshot: `s04-01-cli-help.png`.

5. **Start the server.** Start it in the background, with `HOME=<H>`, a free port chosen
   explicitly, and no browser: `penguin web --no-open --port <PORT>`, output to
   `<SCRATCH>/server.log`.
   - Observe: the log's listen address and `Data root:` line, quoted. The data root must be under
     `<H>`. An authenticated `GET /api/version` (bearer token from `<H>/.penguin/data/api-token`)
     answers the expected version.
   - Screenshot: `s05-01-server-start.png`.
   - Counter-example: the port is taken or the server exits. Quote the error, try one other free
     port, and record the problem either way.

6. **First sign-in.** Open the sign-in link the server log prints in a browser driven by the Agent
   (Playwright or the platform's own). Redact the token in every screenshot and evidence file.
   - Observe: the first page after sign-in, and any notice about the initial password.
   - Screenshot: `s06-01-signed-in.png`.

7. **Desktop package** (release channel only). Start the desktop app for this platform from the
   downloaded package, after stopping the server from step 5: a desktop app started next to a
   running server on the same data root attaches to it instead of starting its own. On Linux,
   extract the AppImage (`--appimage-extract`) and run it under a virtual display if there is no
   desktop session; inspect the `.deb` with `dpkg-deb -c` and `dpkg-deb -f`.
   - Observe: a rendered window (a screenshot of it, not a process listing); the package's version
     field.
   - Screenshot: `s07-01-desktop-window.png`.
   - Counter-example: the process starts but no window pixels can be captured. Record "not
     verified" with the error, never "probably works".

8. **Hand over.** Start the server again as in step 5 and leave it running. Write `handover.md`.

## Record

In `<RUN>/install/from-ref/`: `report.html`, `shots/`, `evidence/` (downloaded manifests, installer
output, `server.log` excerpts with tokens redacted), `issues.md`, and `handover.md` with `<SCRATCH>`,
`<PROD>`, `<H>`, the data root, the server URL, how to sign in, and the running processes with
their PIDs.

## Done when

The server answers on its port, a browser session is signed in, and `handover.md` is written; or a
step failed in a way that blocks the rest, and the report says which step and quotes the failure.

## Never

- Write outside `<SCRATCH>`, or delete anything outside it.
- Use an existing checkout, an existing install or an existing data root as the product under test.
- Use a port another service already listens on, or stop a process this task did not start.
- Put tokens, sign-in links or passwords into the report unredacted.
- Push, commit, or change repository settings or secrets.
