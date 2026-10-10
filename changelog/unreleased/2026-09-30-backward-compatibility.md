# Backward compatibility

- **Date:** 2026-09-30
- **Type:** process
- **Scope:** `server`, `cli`, `web`, `model-catalog`
- **PR:** [#914](https://github.com/Prism-Shadow/penguin-harness/pull/914)
- **Breaking:** yes — a models PUT, or `penguin config model add`, that adds a model which is not one of the group's presets to any built-in group but custom and vLLM is refused (`400 model_not_addable` / exit code 1); entries already stored keep working and are never rewritten

[中文版](2026-09-30-backward-compatibility.zh.md)

[The models page lines up with the model picker](2026-09-30-models-page-refresh.md) takes the add-model entry point away from every built-in group but custom and vLLM, and the server and the CLI refuse the same additions. One thing outlives the release: the models users already added to those groups.

## The old shape: a hand-added model in a gateway group

Up to this release the gateway groups — TokenDance, OpenRouter, Fireworks AI, SiliconFlow, OpenCode Go, the two Qwen groups, ModelScope — took models added by hand, from the models page, the API and `penguin config model add`. A `.project_config.toml` may therefore hold a `[[models]]` entry in one of those groups whose `(provider, model_id)` pair is not in the built-in catalog. Such an entry works: it carries the gateway's endpoint and protocol like the presets beside it.

Chosen: **keep it, as it is, with no migration.** The refusal applies only to an entry a request introduces. One already stored under the same `(provider, model_id)` key passes through untouched, and so does a rename inside its own group, whose `renamedFrom` names a stored row of that group. A move into such a group from another one is judged as a new entry, because that is the act of adding it there. The same holds for a first-party vendor group, where a routable id that is not a preset used to be accepted.

**A user is not required to do anything.** The entry stays in its group, keeps working, and can be edited, renamed within the group or deleted from the models page. Models to add from now on go into custom or a group of the user's own.

## Nothing is scheduled for removal

This is a validation rule rather than a shim: there is no second code path reading an old format, and nothing here expires. A preset the Project deleted may always be added back to its own group, which is what "Sync presets" does.

## Compatibility

Upgrading asks nothing of anyone. Configurations written before this release load and save as they did. What changes is what may be written from here on: a models PUT introducing a model that is not a preset into any built-in group but custom and vLLM answers `400 model_not_addable`, and `penguin config model add` refuses with exit code 1. Scripts that add such a model move it to `--provider custom` or a group name of their own, with `--client-type` and `--base-url`.
