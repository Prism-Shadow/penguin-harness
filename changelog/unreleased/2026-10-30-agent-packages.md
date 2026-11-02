---
title: Agent definitions as plugin packages
---

- feat(server): an Agent definition is a module contribution the package carries in its ifaces.json, copied into the Project when the package loads

  A plugin package contributes an Agent definition the way it contributes a sandbox
  provider: a module in its entry file whose generated table — `ifaces.json` beside its
  package.json — carries the contribution to the agents mechanism's `definitions` slot. The
  contribution's static half names the Agent — the id the definition installs under; its
  CODE half is the contributor copying its OWN `agent_state/` into the target, streaming
  file by file: a multi-gigabyte definition travels as disk IO, with nothing of it in
  memory. Nothing reads the package to find the files — the manifest is data, and the copy
  is code the contributor carries, bound to its contribution the way a sandbox backend is.
  Listing the package applies the Project's table, and the assembly that follows copies the
  definition into every Project that lists the package: nothing runs at copy time, no
  credentials are written, nothing is loaded for the definition's sake. Reinstalling
  updates the copy in place, and a directory deleted by hand is re-filled by the next
  assembly. A bare `agent_state/` without the table is not a plugin.
