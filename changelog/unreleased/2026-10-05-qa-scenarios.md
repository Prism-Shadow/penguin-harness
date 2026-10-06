# QA scenarios: tasks a QA Agent runs against a real install

- **Date:** 2026-10-05
- **Type:** process
- **Scope:** `tests`
- **PR:** [#988](https://github.com/Prism-Shadow/penguin-harness/pull/988)

[中文](2026-10-05-qa-scenarios.zh.md)

`tests/scenarios/` holds QA tasks, one directory per task. Each `TASK.md` is the prompt a QA Agent is given.

- `tests/scenarios/README.md` defines the task format. The frontmatter carries `title`, `starts_from` (`scratch`, or another task to continue from), `inputs`, `cost` in minutes and `platforms`. The body has the sections Goal, Prepare (only when an input takes work to produce), Steps, Record, Done when and Never. The README also sets that every input is fixed in the run's `plan.md` before the run starts, that mechanical steps may be done by scripts (for example Playwright) kept next to the task, what a run delivers per task (a self-contained `report.html`, `shots/`, `evidence/`, `issues.md`, and `oplog.md` for UI tasks, all outside the repository) and the `handover.md` a task leaves for the tasks that start from it.
- Four tasks: `install/from-ref` installs from nothing at a release, tag or revision and starts the server; `usability/use-ui` walks the Web App along a fixed path and then freely; `usability/use-cli` does the same from the terminal; `usability/changed-feature` checks each entry of the ref's changelog in the running product, following a changelog plan prepared before the run.
