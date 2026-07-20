# Add a combined pnpm dev and a dev:landing shortcut

`pnpm dev` now starts the backend and the web app together with prefixed logs (workspace deps
built once via the shared prebuild lock), and `pnpm dev:landing` serves the landing page dev
server from the repo root.

## Details

- `pnpm dev` runs `concurrently -n server,web "pnpm dev:server" "pnpm dev:web"`. Merging the
  two was previously unsafe: each command prebuilt skills/core with tsup `clean: true` into
  the same dist/ directories and the parallel builds clobbered each other. The lock-serialized
  prebuild (see the serialize-dev-prebuild entry) removed that race, and its success stamp
  collapses the two prebuilds into a single build on a combined start.
- `pnpm dev:landing` delegates to the landing package's Vite dev server (port 7366, completing
  the 7364/7365/7367 dev-port family). The landing package has no workspace deps, so no
  prebuild is involved.
- `concurrently` added as a root devDependency; the dev-command lists in README.md and
  README.zh.md now cover `dev` and `dev:landing`.
- Verified: a combined start performs exactly one skills+core build (the other prebuild
  waits and skips), with the server on 127.0.0.1:7364 and Vite on localhost:7365; the
  landing dev server responds on localhost:7366. Note Vite binds localhost (IPv6 ::1) —
  use `localhost`, not `127.0.0.1`, when probing the Vite ports with curl.
