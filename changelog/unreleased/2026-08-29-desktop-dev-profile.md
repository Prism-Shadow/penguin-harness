# Run an installed desktop build as a second, isolated instance with `--dev`

- **Date:** 2026-08-29
- **Type:** feature
- **Scope:** `desktop`, `docs`
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
