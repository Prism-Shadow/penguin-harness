# The docs site reorganized around tasks, with every page rewritten

- **Date:** 2026-09-16
- **Type:** process
- **Scope:** `docs`
- **PR:** [#758](https://github.com/Prism-Shadow/penguin-harness/pull/758)

[中文版](2026-09-16-docs-restructure.zh.md)

The documentation site was reorganized in the spirit of a help center, and every page was
rewritten in both languages: English first, then Chinese translated from it, with each draft
checked against the code and the Web App's UI strings. Every existing page slug still works.

## Details

- The sidebar has five sections. **Get Started**: introduction, quickstart (desktop, CLI, Docker,
  SDK), and the new Key concepts and Update pages. **Guides**: Web App, Conversations, Files panel,
  Scheduled tasks, Remote control, Agents, Skills, Models, Cost Center and Settings. **Advanced**:
  Evaluation Center, self-improvement, goal mode and company mode. **How It Works**: architecture,
  server boot, OmniMessage, the agent loop, message flow, core interfaces, tools and
  Sessions & Traces. **Reference**: CLI, Server API, configuration and security.
- The 63,000-character Web App guide was split: `web-app` became an overview, and conversations,
  the Files panel, scheduled tasks, agents, the Cost Center, the Evaluation Center, settings and
  updates each got a page of their own. Its plugin-library and model-configuration sections moved
  into `skills` and `models`, which moved from the design section into Guides.
- Three pages are new: `concepts` (a glossary grouped by topic), `remote-control` (binding a
  conversation to Feishu, Telegram, QQ or WeChat) and `updates`.
- Guide pages lead with tasks and numbered steps and keep implementation detail in a closing
  "How it works" section; reference pages give every command, route and key the same shape.
- Content that had drifted from the code was corrected, among it: the four stop reasons and error
  codes, compaction outcomes, the server boot sequence and HMR platform, the CLI running as a
  client of the server, the goal-image rule, the enforced and advisory parts of company mode, the
  Optimizer and Evaluator information barrier, and dozens of previously undocumented routes,
  options and settings.
- A source comment in `packages/core/src/state/agent-state.ts` cites the renamed skills-page heading.
