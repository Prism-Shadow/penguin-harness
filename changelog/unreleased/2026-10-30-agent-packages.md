---
title: Agent definition packages
---

- feat(server): agent packages — an Agent's definition is distributed as a plugin package, installed by copying into a project

  An Agent package is a plugin package whose definition part is an Agent's definition:
  `agent_state/` skills, hooks and configuration, plus `system_config.yaml` and `AGENTS.md`.
  A package without a `package.json` can still be an Agent package — the names then come
  from the package directory or an optional `agent.json`; with one, the npm keyword
  `penguin-agent` marks it and npm semantics apply. Downloading happens through the plugin
  channels (npm names, git or tarball links, uploaded zips); what follows the download is a
  copy into the project's `agents/` directory — no install scripts, no credentials, nothing
  executed. The Agent's lived history (`traces/`, `snapshots/`, `workspaces/`, `memory/`,
  the vault) never travels in a package.
