# Server: a model change written to the Project config file reaches loaded Sessions

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `server`
- **Issue:** [#1558](https://github.com/Prism-Shadow/penguin-harness/issues/1558)

[中文版](2026-11-16-config-file-edits-reach-loaded-sessions.zh.md)

A model change written to `.project_config.toml` outside the server, by `penguin config model …` (an Agent running it in a conversation included), by a hand edit, or by another process on the same data root, now reaches Sessions the server already has loaded. Before, they kept the old models and connections until the server restarted or the runtime went idle for 30 minutes. Before it builds or reuses a Session runtime, the server reads the file's model keys (`models`, `[providers]`, `default_model`, `vision_model`) through its mtime-gated read. When they differ from the last read, it drops the Project's cached runtimes, as a Models-page save does. The next Task resumes on the new config, and a Task already running is left alone. Edits to other keys (the display name, the command policy, chat defaults, `[plugins]`) rebuild nothing.
