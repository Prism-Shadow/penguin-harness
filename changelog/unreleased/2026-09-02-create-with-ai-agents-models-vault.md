# "Create with AI" on the Agents page, the Models page and the Vault tab

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#591](https://github.com/Prism-Shadow/penguin-harness/pull/591)

[中文版](2026-09-02-create-with-ai-agents-models-vault.zh.md)

Three surfaces gained the AI path the [shared kit](2026-09-02-create-with-ai-kit.md) provides: an agent, a model group and a vault secret can now be described to the Project's default agent instead of filled into a form. Each surface ships its own clickable examples and a fixed instruction tail naming the skill the agent must use, so a novice's one-liner becomes a task the agent can finish.

## Details

- The Agents page's **Create agent** button became the split control, and its dialog opens on a **Set up manually / Create with AI** switch that keeps the draft across the two sides, remembers the last choice for the session, and starts on the AI path while the Project has no agent beyond `default_agent` — the list's call to action in that state offers the same path. The AI side carries five examples (a jotting agent, a financial Copilot, a document RAG agent, a deep-research report agent, and the report-writing agent with the id `report-writer` that the onboarding chain starts from) and a tail that has the agent run the `agent-initialization` skill: a new agent under the current Project, its AGENTS.md and name/description written, only the skills it needs copied from the plugin library, no other agent touched, the id and how to start a conversation reported at the end. The manual form is unchanged.
- The Models page's header gained **Add models with AI** (owner only) beside **Sync presets**: a listing page URL or a description of the service goes to the default agent with a tail that has it use the `penguin-config` skill — one `penguin config model add --provider … --model-id … --project-id … --root …` per model, `--client-type openai --base-url …` for OpenAI-compatible endpoints, a web page fetched first with the named (else the most popular, about ten) models picked, a missing API key asked for once or left empty for the Models page, the config file never touched, `penguin config model list` at the end. The dialog's lead says when the existing **Add group → Import models** path is the faster one.
- The Vault tab gained a wand beside **Add** (owner only) whose dialog warns that a value typed into the prompt reaches the model provider, the conversation's Trace and the agent's own command line, and suggests asking for key names only; its tail names the target agent, the Project and the data root on every `penguin config vault set`, forbids echoing values or reading `.vault.toml`, and ends with `penguin config vault list`.
- The Web App and Models docs describe the three entries in both languages.
