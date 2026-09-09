# Switching the model keeps the conversation on its machine

- **Date:** 2026-09-09
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-09-model-switch-on-its-machine.zh.md)

Switching the model on a conversation that runs on a machine answered `Workspace does not exist or is inaccessible`. The switch opens a NEW Session for the same Agent on the picked model, deliberately carrying the source Session's Workspace so the files it refers to stay reachable — but it asked THIS server to create it. The path it carried is a directory on the machine, and a server refuses a Workspace it does not have, so the switch failed with a message about a directory that exists and is perfectly reachable where the conversation actually lives.

The creation now goes to the machine the source Session is on. The machine travels with the path, here as everywhere else: the new Session lands beside the old one, its first task (the `[model_switch_from]` block and the user's text) is posted to the same machine, and the trace the model reads for context is on the disk it is served from.
