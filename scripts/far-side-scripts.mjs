/**
 * The scripts that run on the FAR side of a machines operation, and where they come from.
 *
 * `install-server.ts`, `upgrade.ts` and `signin.ts` each resolve theirs beside the module
 * that spawns it — `opts.assets?.() ?? path.dirname(import.meta.url)`. That is dist/ for a
 * packaged install and the published assets directory for a hot-pushed bundle, so the same
 * set has to be produced by two different builds: packages/server/tsup.config.ts copies them
 * into dist/, scripts/deploy.mjs pushes them as assets.
 *
 * Written once here because it was written twice before, and the copies drifted: the push
 * shipped the two installers and neither applier, leaving a hot-pushed server that could not
 * upgrade a machine or sign in to one — each dying on an ENOENT naming a path inside its own
 * store. Neither build could notice, because each list is valid on its own.
 *
 * `from` is relative to the repository root; `name` is the flat filename both destinations
 * use, which is the name the runtime looks for.
 */
export const FAR_SIDE_SCRIPTS = [
  { name: "install.sh", from: "install.sh" },
  { name: "install.ps1", from: "install.ps1" },
  { name: "remote-upgrade.cjs", from: "packages/server/src/machines/remote-upgrade.cjs" },
  { name: "remote-signin.cjs", from: "packages/server/src/machines/remote-signin.cjs" },
];
