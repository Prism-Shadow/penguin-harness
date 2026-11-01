---
title: Agent definitions as plugin packages
---

- feat(server): an Agent's definition is distributed as a plugin package contribution, installed by copying into a project

  A plugin package can carry an Agent definition the way it carries skills, hooks or MCP
  servers: an `agent_state/` directory beside its package.json — no marker, no extra
  manifest. The package stays a normal plugin package, downloaded through the plugin
  channels (npm names, git or tarball links, uploaded zips); what follows the download is a
  copy of that directory into the project's `agents/`, named by the package's unscoped name —
  nothing runs at copy time, no credentials are written, nothing is loaded. Reinstalling
  updates the copy in place. The Agent's lived history (`memory/`, `traces/`, `snapshots/`,
  `workspaces/`, `scratchpad/`, the vault) is runtime state and never travels in a package.
