# QA scenarios: tasks a QA Agent runs against a real install

- **Date:** 2026-10-05
- **Type:** process
- **Scope:** `tests`

[中文](2026-10-05-qa-scenarios.zh.md)

`tests/scenarios/` holds QA tasks, one directory per task. Each `TASK.md` is the prompt a QA Agent is given.

- `tests/scenarios/README.md` defines the task format. The frontmatter carries `title`, `starts_from` (`scratch`, or another task to continue from), `inputs`, `cost` in minutes and `platforms`. The body has five fixed sections: Goal, Steps, Record, Done when, Never. The README also sets what a run delivers per task (a self-contained `report.html`, `shots/`, `evidence/`, `issues.md`, and `oplog.md` for UI tasks, all outside the repository) and the `handover.md` a task leaves for the tasks that start from it.
- Three tasks: `install/from-ref` installs from nothing at a release, tag or revision and starts the server; `ui/explore` walks the Web App along a fixed path and then freely; `ui/changelog` checks each entry of the ref's changelog in the running product.
