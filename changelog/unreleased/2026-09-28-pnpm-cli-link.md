# Register the development CLI with pnpm 11

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `cli`, `tooling`

Replaced the removed `pnpm link --global` command in the build's optional CLI registration step with `pnpm add --global ./packages/cli`. Updated the fallback message to refer to the actual error and recommend restarting the terminal after PATH setup.
