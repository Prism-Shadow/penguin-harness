# A push asks before leaving out the installed plugins it cannot satisfy

- Date: 2026-10-01
- Type: fix
- Scope: server, web

A hot push replaces the platform but leaves the installed plugins in place. Previously, when an installed plugin contributed to a slot, or wired to a module or interface, that the pushed platform does not have, the whole module tree was rejected and the push refused, whatever the pusher wanted.

- **The pusher is asked.** Such a push is refused with `409` `plugins_unsatisfied`, naming each plugin, whether it would be disabled or only lose part of itself, and why. The running version is kept. Sent again with the header `x-penguin-unsatisfied-plugins: leave-out`, the push goes through and its outcome lists what was left out. `scripts/deploy.mjs` prints the list and asks in a terminal; elsewhere it stops and names `--force`.
- **What the platform does once accepted.** A contribution to a slot the build does not declare is dropped and the rest of the plugin runs; any other mismatch leaves the whole plugin out of that generation. The plugin stays installed, so a later build that has what it needs runs it again. A rejection that is not traced to a plugin still refuses the push.
- **Boots nobody is waiting on are not asked.** A cold start, a re-assembly after a plugin change, the restore after a failed push, a rollback from the version history and a build handed over to a machine all boot without those plugins.
- **Where it is reported.** Each such plugin is logged, recorded as an unexpected error of source `plugin` in the Cost Center, and marked on the Plugins page: "disabled on this build" with the reason, or still running with a note of what is not in use. `GET /api/projects/:projectId/plugins/installed` carries it as `unsatisfied: {disabled, reason}`, and such a plugin no longer counts toward `restartPending`.
- **Fix with AI.** An admin can hand such a plugin to an Agent from its row: after a confirmation, a new chat opens in a temporary workspace with a repair prompt in the composer. Nothing is sent until the user sends it.

The first push that delivers this change to a server is served by the platform before it, which does not ask: that one push boots without the plugins it cannot satisfy and reports them as above.
