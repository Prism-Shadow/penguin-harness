# A push boots without the installed plugins it cannot satisfy

- Date: 2026-10-01
- Type: fix
- Scope: server

A hot push replaces the platform but leaves the installed plugins in place. When an installed plugin contributes to a slot, or wires to a module or interface, that the pushed platform does not have, the platform now leaves that plugin out of the new generation, logs which plugin and why, and boots the rest. Previously the whole module tree was rejected and the push refused. The plugin stays installed, so a later build that has its slots runs it again. A rejection that is not traced to a plugin still refuses the push.
