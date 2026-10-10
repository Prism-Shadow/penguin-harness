# Backward compatibility: a stored `gemini-official`

- **Date:** 2026-10-10
- **Type:** process
- **Scope:** `core`, `web`

[中文版](2026-10-10-backward-compatibility.zh.md)

[MMSP 0.5.2](2026-10-10-mmsp-0-5-2-clients.md) named Google's official Gemini client `google-official`. `gemini-official`, its name in MMSP 0.5.0 and 0.5.1, stays an alias there. A `.project_config.toml` may store the old name, on a model entry or in a group's `[providers.<id>]` table, written by `penguin config model add --client-type`, a models PUT or by hand.

## The old shape: `client_type = "gemini-official"`

The old name is read as an alias. `MMSP_CLIENTS` in `packages/core/src/state/model-catalog.ts` keeps a `gemini-official` row with the same variables (`GEMINI_*`), request path (`/v1beta/interactions`) and fast-mode protocol as `google-official`. Routing, the environment fallback, fast mode, the Web's protocol path and the vendor-group routing check therefore treat the stored value as the new name. Nothing on disk is rewritten: no migration runs on read, and a save from the models page writes the value back as it was read. The model dialog and the group settings show it as stored.

The protocol menu also shows a stored `gemini-generate-content` (the 0.5.0 name of `google-genai`, an alias since MMSP 0.5.1) as Google GenAI, without rewriting it.

## What users need to do

Nothing.

## When it can be removed

With the MMSP upgrade that drops the `gemini-official` alias, by whoever does that upgrade. Nothing rewrites a stored value, so that upgrade first settles with the user what happens to a Project that still stores the old name: a one-time migration to `google-official`, or a release note asking users to change it. The removal takes out:

- the `gemini-official` row of `MMSP_CLIENTS` and its `compat` comment;
- the stored-alias scenario in `packages/core/test/state.test.ts`, and the `gemini-official` cases in `packages/web/test/protocol-path.test.ts` and `packages/web/test/provider-settings.test.ts`;
- the `gemini-official` sentences in the `configuration` docs and in the `unified-llm-api` skill.

The `gemini-generate-content` entry of `PROTOCOL_ALIASES` in `packages/web/src/features/models/protocol-types.ts` goes with the MMSP upgrade that drops that alias, together with the `gemini-generate-content` row of `MMSP_CLIENTS`.
