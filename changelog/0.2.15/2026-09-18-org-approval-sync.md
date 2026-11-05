# An organization's approval mode reaches the sessions it already has

- **Date:** 2026-09-18
- **Type:** fix
- **Scope:** `server`, `web`, `skills`
- **PR:** [#791](https://github.com/Prism-Shadow/penguin-harness/pull/791)

[中文版](2026-09-18-org-approval-sync.zh.md)

Changing an organization's approval mode in its settings now changes it for the desk and
ticket sessions the organization already has, not only for the ones opened afterwards. The
chat composer no longer offers `always-ask` on an organization's session, where it would deny
every call that needs approval. The approval mode became the board's alone: no employee, the
CEO included, edits it in `org_config.toml`.

## Details

- `OrganizationService.patch`, which every API write of an organization's settings goes
  through, writes a changed `approval_mode` onto every session the organization's files name —
  the current and previous desks in the ledger, and every session a ticket lists — except
  archived ones. A session mid-run applies the new mode from its next approval decision. A
  write that leaves the mode as it was touches no session, so a session whose mode was changed
  from its own composer keeps it until the organization's mode next changes.
- The composer's approval picker lists `read-only`, `allow-all` and `deny-all` for a session
  stamped `client: "org"`, as the organization settings do; so does the Agents panel's
  sub-session composer, which edits the parent session's mode. A session that already stores
  `always-ask` keeps it listed and ticked until another mode is picked.
- `company-employee` and `company-ceo` (plugin `agent-company` `2026.09.18.1`) say the approval
  mode belongs to the board, which changes it in the organization's settings: an employee never
  edits `approval_mode` in `org_config.toml`, not even after a yes, because a hand edit reaches
  only sessions opened afterwards, and asks the board in the all-hands channel when it thinks the
  mode should change. The handbook index a new organization is created with says the same in its
  directory table, in both working languages; an existing organization's handbook was not
  rewritten.
- Sessions on disk whose mode already differs from their organization's were left as they are
  and take the organization's mode the next time it changes; nothing was migrated.
