---
title: "Keeping a Vibe Coding Project Maintainable as It Grows"
date: 2026-10-19
category: perspectives
excerpt: "Once a project has enough modules, changing one button or log line can break something else. Using icon reuse, command approval, and Trace tests from PenguinHarness, we look at how to keep AI-assisted code maintainable."
---

> Written for PenguinHarness 0.2.18. Later releases may differ in some details.

Adding the first feature in a vibe coding project usually goes smoothly. Once you have more modules, changing a modal button or tweaking a log format brings more hesitation, because a small edit can easily break an existing feature somewhere else.

The developer Hanbao wrote about a similar experience on his blog[^1]. He abandoned an early AI blog project because features kept breaking each other and became too hard to maintain, then switched to clarifying requirements up front, recording constraints, and narrowing the scope of each stage.

Reminding the AI in the chat window solves plenty of immediate problems, while long-term maintenance depends on clear change scopes, permission boundaries in code, and tests that catch specific bugs. We will look at a few places in PenguinHarness 0.2.18 to see how these practices work together.

## Scope the Change Before Writing Code

Ad-hoc reminders in a chat window easily lose context, so before changing code, write down a few lines stating what this change covers. The note only needs four things: the goal for this pass, what is out of scope, how to verify the result, and existing implementations to reuse. When you are adding an icon or adjusting log behavior, aligning on those few sentences is enough without writing a long specification every time.

When writing the task description, ask the agent to search the repository for existing components or helper functions first. Often the repository already has a module for the job, and if the agent does not search first, it will write a second copy in the current directory.

Say you spot two nearly identical icons in the UI and want the agent to inspect and consolidate them; you can send it a prompt like this:

> Task: Find and consolidate duplicate icons in the UI.
> 1. Search the repository for existing icon components and SVG definitions, list their file paths, and do not change any code yet.
> 2. Explain which shared implementation you plan to keep and which importing files you will update, without changing icon styles or unrelated components in this pass.
> 3. Provide the test command to run after the change, and commit only after confirming it passes.

## Store Rules by Module

Scoping a single task helps for one change, and if you pile every long-term convention across tasks into one file, that file quickly gets long and messy too. A steadier approach is to keep only a small set of everyday conventions and links to detailed docs in the root `AGENTS.md` or `CLAUDE.md`. Module-specific details live alongside the module directory, and stage progress goes into the task record for that pass.

Day-to-day development conventions for PenguinHarness live in `.agents/skills/penguin-harness-dev/SKILL.md`. That file requires using an isolated worktree, running targeted verification for the change, and merging through a PR. In his vibe coding guide, Yan Ligang likewise notes that global instructions should hold only cross-task constraints, with details read on demand and rules that can be checked with a clear pass or fail turned into lint rules or tests[^2].

Having a rules file in the repository does not mean every agent loads it automatically on startup. Before starting work, you can ask the agent to list which convention files it read for this pass to confirm it actually saw them. For rules that a program can check directly, you can put them into shared code and automated tests alongside the documentation.

## Shared Icons and Source-Scan Tests

A comment in `icon-scale.test.ts` in PenguinHarness records a concrete problem[^3]. The `memory brain` icon was once hand-coded in three places, and after one copy was redrawn, the other two kept the old art.

If the documentation only says "please reuse icons", someone rushing a change can still copy and paste SVG code again. Today the `memory brain` icon lives in the shared `icons.ts`, and several other known icons each stay in their designated shared files. `icon-scale.test.ts` scans the `web` and `ui` source files. If any of those known SVG path fragments appears outside its designated shared file, the test fails.

