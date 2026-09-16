# Backward compatibility

- **Date:** 2026-09-16
- **Type:** process
- **Scope:** `model-catalog`
- **PR:** [#749](https://github.com/Prism-Shadow/penguin-harness/pull/749)

[中文版](2026-09-16-backward-compatibility.zh.md)

The [model catalog refresh](2026-09-16-model-catalog-refresh.md) stopped offering three rows that existing Projects still carry: `deepseek/deepseek-v4-flash`, the default model of new Projects from 0.2.0 to 0.2.8; `deepseek/deepseek-v4-flash-vision-exp`, the default in 0.2.9; and `tokendance/deepseek-v4-flash-vision-exp`. **Sync presets** never deletes a row, so those Projects keep them.

## What deleting them would have broken

Cost is priced when it is read, and a row's off-peak tier comes from its catalog entry. Deleting the three entries would have priced every off-peak record on them, past records included, at the peak rate (up to double what DeepSeek bills), dropped their off-peak badge, and shown the raw model id where their name was.

## What was done

The three rows stay in the catalog marked `retired`. A retired row is not a preset: a new Project never gets it, and **Sync presets** neither adds nor updates it. Lookups still find it, so a Project that carries it keeps its name, its vision flag and its off-peak pricing. Nothing on disk changed.

## What users need to do

Nothing. A Project can keep the old ids for as long as DeepSeek accepts them, or switch to `deepseek-flash` (DeepSeek V4.1 Flash) and delete the old rows.

## When it can be removed

A retired row comes out only after its seller stops accepting the id, and only with a release note saying that usage recorded on it is priced without its off-peak tier from then on. The catalog refresh that finds the id rejected makes that call.
