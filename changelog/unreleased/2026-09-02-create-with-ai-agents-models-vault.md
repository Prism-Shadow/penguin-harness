# "Create with AI" on the Agents page, the Models page and the Vault tab

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#591](https://github.com/Prism-Shadow/penguin-harness/pull/591)

[中文版](2026-09-02-create-with-ai-agents-models-vault.zh.md)

Three surfaces gained the AI path the [shared kit](2026-09-02-create-with-ai-kit.md) provides: an agent, a model group and a vault secret can now be described to the Project's default agent instead of filled into a form. Each surface offers the two buttons side by side — **Create with AI** and **Create manually** — ships its own clickable examples, and carries a fixed instruction tail naming the skill the agent must use, so a novice's one-liner becomes a task the agent can finish. Nothing is sent from these dialogs: the prompt lands in a new conversation's composer for the user to read and send.

## Details

- The Agents page's header and its empty state both offer the pair of buttons, and the create dialog opens on the path the button named and stays there — there is no mode switch, and the draft resets on every open. The AI side carries five examples (a jotting agent, a financial Copilot, a document RAG agent, a deep-research report agent, and the report-writing agent with the id `report-writer` that the onboarding chain starts from) and a tail that has the agent run the `agent-initialization` skill: a new agent under the current Project, its AGENTS.md and name/description written, only the skills it needs copied from the plugin library, no other agent touched, the id and how to start a conversation reported at the end. The manual form is unchanged, and the sidebar's mode-dependent "new agent" button — which names no path — still opens it.
- The Models page's header gained the pair (owner only) beside **Sync presets**: the AI button takes a listing page URL or a description of the service to the default agent with a tail that has it use the `penguin-config` skill — one `penguin config model add --provider … --model-id … --project-id … --root …` per model, `--client-type openai --base-url …` for OpenAI-compatible endpoints, a web page fetched first with the named (else the most popular, about ten) models picked, a missing API key asked for once or left empty for the Models page, the config file never touched, `penguin config model list` at the end. The manual button opens the existing **Add group** dialog, and the AI dialog's lead says when that dialog's **Import models** path is the faster one.
- The Vault tab gained the pair (owner only) whose AI dialog warns that a value typed into the prompt reaches the model provider, the conversation's Trace and the agent's own command line. The rest of the surface follows that warning: the examples lead with creating the key names an agent's skills need and filling the values in by hand afterwards, and none of them pastes a secret into the prompt. Its tail names the target agent, the Project and the data root on every `penguin config vault set`, forbids echoing values or reading `.vault.toml`, and ends with `penguin config vault list`.
- The Web App and Models docs describe the three entries in both languages.