<figure class="post-figure" data-figure="vibe-rules-icon-check"> <svg class="fig-svg" style="min-width:0" viewBox="0 0 560 332" role="img" aria-labelledby="rules-for-vibe-coding-vibe-rules-icon-check-en-title"> <title id="rules-for-vibe-coding-vibe-rules-icon-check-en-title">A three-step vertical flow showing the task checking existing icons, icons living in shared files, and the test scanning source files for stray paths.</title> <defs><marker id="rules-for-vibe-coding-vibe-rules-icon-check-en-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10Z" class="fig-arrowhead"/></marker></defs> <rect x="40" y="12" width="480" height="76" rx="6" class="fig-box"/> <text x="280" y="42" text-anchor="middle" class="fig-label" style="font-size:22px">Task checks existing icons</text> <text x="280" y="67" text-anchor="middle" class="fig-note" style="font-size:18px">Search the repo for icons before editing</text> <path d="M280 89V124" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-icon-check-en-arrow)"/> <rect x="40" y="128" width="480" height="76" rx="6" class="fig-box"/> <text x="280" y="158" text-anchor="middle" class="fig-label" style="font-size:22px">Icons live in shared files</text> <text x="280" y="183" text-anchor="middle" class="fig-note" style="font-size:18px">Known SVG paths stay in designated files</text> <path d="M280 205V240" class="fig-edge" marker-end="url(#rules-for-vibe-coding-vibe-rules-icon-check-en-arrow)"/> <rect x="40" y="244" width="480" height="76" rx="6" class="fig-box"/> <text x="280" y="274" text-anchor="middle" class="fig-label" style="font-size:22px">Test scans source for stray paths</text> <text x="280" y="299" text-anchor="middle" class="fig-note" style="font-size:18px">Fail if found outside designated files</text> </svg> <ol class="fig-steps"> <li>Task checks existing icons</li> <li>Search the repo for icons before editing</li> <li>Icons live in shared files</li> <li>Known SVG paths stay in designated files</li> <li>Test scans source for stray paths</li> <li>Fail if found outside designated files</li> </ol> <figcaption>Guide the agent to look for a shared implementation first, then use a source-scan test to check whether known icon paths appear outside their designated shared files.</figcaption> </figure>

This scan test only recognizes a few known SVG path fragments and cannot spot every visually similar new icon. Extracting shared code like this is only worth it when an element is actually reused in multiple places; logic used in a single spot does not need an elaborate structure built ahead of time. In an article on harness engineering, Cui Pengfei distinguishes programmatic checks with unambiguous results from judgment-based model reviews and recommends using programmatic checks first for anything a program can decide unambiguously[^4]. High-risk boundaries like tool execution permissions need code outside the model enforcing them directly.

## Put Tool Permissions in Code

Prompts cannot control actual tool calls at runtime, so permission boundaries belong in code. In PenguinHarness 0.2.18, each call to `Session.run` can pass an `approve` callback[^5]. If a preceding `preToolUse` hook returns no explicit decision and the caller did not provide an `approve` callback, the engine falls back to the default `deny` callback and refuses execution.

`Session.run` also wraps the caller's `approve` callback with `withCommandPolicy`[^6]. When an agent requests command execution and hits a deny rule in the policy, `command-policy.ts` returns `forbidden` directly without calling the host's `approve` callback. Even if a `preToolUse` hook allowed the call, a command that matches a deny rule is still blocked.

This command policy only matches the shell text arguments of `exec_command` and `input_command` against enabled patterns[^7]. It does not expand variables or encoded content before evaluating, and it does not cover other tools such as MCP. When a change touches permission policies, persistence formats, or public interfaces, a green test suite is no reason to skip human review; a person still needs to read the diff and judge whether the boundaries make sense.

## Check What the Tests Actually Verify

After reading the diff by hand, you also need to confirm that the accompanying automated tests can actually catch bugs. Yan Ligang warns in his article that tests written on the fly by an AI can easily copy buggy assumptions from the implementation straight into the assertions. For a test to do real work, its expected values need to come from clear requirements, a protocol spec, or verified fixtures rather than mirroring the implementation logic.

The Trace module in PenguinHarness records session activity to disk[^8]. `writer.ts` uses an append-only JSONL format and serializes writes and file rotations through a queue so concurrent appends do not split a single record.

The corresponding `trace.test.ts` reads the on-disk files directly to verify that concurrent appends of small and large records and file rotations never split a single record[^9]. It also checks edge cases including short writes, zero-progress failures, and recovery from truncated trailing lines.

Another test file, `trace-bytes.test.ts`, builds each stored record type with fixed timestamps and compares the output byte for byte against `fixtures/trace-bytes.jsonl` in the repository[^10]. It also checks that reading those records back and writing them out again produces identical bytes. Because that fixture file was generated by the pre-migration implementation to catch unintended changes to the historical byte format, it is not an implementation-independent proof of correctness on its own. When a byte-comparison test like this fails, inspect the diff by hand against the format specification rather than blindly updating the snapshot to make the test pass. After the agent finishes adding a test, you can also break one line of the implementation on purpose, watch the test turn red, and then revert the break.

## Debugging Recurring Mistakes

Even after you verify a test this way, the agent can still make a familiar mistake in a later task, so hold off on stuffing another rule into the global `AGENTS.md`.

Check first whether the current session loaded the relevant rules file, whether the wording is too vague, or whether the existing shared implementation is buried somewhere hard to find. If the rule itself looks fine, check whether an automated test is missing or an older rule has gone stale. Once you find the cause, add only the smallest convention, shared module, or automated check that fits, and delete any stale or duplicate lines while you are there.

Right now, pick a duplicate icon scattered across a few pages in your own project and send the task prompt from the first section to your agent. Have it find the existing implementations, consolidate them into one shared file, and add a test that catches hand-copied duplicates.

[^1]: [如何从0到1 Vibe Coding 一个项目，并长期维护](https://blog.hejiajun.com/archives/wei-ming-ming-wen-zhang-jKzuXGz7)
[^2]: [Vibe Coding 指南：踩过的坑和给 AI 的自查清单](https://ligangyan.com/zh/blog/vibe-coding-guide/)
[^3]: [packages/web/test/icon-scale.test.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/web/test/icon-scale.test.ts)
[^4]: [Harness Engineering：把纪律搬到模型外面](https://cuipengfei.is-a.dev/blog/2026/05/05/harness-engineering-craftsmanship/)
[^5]: [packages/core/src/engine/context-engine.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/core/src/engine/context-engine.ts)
[^6]: [packages/core/src/session.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/core/src/session.ts)
[^7]: [packages/core/src/internal/command-policy.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/core/src/internal/command-policy.ts)
[^8]: [packages/core/src/trace/writer.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/core/src/trace/writer.ts)
[^9]: [packages/core/test/trace.test.ts](https://github.com/Prism-Shadow/penguin-harness/blob/v0.2.18/packages/core/test/trace.test.ts)
[^10]: [refactor(amsp): protocol types move into @prismshadow/amsp (#1300)](https://github.com/Prism-Shadow/penguin-harness/commit/b576cd8618922633ba7fc6b56cdf85ae1ddf6b20)
