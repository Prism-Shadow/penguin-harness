# Company mode: an organization can be deleted

- **Date:** 2026-09-20
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#803](https://github.com/Prism-Shadow/penguin-harness/pull/803)

[中文版](2026-09-20-organization-delete.zh.md)

Pausing was an organization's whole lifecycle: there was no way to make one go away short of removing its directory by hand. The Project's owner can now delete one.

- `DELETE /api/projects/:projectId/organizations/:orgId` — owner only, like deleting an Agent (a member gets 403); `204` on success, `404` for an organization that does not exist.
- **Only the organization goes.** Its directory moves, whole, to the Project's trash — `organizations/.trash/<orgId>-<timestamp>/` — so a deletion can be undone by moving the directory back. Nothing lists a dot-directory: the organization disappears from every surface. Its id can be used again once the old CEO's Agent (`<orgId>_ceo`, kept like every employee) has been deleted or the new organization takes another id. The rows the server derived from it (session ownership, calendar and ticket state, read cursors, pending desk notices, budget state) are removed with it, so a new organization under the same id inherits nothing.
- **What it had stays.** Its employees remain Agents of the Project with everything they learned. Its desk and ticket Sessions are kept and stay marked as an organization's, so they do not spill into development mode's list — with the organization gone, no page lists them any more.
- Web: the organization's Settings dialog ends with a "Delete organization" row. The confirmation says what goes and what stays, points at pausing as the way to stop an organization without losing anything, and is armed by typing the organization's id.
