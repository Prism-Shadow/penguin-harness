# Git keeps the operator's own SSH setup

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `server`, `activities`

The WAF workspace and deploys run git with SSH in batch mode, so git never waits on a prompt. Until now this replaced any `GIT_SSH_COMMAND` the server was started with, so a server whose remotes only accept a particular key or proxy could not clone or push. A `GIT_SSH_COMMAND` or `GIT_SSH` already in the environment is now kept as it is, and batch mode is set only when neither is there.
