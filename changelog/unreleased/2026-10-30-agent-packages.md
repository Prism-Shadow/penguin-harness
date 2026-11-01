---
title: Agent definitions as plugin packages
---

- feat(server): an Agent definition is a plugin package contribution the package registers in its own manifest, installed by copying into a project

  A plugin package registers an Agent definition the way it registers a hook package or MCP
  servers: one line in its own manifest — `"penguin": { "agent": true }` in its
  package.json. The definition's content lives in the package's `agent_state/` directory,
  the way a skill's lives in `skills/<name>/`. The server reads that registration instead of
  scanning the package for parts: a bare `agent_state/` without the declaration is not an
  Agent package, and a form other than `true` is warned about and ignored. The package stays
  a normal plugin package, downloaded through the plugin channels (npm names, git or tarball
  links, uploaded zips); what follows the download is a copy of that directory into the
  project's `agents/`, named by the package's unscoped name — nothing runs at copy time, no
  credentials are written, nothing is loaded. Reinstalling updates the copy in place. The
  Agent's lived history (`memory/`, `traces/`, `snapshots/`, `workspaces/`, `scratchpad/`,
  the vault) is runtime state and never travels in a package.
