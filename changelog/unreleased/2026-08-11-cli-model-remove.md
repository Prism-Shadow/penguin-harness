# CLI: `penguin config model remove` closes the model CRUD gap

- **Date:** 2026-08-11
- **Type:** feature
- **Scope:** `cli`, `core`, `docs`
- **PR:** [#273](https://github.com/Prism-Shadow/penguin-harness/pull/273)

[中文版](2026-08-11-cli-model-remove.zh.md)

`penguin config model` could add an entry, list entries and point the default / vision settings at one, but never delete one — while its sibling `config vault` has had `remove` all along. Dropping a stale model, or a credential inlined on it, meant reaching for the Web App's models page or hand-editing `.project_config.toml`, which that file's own contract rules out: it is written with mode 0600 and read/written only through the system interfaces.

- `penguin config model remove --model-id <id> --provider <group>` deletes a model entry along with the credential stored inline on it. Both halves of the reference are required and matched exactly, so the same upstream id under another provider group is left alone — the same no-guessing rule the other `model` subcommands follow, here guarding a delete rather than a credential write. A pair that is not in the config is reported on stderr with a non-zero exit code, mirroring `vault remove`.
- `default_model` / `vision_model` are cleared when they named the removed entry, matching what the models page already does on delete. A pointer left naming a model that is no longer configured fails the next `createSession` outright, so the confirmation line carries the resulting default model, and calls out the vision setting when this removal is what unset it.
- New core `removeModel(root, projectId, ref)`, idempotent like `removeVaultEntry`: an absent pair is not an error and writes nothing, leaving the caller to decide whether that deserves a message.
