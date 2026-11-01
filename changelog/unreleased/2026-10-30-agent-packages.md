---
title: Agent definitions as plugin packages
---

- feat(server): an Agent definition is a module contribution read from the package's ifaces.json, installed by copying into a project

  A plugin package contributes an Agent definition the way it contributes a sandbox
  provider: a module in its entry file whose generated table — `ifaces.json` beside its
  package.json — carries the contribution to the agents mechanism's `definitions` slot. The
  contribution's static half is data only: a display name and the package-relative paths of
  the definition's files, the package's `agent_state/` content. The server reads that table
  without importing anything — the manifest is data, read and checked WITHOUT executing the
  module — and a bare `agent_state/` without the contribution is not an Agent package. The
  package stays a normal plugin package, downloaded through the plugin channels (npm names,
  git or tarball links, uploaded zips); what follows the download is a copy of the listed
  files into the project's `agents/`, named by the package's unscoped name — nothing runs at
  copy time, no credentials are written, nothing is loaded. Reinstalling updates the copy in
  place. The Agent's lived history (`memory/`, `traces/`, `snapshots/`, `workspaces/`,
  `scratchpad/`, the vault) is runtime state and never travels in a package.
