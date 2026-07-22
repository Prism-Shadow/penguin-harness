# Version 0.2.0

Unreleased.

- [2026-07-22] Models and core: empty tool lists are omitted from LLM requests (fixing 400s from strict OpenAI-compatible servers), the default system prompt gains service-protection and API-key retry guardrails with the default port as a core SDK constant, a per-model max output tokens cap lands on the Models page, the thinking level moves to a conversation-time picker (low and above) that writes through to Agent settings, subagents inherit the parent session's model and thinking level, sessions record their origin in `session_meta.source` as the single source of truth, the SDK moves to AgentHub 0.4.1 and its supported-model registry drives a catalog refresh across every provider group (with the READMEs trimmed to the newest generation per vendor), and session-title generation folds into core's internal module. ([details](2026-07-22-models-and-core.md))

- [2026-07-22] Web App: the chat sidebar groups conversations by Workspace (with an Agent-mode toggle, group pinning, subagent/scheduled folders and paged loading), the collapsed sidebar becomes an eight-entry navigation rail with bilingual tooltips, the model picker lists key-configured models first, chat renders links in a new tab with clean CJK/URL wrapping and the subagent expansion below the tool's own output, mobile dropdowns stay inside the viewport, the Cost center's daily-token tooltip follows the pointer and shows the cache hit rate, the model and Agent settings forms were tightened, the copied task-stats line is localized, and custom model groups and Agents get initial-letter avatars. ([details](2026-07-22-web-app.md))

- [2026-07-22] Skills: vLLM and Ollama deployment plus LlamaFactory fine-tuning join the AI App Development group with a guided serving workflow that follows the user's engine preference, and `agenthub-models` tracks the AgentHub 0.4.1 API. ([details](2026-07-22-skills.md))

- [2026-07-22] Sites: the docs and landing navbars are now identical, the blog gains a Tech-practice category, pinned posts, author/date/copy-link metadata and a second AMD practice post, and the built-in Skills are listed in the READMEs and on the landing page. ([details](2026-07-22-sites-and-blog.md))

- [2026-07-22] Docs and examples: two new README roadmap items, and the self-improvement example reworked to genuinely evolve itself. ([details](2026-07-22-docs-and-examples.md))

- [2026-07-22] Tooling: server query-parameter validation hardening, and unit tests for two previously uncovered core modules. ([details](2026-07-22-tooling.md))
