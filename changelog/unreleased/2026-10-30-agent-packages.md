---
title: Agent definitions as plugin packages
---

- feat(server): an Agent definition is a module contribution the package carries in its ifaces.json, copied into the Project when the package loads

  A plugin package contributes an Agent definition the way it contributes a sandbox
  provider: a module in its entry file whose generated table — `ifaces.json` beside its
  package.json — carries the contribution to the agents mechanism's `definitions` slot. The
  contribution's static half is data only: the Agent id the definition installs under, a
  display name, and the package-relative paths of the definition's files — the package's
  `agent_state/` content. Nothing reads the package by importing it: the manifest is data,
  read and checked WITHOUT executing the module. Listing the package applies the Project's
  table, and the load that follows — an install apply, a push, a boot all pass through the
  same load — copies the listed files into the agents/ of every Project that lists the
  package: nothing runs at copy time, no credentials are written, nothing is loaded for the
  definition's sake. Reinstalling updates the copy in place, and a directory deleted by hand
  is re-filled by the next load. The Agent's lived history (`memory/`, `traces/`,
  `snapshots/`, `workspaces/`, `scratchpad/`, the vault) is runtime state and never travels
  in a package; a bare `agent_state/` without the table is not a plugin.
