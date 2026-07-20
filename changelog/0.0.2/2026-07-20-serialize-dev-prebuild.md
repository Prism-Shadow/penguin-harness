# Serialize the dev prebuild to fix concurrent dev:server / dev:web clobbering

dev:server and dev:web now share a lock-serialized, deduplicated prebuild of skills and core,
so launching both at the same time no longer corrupts dist/ (previously two tsup builds with
clean:true raced in the same output directories).

## Details

- New `scripts/dev-prebuild.mjs`: takes an exclusive on-disk lock (atomic mkdir under
  `node_modules/`) around `pnpm --filter skills --filter core build`; concurrent invocations
  wait instead of clobbering. Locks left by crashed runs are stolen when the holder PID is
  dead or the lock is older than 10 minutes.
- A 5-second success stamp collapses duplicate builds: starting dev:server and dev:web
  simultaneously builds once (the waiter skips), and dev:server's inner re-invocation is a
  no-op. The window is deliberately tiny so an edit-then-restart cycle always rebuilds —
  the "never start on stale deps" behavior is unchanged.
- Root `dev:server` now just delegates to the server package's `dev` script (which prebuilds
  via the shared script), removing the historical double build of core; `dev:web` prebuilds
  via the script and then starts Vite.
- `pnpm dev` run standalone from `packages/server` now also builds skills (it previously
  built only core, even though the server imports skills at runtime).
- Verified: concurrent invocations wait/skip correctly and release the lock; a simultaneous
  dev:server + dev:web start performs a single build with both servers coming up cleanly.
