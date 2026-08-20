# Desktop installers are built from bundles, not an assembled dependency tree

- **Date:** 2026-08-18
- **Type:** refactor
- **Scope:** `desktop`, `cli`, `ci`

[中文版](2026-08-18-desktop-bundled-packaging.zh.md)

The desktop app stopped shipping a `node_modules` tree. `pnpm build` now emits the shell, the
server and the CLI as three self-contained bundles in `packages/desktop/dist/`, and
`electron-builder.yml` lists exactly what goes inside an installer — replacing
`scripts/stage.mjs`, which assembled the app directory with `pnpm deploy --prod`, pruned it,
rewrote its `package.json` and copied assets into it by hand.

## Details

- `tsup.config.ts` bundles `src/main.ts`, the server package's entry and the CLI's entry, each
  into one file with no shared chunks. `electron` stays external — its npm package is a shim
  that reads the binary's path from disk. The `createRequire` banner `scripts/deploy.mjs` uses
  for hot-update bundles is applied here too, so bundled CommonJS dependencies keep working.
- The shell forks `dist/server.js` from the app path in both a source run and a packaged app,
  so the two run the same artifact. The `penguin` launchers point at `dist/penguin.js`, and the
  AppImage bootstrap derives its path segments from the same constant.
- `scripts/build-assets.mjs` writes the three non-JavaScript outputs `pnpm build` owes the app:
  the skill library beside `dist/`, where the bundled reader's package-relative lookup finds it;
  the runtime window icon into `dist/`; and the `bin/` launcher scripts.
- The web assets are mapped in by electron-builder at pack time. Installers no longer carry
  source maps.
- The app directory that ships shrank from 128 MB to 29 MB.
- MinGit is downloaded into `packages/desktop/build/minigit`, and electron-builder writes its
  output to `packages/desktop/out/`.

## Compatibility

`penguin update` from a desktop install used to be treated as a global npm install and offered
an `npm install -g` command, which installed a second, unrelated copy of the CLI. It now
reports that the CLI ships inside the desktop app and is replaced when the app updates.
