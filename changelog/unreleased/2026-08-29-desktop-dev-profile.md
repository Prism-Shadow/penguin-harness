# Run an installed desktop build as a second, isolated instance with `--dev`

- **Date:** 2026-08-29
- **Type:** feature
- **Scope:** `desktop`, `server`, `core`, `docs`
- **PR:** [#544](https://github.com/Prism-Shadow/penguin-harness/pull/544)
- **Breaking:** yes — machine records in a dev-profile data root describe the release installation on those machines and are not converted

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
- The wait for a remote start ends as soon as the launched process is gone, with the far side's log as the failure, rather than running out its 30 seconds. The port recorded after a start is the one the machine reports serving on.
- The "Install 'penguin' Command…" menu item is offered on the release profile only, like the per-launch repair of that link.

## Compatibility

Release-profile data roots are unaffected: their machine records were written under the layout they are still read with.

A **dev-profile** data root (`~/.penguin/dev-data`, as used by `pnpm dev`, `pnpm desktop` or an earlier `--dev` build) holds machine records written when every instance reached `~/.penguin`. They are not converted, and nothing reads them leniently: a recorded version is one the dev installation there does not have, and a remembered port is the release server's. Connecting from such a record fails with the machine's own words, or starts the dev server on the port the release server there expects to come back to.

Before reaching a machine from a dev-profile instance, clear what the records remember, with the instance stopped:

```sh
sqlite3 ~/.penguin/dev-data/web.db "UPDATE machines SET version = NULL, installed_at = NULL, remote_port = NULL;"
```

Then install from the dev instance. Nothing on the machine has to be removed, and the release installation there is left as it is.
