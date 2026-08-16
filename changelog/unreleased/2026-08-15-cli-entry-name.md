# Launchers follow the renamed CLI entry

Splitting the CLI into two bins renamed its entry from `dist/index.js` to `dist/penguin.js`, but two launchers were still generated against the old name, so the `penguin` command they produce could not start.

- **Release tarballs / zips**: the `bin/penguin` and `bin/penguin.cmd` the release workflow writes into every package exec `lib/dist/index.js`. Nothing published so far is affected — the rename is not in v0.2.2 — but the next release built from this branch would have shipped a `penguin` command that fails with "Cannot find module" on every invocation, on every platform.
- **AppImage**: the wrapper installed to `~/.local/bin/penguin` resolves the entry itself, and pointed at the same missing file.

The AppImage wrapper's test spelled the old filename out, which is how the rename slipped past it; it now derives the expectation from `CLI_ENTRY_RELPATH`, the constant the other launchers already share.
