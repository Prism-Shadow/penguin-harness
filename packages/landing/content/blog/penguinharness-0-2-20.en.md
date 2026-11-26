---
title: "PenguinHarness 0.2.20: Fix a broken workbench with AI, see every hand-over, and know why a plugin source failed"
date: 2026-11-26
category: news
excerpt: "A fix release on top of 0.2.19: workbenches load again in the desktop app, a failed workbench offers Fix with AI, a hand-over without a summary shows in the chat, and the plugin market says why a source failed."
---

PenguinHarness 0.2.20 is a fix release on top of 0.2.19. **Workbenches load again in the desktop app, and a workbench that fails to load now offers Fix with AI.** A compaction or model switch that produces no full summary shows the hand-over in the chat. The plugin market lists the published index again and says why a source failed.

## Fix a workbench that fails to load

**Wherever the Web App shows that a workbench's files did not load, it now offers Fix with AI and [Report] beside Reload.** They appear in the app's App Center window, in the App Center's **Show error** dialog and in the **More** menu of the workbench's row in **Agent settings**.

![A workbench that failed its type-check, in its App Center window: the error, Reload, Fix with AI and Report](/blog-assets/penguinharness-0-2-20-workbench-fix-en.png)

**Fix with AI** asks for confirmation first. It then opens a new chat for the default agent in a temporary Workspace, with the repair request in the composer, unsent. The request names the workbench, its agent and machine, its folder and the load error verbatim, and explains how a load works: `index.ts` is type-checked under options the host fixes; saving a file loads it again; and `.build/status.json` records the result. The agent says what it will change before changing anything. When the error comes from the platform itself, such as missing Node or TypeScript declarations, it says so, changes nothing and suggests a report instead.

![The confirm Fix with AI opens before it starts a chat](/blog-assets/penguinharness-0-2-20-workbench-confirm-en.png)

**[Report]** opens the shared problem report with the workbench and its masked load error.

## See the hand-over when there is no summary

**When a compaction completes without a full summary, the chat now shows what the next context opened with instead.** That is the hand-off note, or, for an in-session model switch, the Trace hand-over. It sits in the compaction row it follows, which settles to **Compacted**; the row's mark says why there was no summary.

![A real glm-5.3-flash turn, then a switch away from a model no longer configured: the Compacted row open at its Hand-off note, and the Model switched divider](/blog-assets/penguinharness-0-2-20-handover-en.png)

The row is folded by default. Its **Hand-off note** section gives the reason, the Trace file the note names, and the note itself. Long paths wrap inside it, and every line is selectable. A switch away from a model that can no longer be reached asks nothing of it, so its row reads "The previous model was unavailable, so no summary was requested". Before this release, a switch handed over by Trace showed only the divider and a hover hint.

## Know why a plugin source failed

**The published plugin index lists again, and the market says why a source could not be read.** The index had added an `npm` channel without a `url` to nineteen rows, and the server refused the whole document at the first one, so the market reported a source it had reached as unreachable. Now only the `github` channel, the one an install downloads from, must carry a `url`.

![The plugin market's notice unfolded: a source whose document was refused and a source whose host did not resolve, each with the server's reason](/blog-assets/penguinharness-0-2-20-market-sources-en.png)

**Details** after the market's notice lists each failed source by its address with the server's reason, as selectable text followed by **[Report]**. A refused document names the row and the field at fault; a failed fetch names the network error under `fetch failed`, for every address that was tried.

## Also in this release

- **Desktop**: Workbenches load again in the desktop app. 0.2.19's packed app lacked the `@types/node` declarations, and every workbench failed with `TS2688`.
- **Remote machines**: Connecting a machine no longer fails at the Sync config step while the machine's server is still starting; the Machines jobs wait up to a minute for it, and a refusal names the server's reason.
- **Plugins**: A failed plugin install names npm's own error, not a warning npm printed first such as `npm warn Unknown user config "always-auth"`.
- **Agents**: The default system prompt gains six refinements on verifying deliverables, narrowing failures cheaply and running long commands and services (kernel version `2026-11-26`).
- **Interface**: Tooltips wrap a long path inside the panel instead of running past its edge.

## Upgrading

- **Existing agents.** Run **Update kernel** on the **Agents** page to bring the refined default system prompt to agents whose prompt is still the built-in default.
- **Remote machines.** A remote machine must run the server's version. After updating the server, update each machine from the **Machines** page.
- **Hand-off notes in an open conversation.** A compaction that falls back to its hand-off note without a model switch shows the **Hand-off note** section after a reload. A model switch's hand-over shows at once.

Installers are available at [penguin.ooo/download](https://penguin.ooo/download). Full details are in [the 0.2.20 changelog](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.20).
