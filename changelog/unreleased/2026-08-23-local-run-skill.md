# A skill for launching and driving the app locally

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `skills`, `docs`
- **PR:** [#428](https://github.com/Prism-Shadow/penguin-harness/pull/428)

[中文版](2026-08-23-local-run-skill.zh.md)

`.agents/skills/penguin-harness-run/SKILL.md` is a new repo-development skill covering how to start
the app on a developer machine: the four dev entry points (`pnpm dev`, `pnpm desktop`,
`pnpm dev:landing`, `pnpm dev:docs`) with their fixed ports, and the environment traps that make a
working setup read as a broken one. Two neighbouring documents were corrected to match it.

## Details

- Data roots are stated per entry point: `resolveRoot()` is `PENGUIN_HOME ?? ~/.penguin/data`, and
  `desktopDataRoot()` sends a packaged build to that same CLI-shared root while only an unpackaged
  run takes `~/.penguin/dev-data`. The skill also names the startup lines that report the root
  actually taken (`Data root: <root>`, `[shell] dev instance '<name>' on data root <root>`).
- `scripts/run-with-env.mjs` applies `VAR=value` with `${VAR:-value}` semantics, so every dev
  default is a default and an inherited `PENGUIN_HOME` silently wins. The rule the skill gives is
  never to export it and to prefix a single command
  (`PENGUIN_HOME=~/.penguin/dev-data-<topic> pnpm dev`) when an isolated root is needed, plus the
  asymmetry an empty value creates between that script and `resolveRoot()`'s `??`.
- `<root>/server.lock` admits one server per data root, refusing with
  `Another PenguinHarness server is already running on this data root (pid N)` and exit 3 regardless
  of `PORT`. The instruction is to move to a distinct root, not to kill what usually is the user's
  own desktop app.
- An environment proxy routes loopback `curl` through itself and answers 502 while the server is
  healthy; browsers and the server's own outbound path are unaffected. The skill gives
  `curl --noproxy '*'` / `NO_PROXY` and says to suspect the proxy before debugging the server.
- Two more surfaces that read as failures: `/api` on `127.0.0.1` is the Workspace-preview host and
  answers 401 by design, and the dev backend on 7368 serves the last-built `packages/web/dist`
  rather than what Vite is serving on 7365.
- Sign-in is covered for scripted runs: the seeded `admin` notice, `<root>/initial-admin-password`,
  `PENGUIN_SEED_ADMIN_PASSWORD`, and the `packages/web/e2e/` harness for chat flows on a root with
  no model credential.
- `CONTRIBUTING.md`'s data-root paragraph now tells contributors to pass `PENGUIN_HOME` inline for
  the one command that needs it rather than exporting it, and names both the unset-or-empty rule
  that makes an exported value win and the collision an exported `~/.penguin/data` produces.
- `penguin-harness-dev` dropped its claim that a remote branch literally named `docs` makes
  `docs/<topic>` branch names impossible in this repo: no such branch is on the remote, and the
  slashed form pushes normally. The `docs-<topic>` names left over from that period are explained
  where the rule is stated, with `git ls-remote --heads origin` as the check if it ever recurs.
