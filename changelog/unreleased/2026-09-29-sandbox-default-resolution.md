# The preview frame matches the sandbox's default resolution

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `web`

A module that declares no `runtime.resolution` is played by the sandbox at 640x480, as in
Loom's dev-sandbox, but the web preview sized its frame for 1024x768. The frame now falls
back to 640x480 too, so the activity and the frame around it agree.
