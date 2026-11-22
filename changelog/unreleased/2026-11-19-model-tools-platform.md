# Plugins can bind Project models to their tools and call them outside a chat turn

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `db`, `docs`
- **PR:** [#1639](https://github.com/Prism-Shadow/penguin-harness/pull/1639)

[中文版](2026-11-19-model-tools-platform.zh.md)

The platform gained three generic primitives for plugins that offer model tools (image, video,
speech, search): bindings from a plugin's tool to a configured model, requests to a Project model
outside a chat turn that are billed like chat, and plugin CLI commands that any Project member can
run with files. No tool or operation is named in the platform; the tools themselves are a plugin's.

## Bindings

- `.project_config.toml` has an open `[tools]` table: `key = { provider, model_id }`, one line per
  binding. Core keeps it through the CLI's load and save and reads no key of it. Removing a model,
  on the models page or with `penguin config model remove`, unbinds what named it; a renamed model
  keeps its bindings; **Restore defaults** clears them. `vision_model` is unchanged.
- A plugin declares a binding in the new `ToolModelBindingsProvider.bindings` slot (exported from
  `@prismshadow/penguin-server/plugin`): the key and its name in English and Chinese, plus an
  `accepts(model)` code half that says which configured models can serve it. Plugin modules read a
  Project's choice through the `ToolModelBindings` interface.
- `accepts(model)` sees each model's provider, id, client type and vision mark, and also `client`
  (the MMSP client a request to it goes to) and `input` / `output` (the modalities MMSP's registry
  lists for the model there), so a plugin can tell an image or speech model without carrying MMSP's
  registry.
- `GET /api/projects/:projectId/models/tool-bindings` lists the declared bindings with each one's
  model and candidates (any member); `PATCH` binds or unbinds one key (the owner). A change is
  published to the Project's users as `tool_bindings_changed`.
- `GET /models` reports `toolModels`, and `PUT /models` takes it as the whole table. The machine
  sync sends it, so a machine's bindings follow this server's.

## Requests outside a chat turn

- Core's `streamProjectModel` sends one request to a configured model with the client chat builds:
  the row's connection, PenguinHarness's User-Agent, the endpoint's attribution, and chat's idle
  timeout. It reports the usage the provider gave, also for a response MMSP rejected after it was
  paid for.
- The server's `ProjectModelRequests` interface wraps it for plugin modules. It writes one
  `usage_records` row per request, attributed to the Session and Agent when there is one. The row
  carries the request's purpose (`<package>:<operation>`) in the new `purpose` column, and is priced
  like any other request.
- The request a plugin hands to `ProjectModelRequests.stream`, `ProjectModelRequest`, is declared in
  `@prismshadow/penguin-core` and re-exported by the server, so a plugin package, which compiles
  against core alone, can require the interface.
- A request recorded beside a Session's own no longer disturbs the Session's request bookkeeping.

## Plugin CLI commands

- A command's data half can say `access: "member"`. Then any member of the caller's Project can
  run it, and the program built for a non-administrator holds only such commands.
- A run carries the caller's Project and Session (an Agent's `PENGUIN_PROJECT_ID` and
  `PENGUIN_SESSION_ID`, else `default_project` for a member command). The server checks both and
  hands the command a `caller`.
- A command can declare `files.read` options, whose files the terminal reads and sends, and a
  `files.write` option, under which the terminal saves the files the command hands back. Saved
  files never replace an existing file, and each saved path is printed on stderr.
- Commands write through `ctx.stdout`, `ctx.stderr` and `ctx.exit`. Member commands run
  concurrently, while admin commands keep the process-stream capture they had.
