# Deploys work in the WAF workspace's clones

- **Date:** 2026-09-29
- **Type:** feat
- **Scope:** `server`, `web`, `activities`

Deploys no longer keep their own clones under `<PENGUIN_HOME>/activity-deploy/repos/`. A deploy now works in the WAF workspace's clones: `modules/<module>`, `waf-activity-data` and `media`. Authoring, the sandbox and deploys therefore share one module repository per product, as they did in Loom. Clones left under `activity-deploy/repos/` by earlier versions are no longer used, and Penguin does not delete them.

- **Remotes come from the WAF workspace settings.** The activity-data and media remotes moved out of the deploy settings. A server that had saved them there keeps them until the workspace settings are saved once. A module's remote is the workspace's module remote, `git@github.com:waterfordresearchinstitute/{module}.git` by default, rather than its `package.json` `repository`. A new product no longer stops at "the module's package.json names no repository".
- **Prepare clones** asks the workspace for the product's module (cloned, or started empty when its repository does not exist yet) and its media folder. The shared repositories come from preparing the workspace in Settings. A deploy reports `workspace_not_ready` until the workspace is prepared.
- **Media paths are fixed.** The media clone is the media repository, whose top level holds `loom/`. A manifest's `media/loom/<pc>/…` therefore sits at `loom/<pc>/…` in it. Deploys used to look for, write and commit `media/loom/<pc>/…` inside the repository, which is not where Loom's media lives. A media checkout that is not sparse (an existing checkout) counts as holding every folder.
- A deploy still starts only on clean clones, so the stages that reset a clone to `main` never discard anyone's changes.
