# A new conversation no longer pairs a Workspace path with another machine

- **Date:** 2026-11-02
- **Type:** fix
- **Scope:** `web`
- **Issue:** [#1414](https://github.com/Prism-Shadow/penguin-harness/issues/1414)

[中文版](2026-11-02-draft-workspace-machine.zh.md)

Saving a Project's new-chat defaults released the draft's cached Workspace path but kept the machine it was on. The next new conversation then took the Project's default Workspace, a path on this server, and created its Session on that remembered machine instead. A draft's machine now travels with its path: saving the defaults releases both, a cached machine without a path is ignored, and a draft open while the defaults are saved reseeds to this server along with the new default Workspace.
