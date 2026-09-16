# The Linux sandbox brings its own bubblewrap

- **Date:** 2026-09-16
- **Type:** fix
- **Scope:** plugins, build
- **PR:** [#729](https://github.com/Prism-Shadow/penguin-harness/pull/729)

[中文](2026-09-16-bwrap-vendored.zh.md)

Confinement on Linux no longer depends on the host having bubblewrap installed. Most distributions do not install it, versions differ between machines, and a deployment whose operator never ran `apt install bubblewrap` had a sandbox that was simply off.

- **The plugin ships `bwrap` itself**, one binary per architecture (`linux-x64`, `linux-arm64`), with the libcap it loads and both licenses beside it. `scripts/vendor-bwrap.mjs` vendors them at build time from conda-forge, pinned by exact URL and sha256 — a hash that does not match fails the build rather than shipping an unpinned binary. The binary resolves its library through an `$ORIGIN/../lib` rpath, so a backend that only rewrites an argv can run it without setting an environment.
- **Precedence at each spawn:** the program named in the Sandbox settings, else the one the plugin ships, else a `bwrap` on PATH. A host with neither still fails closed, now saying to check `kernel.unprivileged_userns_clone` rather than asking whether bubblewrap is installed.
- The backend's live enforcement tests — the Workspace writable and the world outside it not, `read-only` denying the Workspace too, background children confined, `network: none` leaving only loopback, a masked directory reading as empty — now run against the shipped binary on a host with no bubblewrap of its own.
