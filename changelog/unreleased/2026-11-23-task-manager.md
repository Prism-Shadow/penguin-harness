# Task Manager: see the tree of what runs now

- **Date:** 2026-11-23
- **Type:** feature
- **Scope:** `task-manager`, `web`, `server`, `amsp`, `core`, `workbench`, `ui-gallery`

[中文版](2026-11-23-task-manager.zh.md)

The Task Manager page lists what runs right now as a tree: each Agent Workbench page, the Sessions it opened, and the background processes those Sessions started. Each page carries the Token total of its Sessions; each process shows its CPU and memory. A Skill lets an agent read the same tree from the shell through `GET /api/me/tasks`.

Workbench pages now have an id of their own, made when the page is first opened, and a Session a page opens records that id as its source, so the page and its Sessions stay linked.
