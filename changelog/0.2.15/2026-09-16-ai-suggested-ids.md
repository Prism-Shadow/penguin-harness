# Projects, Agents and Benchmarks get AI-suggested ids

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#755](https://github.com/Prism-Shadow/penguin-harness/pull/755)
- **Breaking:** yes — `POST /organizations/suggest-id` is removed; use `POST /api/projects/:p/suggest-id` with kind `"org"` (or `"channel"`)

[中文版](2026-09-16-ai-suggested-ids.zh.md)

The New Project, Create Agent and New Benchmark dialogs took the organization dialog's shape: the
name comes first, and the id field beside it carries a **Generate with AI** button that asks the
Project's default model for an English id in that kind's own shape. The id stays required,
editable and validated as before; a model that is missing or fails falls back to a transliteration
of the name, and a name nothing can transliterate gets a dated placeholder with a note asking for
a real name.

## Details

- A new route, `POST /api/projects/:projectId/suggest-id`, takes `{name, kind, taken?}` for
  `project`, `agent`, `benchmark`, `org` and `channel`. One implementation serves every kind,
  parameterized by a kind table: `project` and `agent` ids are bare snake_case, a non-admin's
  Project id is `<username>-<suffix>`, and a Benchmark id is kebab-case. No new prefix was
  introduced.
- The route avoids, on its own, every name the kind's create route refuses as taken — every
  Project id and directory on the server, the Project's Agent ids and folders, its Benchmark
  folders, a leftover folder no list shows included — with a `_2` / `-2` suffix. It reads names
  only, and never names those ids to the model. An id the kind rejects for starting with a digit
  or being one character long gets the kind's name in front (`agent_3d_viewer`).
- Asking follows the create routes: a member of the Project for a Project or Agent id, the owner
  for a Benchmark id. The New Project dialog asks the default model of the Project it was opened
  from.
- `org` and `channel` delegate to the organization service, so their proposals, prompts and
  error records are unchanged. `POST /api/projects/:projectId/organizations/suggest-id` was
  removed. A failed model ask for the three new kinds is recorded as an `id_suggest` /
  `id_suggest_failed` error.
- The shared id field and its notice moved from `features/company` to `features/semantic-id`, its
  copy moved from `company` to a `semanticId` dictionary section, and it gained a locked prefix
  for a non-admin's Project id. The Benchmark dialog no longer rewrites the id while the title is
  typed.
- The Server API reference gained the route in place of the organizations' `/suggest-id` row,
  and the Web App guide describes the three dialogs' id fields, in both languages.

## Compatibility

`POST /api/projects/:projectId/organizations/suggest-id` no longer exists. An API client that
called it sends the same body — `{name, kind, taken?}`, `kind` being `org` or `channel` — to
`POST /api/projects/:projectId/suggest-id`, which answers with the same `{id, source, reason?}`.
The Web App and the CLI need nothing: the organization and channel dialogs moved to the new route
in this change, and the CLI never called the old one.
