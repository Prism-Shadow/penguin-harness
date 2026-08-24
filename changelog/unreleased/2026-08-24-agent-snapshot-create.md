# New agents start from a snapshot package, and exported packages are selectable again

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `server`, `web`, `docs`

[中文版](2026-08-24-agent-snapshot-create.zh.md)

Two changes to Agent State snapshot transfer. The create dialog can now initialize a new
agent straight from an exported snapshot package, instead of the round-trip of creating an
empty agent and then importing into it. And the import file picker no longer grays out the
very files the export produces.

## Create from a snapshot

The Agents page's create dialog gains an optional **Initialize from a snapshot** field:
pick an exported package (`<agentId>-v<n>.tar.gz`) and the new agent is created with the
package's Agent State — its version, prompt, tools, skills, schedules and memory. The id
field is prefilled from the package name while still empty (editable as usual).

- `POST /api/projects/:projectId/agents` takes an optional `dataBase64` (the same 14MB
  package the import endpoint takes). Creating from a package needs no version
  confirmation and takes no pre-import snapshot: both guards protect existing State, and a
  fresh agent has none.
- Explicit `name` / `description` override the package's values; left empty they keep the
  package's own (no id fallback — the package is the identity being copied in).
- Mutually exclusive with skill seeding (`skills` / `skillsDirectory`): the package
  carries its own skills, the server rejects the combination (`snapshot_with_skills`),
  and the dialog hides the skill fields once a package is picked.
- An invalid package fails the whole creation and leaves no empty agent behind — the id
  is immediately reusable.
- Permission follows creation (any project member): the owner-only rule on import guards
  overwriting an existing agent's State, which creating from a package never does.

## Import picker fix

The settings page's import control declared `accept=".tar.gz,.tgz"` only. macOS pickers
(Safari, and the desktop shell's native dialog) map accept extensions to UTIs, and the
double-dot `.tar.gz` maps to nothing — so exported `<agentId>-v<n>.tar.gz` files showed up
grayed out and unselectable. Both snapshot pickers now also declare
`application/gzip` / `application/x-gzip` and a bare `.gz`; the server validates package
structure anyway, so the wider net admits nothing it cannot reject.
