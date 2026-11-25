# Web pages ask Workbench or standalone app first

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `skills`
- **PR:** [#1489](https://github.com/Prism-Shadow/penguin-harness/pull/1489)

[中文版](2026-11-04-workbench-or-app-question.zh.md)

The `software-development` plugin's `web-design` Skill (`2026.11.04.1`) gained a first question. When the user asks for a web page, web app, dashboard or 工作台 in a Workspace with no existing project, and the request does not already say which form it wants, the agent asks with one A2UI `choice` block whether to build a Workbench or a standalone app, then ends its reply.

## Details

- "No existing project" means no `.git` directory at `CWD` or above it inside the Workspace, and no project manifest at `CWD` (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `*.csproj`, `Gemfile`, `composer.json`). An existing project is built into without asking.
- The four options are "Yes, a Workbench" (recommended), "No, a standalone app", "Always a Workbench" and "Always a standalone app", shown as cards with one line each. A pick comes back as a full sentence in the next user message.
- A Workbench answer builds through the `penguin-plugin` Skill with this Skill's visual language; a standalone answer scaffolds a project in the Workspace.
- An "always" answer is saved first as `workbench-or-app.md` in user memory, with a line in its `MEMORY.md` index, and later requests follow it without asking. A Session that cannot write memory says so and builds this one choice.
