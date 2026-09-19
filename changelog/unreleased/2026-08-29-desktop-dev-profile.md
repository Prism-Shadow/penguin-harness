# Run an installed desktop build as a second, isolated instance with `--dev`

- **Date:** 2026-08-29
- **Type:** feature
- **Scope:** `desktop`, `server`, `core`, `docs`
- **PR:** [#544](https://github.com/Prism-Shadow/penguin-harness/pull/544)

[中文版](2026-08-29-desktop-dev-profile.zh.md)

The desktop shell's dev isolation — the `PenguinHarness-Dev` identity with its own userData directory, single-instance lock and sticky port, and the `~/.penguin/dev-data` default data root — became a **profile** selected by a command-line switch rather than a side effect of running unpackaged. An installed release build launched with `--dev` takes that profile, so the same installation runs twice side by side: the release instance on `~/.penguin/data`, and a second one on the dev root, with neither seeing the other. An unpackaged run (`pnpm desktop`) still defaults to the dev profile, and `PENGUIN_HOME` still overrides the data root in either profile.

## Details

- `--dev` is matched exactly on the process arguments; `--dev=…` and `--dev-tools` do not select it. On Windows a second shortcut whose target ends in `--dev` is the intended way to launch it.
- A `--dev` instance runs the installed release's own code. It is a way to use the app against separate data without a source checkout, not a way to run uncommitted changes.
- The updater stands down on the dev profile (`unsupported`, reason `dev`) whether or not the build is packaged: the installation it would replace is the release instance's, possibly running beside it.
- The per-launch repair of the bundled `penguin` command link runs only on the release profile, so the shared installation has one owner for it.
- The `[shell] dev instance '<name>' on data root <root>` startup line prints for every dev-profile launch, packaged or not.
- The dev AppUserModelID has no installed shortcut carrying it, so Windows toasts from a `--dev` instance may not render; the release instance is unaffected.

## Machines

The profile holds on every machine the instance reaches. The shell hands it to its server as `PENGUIN_PROFILE` (the `pnpm dev:server` and `pnpm penguin` scripts set it too), and the Machines page installs to, probes, starts, stops and connects to the machine's installation for that profile: release at `~/.penguin` with its data at `~/.penguin/data` on port 7364; dev at `~/.penguin-dev` with `~/.penguin-dev/data` on port 7371 (`DEFAULT_DEV_SERVER_PORT`). A dev instance therefore never restarts the release server a person is using on that machine, and the two profiles keep separate Agents, Sessions and pushed versions on both ends. Every remote command names its program directory and data root explicitly (`PENGUIN_INSTALL_DIR`, `PENGUIN_HOME`) rather than relying on the far side's defaults.

- The profile travels with every remote command as `PENGUIN_PROFILE`, next to `PENGUIN_HOME`, so a server started on a machine reaches further machines in the same profile it was started in.
- The `penguin` command a person types on that machine stays with the release installation. A dev-profile install runs the installer with `PENGUIN_LINK_COMMAND=0`, a new installer option (`install.sh` and `install.ps1`) that leaves `~/.local/bin/penguin` and the Windows user Path untouched.
- A remembered remote port is tried first, except when it is the other profile's default, which is never started on. A remembered port that does not take falls back once to the profile's default — only after the first process was seen to exit, and the wait for a start ends as soon as it has. The port recorded after a start is the one the machine reports serving on.
- The "Install 'penguin' Command…" menu item is offered on the release profile only, like the per-launch repair of that link.

What this means for machine records written before profiles reached machines is in [backward compatibility](2026-09-18-backward-compatibility-dev-profile.md).
