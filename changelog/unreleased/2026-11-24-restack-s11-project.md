# The project domain's services join the library project package

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/project`, `library/model`, `core`

[中文版](2026-11-24-restack-s11-project.zh.md)

The server's Project services move beside the project vocabulary package that landed before them. `@prismshadow/penguin-library-project` takes the Project service (create, list, delete, member authorization, initial Project provisioning), the access decision, the project events notifier, the project model request path, the `.project_config.toml` store with its migrations and presets, the connect-time default offer, the model protocol and vision detection helpers, and the shared id rules. `@prismshadow/penguin-library-model` takes the tool model connection test. The raw TOML parser the config store reads through is exported from core as `parseProjectConfigToml`, so every reader of the file shares one parser.

The server imports these; nothing in the library imports the server. A moved service keeps its server-side assembly where it binds a server capability: the provider Modules stay, the service classes move — the Project service, the config store and the events notifier take their ports (data-root paths, preinstalled plugins, app seeds, the user channel hub) from the providers. The API's export surface stays whole through re-exports — the in-repo forwards still in use keep the old import paths resolving.

## Details

- `library/project` grows: `ids`, `ports`, `access`, `events`, `project-service`, `model-requests`, `project-config-service`, `project-config-migrations`, `project-config-seed`, `connect-default-offer`, `protocol-detect` and `vision-detect`.
- `library/model` grows: `tool-model-test`, and a type re-export of the MMSP stream event type so the request path needs no direct MMSP import.
- `core` grows: `parseProjectConfigToml`, the raw table read behind the typed config loader.
- The routing layer stays in the server: the models and projects routes speak server mechanisms (machines, balances, tool bindings) that have no library home yet.
- Every interface class involved declares its members under the `@Interface` decorator.
