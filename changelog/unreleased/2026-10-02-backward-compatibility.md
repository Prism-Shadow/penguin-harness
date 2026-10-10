# Backward compatibility

- **Date:** 2026-10-02
- **Type:** process
- **Scope:** `core`, `server`
- **PR:** [#948](https://github.com/Prism-Shadow/penguin-harness/pull/948)
- **Breaking:** yes — a `.project_config.toml` written before this release is rewritten once, on its first read: a base URL, protocol or key the rows of a group share moves to the group's `[providers.<id>]`

[中文版](2026-10-02-backward-compatibility.zh.md)

[Group connections](2026-10-02-provider-connection.md) resolve a model's base URL, key and protocol from the model first, then its group's `[providers.<id>]`, and from nothing else. Every `.project_config.toml` written before that stores these values on its rows, where the new order reads them as each model's own.

## The old shape: copies on every row

- Preset rows carry a copy of their catalog protocol (`client_type`) and, where the catalog has one, their endpoint (`base_url`), written when the Project was created or its presets synced.
- Every group-wide key write (**Enter key**, **Connect**, Penguin Go's and ModelScope's authorization, ModelScope's token refresh) put one key (`api_key`, `created_at`) on each row of the group.

Read as they are, all of these are overrides. A key written to the group after the upgrade would never reach a row that still holds the old one, ModelScope's refreshed token included; a group base URL or protocol would change nothing for the rows already stored; and every connected group would read **Not connected**.

## What the migration does

`hoistProviderConnections` in `packages/core/src/state/project-config.ts` rewrites the parsed table in place, reading nothing from the catalog. `migrateProjectConfigTable` calls it after [MMSP 0.5.0's client-type migration](2026-10-01-backward-compatibility.md), so it compares MMSP's names, and both readers of the file write the result back once: core's `loadProjectConfig` (the CLI, Session creation and resume, machines) and the server's `ProjectConfigService.readTable` (every route and service). It runs only on a file with no `providers` key, that is, a file this release has never written: the writer always writes the key, as an empty `[providers]` table when no group sets anything. It therefore runs once per file, and never mistakes a value the user sets later for an old copy.

Per group present in the rows, `custom` excepted:

- **Base URL.** When every row of the group carries one, the most common value (a strict plurality, compared with `sameEndpoint`; a tie moves nothing) becomes `[providers.<group>].base_url` and leaves the rows that held it; rows with another value keep theirs. A row without one blocks the move, since following a group base URL would change where it goes.
- **Protocol.** When every row carries one and all are the same (`sameClientType`), it becomes `[providers.<group>].client_type` and leaves the rows.
- **Key.** When every row of the group that holds a key holds the same one, and the group key would reach each of those rows after the base URL step (`groupKeyReaches`), the key moves to `[providers.<group>].api_key`, with the latest of those rows' `created_at`, and leaves the rows. Otherwise every row keeps its key.
- A field no row had stays absent, every other key in the file survives, and a file with nothing to move is not written. No model's requests change, except that a model with no key of its own in a group whose key moved now uses the group key where it reaches it.

Typical results: the OpenAI-compatible gateways and ModelScope end with a base URL, a protocol and the key on the group and bare rows; Penguin Go with its relay base URL and the key on the group, each row keeping its protocol; OpenCode Go with its Chat Completions base URL and the key on the group, the Messages rows keeping their endpoint and every row its protocol; a vendor group with its key alone.

## What users need to do

Nothing. A group whose rows held different keys keeps them as per-model keys and reads **Not connected** until a group key is set in its settings. A row whose endpoint or protocol was not moved keeps it as its own; **Restore defaults** brings the built-in models and groups back to a new Project's shape.

## When it can be removed

At the 0.3.0 release preparation, by whoever prepares that release, together with [MMSP 0.5.0's client-type migration](2026-10-01-backward-compatibility.md). Precondition: the 0.3.0 release notes say that a Project last opened before the release that shipped this migration must be opened once on a 0.2.x release first; any read (the server starting, `penguin config model list`, a Session) performs the rewrite. The removal takes out:

- `hoistProviderConnections`, its call in `migrateProjectConfigTable`, and that wrapper together with the client-type migration (`packages/core/src/state/project-config.ts`);
- the empty `[providers]` marker in `renderProjectConfigToml`;
- the write-back in `loadProjectConfig` and in `ProjectConfigService.readTable` (`packages/server/src/services/project-config-service.ts`);
- the migration cases in `packages/core/test/state.test.ts` and `packages/server/test/models.test.ts`;
- the migration's sentence in the design spec's changelog entry of 2026-10-02.
