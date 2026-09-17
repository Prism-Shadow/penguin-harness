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

The three rows stay in the catalog marked `retired`. A retired row is not a preset: a new Project never gets it, and **Sync presets** never adds it. A Project that already carries one keeps it maintained: **Sync presets** still updates the row like any preset, and the preset-update badge counts that update, so a price an older release stored is put back to the catalog's. Lookups still find the row, so the Project keeps its name and vision flag, and usage on it is priced on the off-peak schedule whenever the row stores the catalog price, the only price that tier applies to. Nothing on disk changed.

## What users need to do

Run **Sync presets** when the preset-update badge offers it. On a Project whose retired row stores an out-of-date price, that is what puts the row back on the catalog price and its off-peak pricing. Beyond that, a Project can keep the old ids for as long as DeepSeek accepts them, or switch to `deepseek-flash` (DeepSeek V4.1 Flash) and delete the old rows.

## When it can be removed

A retired row comes out only after its seller stops accepting the id, and only with a release note saying that usage recorded on it is priced without its off-peak tier from then on. The catalog refresh that finds the id rejected makes that call.

The upkeep **Sync presets** gives retired rows (core's `catalogModelEntries` and the retired check in the web's `catalog-sync.ts`) goes with them: it can be removed at the catalog refresh that deletes these three rows, unless another row has been retired by then.
