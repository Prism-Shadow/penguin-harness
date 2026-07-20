# Dev commands keep pnpm install current automatically

Forgetting `pnpm install` before a dev command no longer breaks the start: every dev
command's prestep checks install freshness (lockfile-hash stamp) and runs `pnpm install`
itself when node_modules is missing or the lockfile changed.

## Details

- `scripts/dev-prebuild.mjs` gains an install-freshness step inside its existing lock: the
  pnpm-lock.yaml content hash is stamped after a successful install, so the usual dev start
  pays nothing; a fresh clone or a pulled lockfile change triggers `pnpm install`
  automatically (concurrent dev commands still install/build exactly once).
- The lock and stamps move from `node_modules/` to the OS temp directory keyed by the repo
  path — they must exist before the first install does (the old location crashed on a fresh
  clone), and per-checkout isolation comes from the key.
- `dev:docs` / `dev:landing` have no workspace deps to build but still need current
  installs: they now run the prestep with `--install-only`.
