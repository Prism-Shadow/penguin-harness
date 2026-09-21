# Coding-agent sessions fail with a readable error, not a 500

- **Date:** 2026-09-21
- **Type:** fix
- **Scope:** `coding-agents`, `server`
- **PR:** [#27](https://github.com/nicolaepocroianu/penguin-harness/pull/27)

Starting a coding-agent session whose command cannot run — an uninstalled CLI, a shim left behind by an uninstall, or a per-shell PATH entry that has since died — answered 500 Internal Server Error: the spawn or handshake failure arrived as a generic stream error that the route's kernel-error mapping did not recognize.

## Details

- The connection records the spawn's own failure (`ENOENT`, `EACCES`, ...) and the handshake leads with it: sessions now fail with 400 and a message naming the command ("the agent command could not be started: spawn ... ENOENT"). A live agent rejecting the handshake is distinguished from a dead one — its own refusal diagnostic is relayed ("the agent refused the ACP handshake: ...") instead of being misreported as an exit; a refusal of `session/new` is mapped too.
- Resolution and discovery avoid fnm's per-shell multishell dirs (symlinks that die with their shell) while gaining the versioned Node roots themselves — `fnm/node-versions/<version>/installation` on every platform plus nvm's layout and nvm-windows' per-version dirs — so a definition can be saved with a command that survives the terminal it was discovered from.
- Windows cmd.exe shim routing escapes `%` as `^%` outside a fresh quote pair, so arguments like `100%` are not eaten by percent-expansion.
