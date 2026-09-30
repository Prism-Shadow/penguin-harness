# Backward compatibility

- **Date:** 2026-09-30
- **Type:** process
- **Scope:** `core`, `server`
- **PR:** [#917](https://github.com/Prism-Shadow/penguin-harness/pull/917)
- **Breaking:** yes — a `.project_config.toml` written before this release is rewritten once, on its first read, when it stores a client type MMSP 0.5.0 no longer accepts

[中文版](2026-09-30-backward-compatibility.zh.md)

[MMSP 0.5.0](2026-09-30-mmsp.md) renamed the client types that AgentHub 0.4 named after model generations, and MMSP refuses a name it does not know when the client is built (`Unknown client type "gemini-3.8"`). One thing on disk carries those names: the `client_type` of a model entry in `.project_config.toml`.

## The old shape: a `client_type` from AgentHub 0.4

Earlier catalogs wrote three of the old names themselves — `deepseek-v4` on the `deepseek/deepseek-flash` preset (the default model of new Projects) and on Penguin Go's DeepSeek rows, `gemini-3.8` on Penguin Go's Gemini rows, `minimax-m3` on `minimax/MiniMax-M3` — and a user could type any of the others (`gpt-6`, `gpt-5.6`, `gpt-5.5`, `gpt-5.4`, `claude-5`, `claude-4-8`, `claude-4-7`, `claude-4-6`, `gemini-3.7`, `gemini-3.6`, `gemini-3`, `gemini-embedding`, `glm-5.3`, `glm-5.2`, `glm-5.1`, `kimi-k3`, `kimi-k2.6`, `kimi-k2.5`) into the Web dialog, `penguin config model add --client-type` or a models PUT. Left alone, a Session on such an entry would fail before its first request.

Chosen: **migrate the file once, on its first read.** `migrateLegacyClientTypes` in `packages/core/src/state/project-config.ts` rewrites every `[[models]]` entry whose `client_type` the 0.4 router would have matched, to the MMSP client that speaks the same wire protocol — `gemini-*` and `gemini-embedding` to `gemini-generate-content` (the 0.4 Gemini client spoke generateContent, which is also what the Penguin Go relay serves), `claude-*` to `anthropic-official`, `gpt-*` to `openai-official`, `glm-5*` to `zai-official`, `kimi-*` to `moonshot-official`, `minimax-m3` to `minimax-official`, `deepseek-v4*` to `deepseek-official` — and both readers of the file write it back at once: core's `loadProjectConfig` (the CLI, Session creation and resume, machines) and the server's `ProjectConfigService.readTable` (every route and service). The raw table is what goes back to disk, so every other key the file carries survives. A file with nothing to migrate is not written. An old name that reappears later — a models PUT from a page opened before the upgrade, a model table synced from a machine still on an older release — is repaired the same way at its next read.

The generic client types (`openai-chat` and its `openai` alias, `openai-responses`, `openai-chat-vllm-adapter`, `openai-embedding`, `ant-messages`) are unchanged and untouched.

## What users need to do

Nothing. The file is rewritten the first time the server, the CLI or a Session reads it after the upgrade, and the entries keep their place, key and settings.

Two entries come out of the migration pinned to a client the catalog no longer pins: `deepseek/deepseek-flash` and `minimax/MiniMax-M3`, whose ids route on their own under MMSP 0.5.0. They work as pinned; the Models page's preset badge counts the difference like any other catalog change, and **sync presets** clears the pin. A Penguin Go authorization or sync rewrites its rows to the platform's current protocol on its own.

An entry whose `client_type` is absent and whose id begins with no vendor family MMSP knows — an owner-prefixed id such as `anthropic/claude-fable-5` in a vendor group, or a Bedrock id such as `global.anthropic.claude-opus-4-8` — is not migrated, because nothing routes it under 0.5.0; the Models page marks it and offers a move to a custom group, as it did before this release for an unroutable vendor-group row.

## When it can be removed

At the 0.3.0 release preparation, by whoever prepares that release. Precondition: the 0.3.0 release notes say that a Project last opened before the release that shipped this migration must be opened once on a 0.2.x release first (any read — the server starting, `penguin config model list`, a Session — performs the rewrite). The removal takes out:

- `LEGACY_CLIENT_TYPES` and `migrateLegacyClientTypes` in `packages/core/src/state/project-config.ts`, and the write-back in `loadProjectConfig`;
- the write-back in `ProjectConfigService.readTable` (`packages/server/src/services/project-config-service.ts`);
- the migration cases in `packages/core/test/state.test.ts` and `packages/server/test/models.test.ts`;
- the entry for this migration in the design spec's changelog.
