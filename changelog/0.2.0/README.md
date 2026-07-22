# Version 0.2.0

Unreleased.

- [2026-07-22] Empty tool lists are omitted from LLM requests, fixing 400s from strict OpenAI-compatible servers (vLLM) on connectivity tests, title generation and vision description. ([details](2026-07-22-llm-requests.md))

- [2026-07-22] The default system prompt gains two guardrails — never kill the harness's reserved service ports, and stop after one retry on API auth/key errors — with the reserved ports now a core SDK constant. ([details](2026-07-22-agent-guardrails.md))

- [2026-07-22] Model runtime settings: a per-model max output tokens cap on the Models page (fixes over-asking small-context models), the thinking level moved to a conversation-time picker that writes through to Agent settings, and session-title generation folded into core's internal module. ([details](2026-07-22-model-settings.md))

- [2026-07-22] Web App: the chat sidebar groups conversations by Workspace (with an Agent-mode toggle), the model picker lists key-configured models first, chat messages open links in a new tab with clean wrapping for long URLs, CJK text and wide tables, and custom model groups and Agents get initial-letter avatars. ([details](2026-07-22-web-app.md))

- [2026-07-22] Skills: vLLM and Ollama deployment plus LLaMA-Factory fine-tuning join the AI App Development group, with a guided serving workflow and hard root-separation guardrails. ([details](2026-07-22-skills.md))

- [2026-07-22] Sites: the docs and landing navbars are now identical, the blog gains grouped listings, pinned posts and author/date/copy-link metadata, and the AI App Development skills are highlighted on the landing page and READMEs. ([details](2026-07-22-sites-and-blog.md))
