# A portable install image, built beside the desktop app

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `desktop`

[中文版](2026-08-20-desktop-install-image.zh.md)

`pnpm --filter @prismshadow/penguin-desktop build:install-image` writes
`packages/desktop/install-image/penguin/`, the tree `install.sh` unpacks: `bin/`, `lib/`
with the web assets at `lib/web`, and a package manifest. A machine that has
PenguinHarness can hand its own build to a machine that has none.

## Why it is its own tree

The desktop package's own output ships the shell and the CLI together, and its launchers
run the CLI on the app's Electron runtime. The far side of a push has no Electron and no
PenguinHarness at all, so the image is the CLI package's own `pnpm deploy --prod` at
`lib/`, with launchers that run on plain Node. Re-deploying costs seconds and keeps the two
shapes from being derived from each other by hand.

The image is independent of electron-builder: producing it neither runs nor requires a
packaging run.

## The shape

Shaped like the universal release package — no bundled `node/`, so the far side needs
system Node >= 24. The launchers still prefer a bundled runtime when one is present, so an
image that later carries `node/` runs unchanged.

The build fails rather than emitting an image whose CLI entry or web assets are missing.
