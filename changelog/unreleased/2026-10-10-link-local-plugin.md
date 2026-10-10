# Enable a local plugin by linking its directory in

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`

[中文版](2026-10-10-link-local-plugin.zh.md)

A plugin directory on the disk had no way in: the examples are private packages, not shipped with the builtin plugins, and enabling one meant staging a copy into the bundled prefix by hand — a copy that drifted from its source, with nothing on record and nothing to undo but another edit.

## Changes

- "Enable a local plugin" (an admin operation) names a built plugin directory; the server links it into the host's plugin prefix and lists the package for the Project — one step, no file edited by hand. The route is `POST /api/projects/:projectId/plugins/installed/local` with `{ "path": … }`. A directory that is not absolute, missing, not a package, or not built (its entry file is absent) is refused with its reason, and nothing is written.
- The link is recorded — where the directory is, when, by whom — one row per package name, machine-wide. The prefix is recreated on every assembly, so the record is what carries the link: each assembly links the recorded names in again, and the sweep, which only ever deletes whole generations, never touches a source directory outside the data root.
- A linked plugin has no integrity. Its generation entry is keyed by the local path and the version read live from its package.json at assembly; that version must still satisfy what a Project's table asks of the name, and an integrity pin on a linked name is refused — a local directory cannot promise a checksum.
- The installed-plugins row of a linked plugin shows its provenance, and "Unlink" undoes the whole operation in one step: the name leaves every Project's table and the record is deleted. What an Agent already installed from it stays.
- The web Plugins page offers "Enable a local plugin" to an admin, shows the provenance on the row, and asks before unlinking. A linked row seen on another machine names its blocker instead of a Remove.
- The three example plugins' READMEs teach this way now — build the package, then link it — and stop teaching the hand-staged prefix. The web e2e suite keeps staging the examples on its throwaway data roots, where nothing should outlive a run, least of all a link's record.
