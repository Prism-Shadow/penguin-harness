# Backward compatibility: `user_prompt` commands of hook packages from before 2026.09.29.1

- **Date:** 2026-09-29
- **Type:** process
- **Scope:** `core`, `plugins`
- **PR:** [#TBD](https://github.com/Prism-Shadow/penguin-harness/pull/TBD)

[中文版](2026-09-29-backward-compatibility.zh.md)

[Hook packages follow the model context, and `user_prompt` hooks run on every prompt](2026-09-29-hooks-per-context-and-every-prompt.md) changed what a `user_prompt` command that names no `trigger` means: it had run only when a host started it by name, and it runs on every prompt the user submits after the change. The `goal` package already installed on agents names no trigger on its `start.mjs`, and that script starts a goal with no budget whenever it runs without one, so read the new way it would have turned every ordinary message into an unbudgeted goal.

## What is tolerated

`userPromptTrigger(manifestVersion, command)` in `packages/core/src/plugins/index.ts` reads a manifest whose `version` is a plugin version older than `USER_PROMPT_EVERY_PROMPT_SINCE` (`2026.09.29.1`), in either spelling (`YYYY.MM.DD.N` or the older `YYYY-MM-DD.N`), the old way: its `user_prompt` commands that name no `trigger` are read as `trigger: "host"`. Those commands stay out of the every-prompt consult, and the goal start still finds its command through `Session.runUserPromptHook`. A `trigger` that a command names always wins, and a manifest with no version, or with one that is not a plugin version, is read the new way. Core writes one stderr line per process per package directory when it reads a package this way (`remindToUpdate` in `packages/core/src/agent.ts`).

## Scope

Every installed hook package whose manifest carries such a version and has a `user_prompt` command without a `trigger`. In practice that is the `goal` package installed from the plugin library at `2026.09.01.1` or earlier, which `default_agent` gets preinstalled. `continual-learning` has no `user_prompt` command and is unaffected. A package written by hand is affected only when it copied a version number from before `2026.09.29.1`.

## What users need to do

Update the `goal` plugin from the plugin library; the library's update notice offers it, because the plugin moved to `2026.09.29.1`. Nothing breaks until then: the old package keeps starting goals as before and never runs on an ordinary prompt. Whoever edits an older package by hand, a person or an agent, gives each `user_prompt` command an explicit `trigger`, or raises the `version` when the commands should run on every prompt.

## When it can be removed

At the 0.3.0 release preparation, by whoever prepares that release. Precondition: the 0.3.0 release notes require updating the `goal` plugin, so an install still on the old package is told to update before the reading goes away. The removal takes out:

- `predatesEveryPromptHooks`, `USER_PROMPT_EVERY_PROMPT_SINCE` and the version fallback in `userPromptTrigger` (`packages/core/src/plugins/index.ts`), leaving an absent `trigger` to mean `"prompt"`;
- `remindToUpdate` in `packages/core/src/agent.ts`;
- the legacy case in `packages/core/test/hook-packages.test.ts`;
- the note on the legacy reading in the Skills & Plugins docs page (`skills.en.md` and `skills.zh.md`), the matching sentence in the agent-initialization skill's `reference/hooks.md`, and the compatibility paragraph in the design spec's Hook section.
