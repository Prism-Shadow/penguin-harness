---
title: Skills
description: Skills package reusable instructions as directories with a SKILL.md — metadata up front, body on demand, editable by the Agent itself.
---

## Anatomy of a Skill

A Skill is a directory containing a `SKILL.md`, optionally with a custom `icon.svg` and any other files the `SKILL.md` references (for example a `reference/` subtree it links to). The directory name is the authoritative skill name and must match `^[A-Za-z0-9_-]+$`; a `name` in the frontmatter is overridden by it.

Frontmatter fields:

| Field | Meaning |
| --- | --- |
| `name` | Skill name, matching the directory name |
| `description` | English one-liner injected into the system prompt |
| `short_description` / `short_description_zh` | UI labels for compact spots such as cards; not injected into the prompt |
| `preinstall` | Optional; `false` keeps the Skill out of default_agent's preinstalled set — install it manually from the library |
| `version` | Natural-number version, default 1 |
| `updated` | Update date |

```md
---
name: my-skill
description: One-line English description injected into the system prompt.
short_description: Short UI label.
short_description_zh: 简短的中文标签。
version: 1
updated: 2026-07-17
---

# My Skill

Concrete steps, boundaries and acceptance criteria...
```

Parsing is tolerant: only `key: value` scalar lines inside the first `---` block are recognized; a `version` that is not a natural number falls back to 1, and a missing `updated` defaults to empty. For `preinstall`, only the literal `false` is recognized.

## Progressive loading

Skills follow an "index first, body on demand" design: the system prompt injects only each installed Skill's metadata (name + description) through the `{{SKILL_METADATA}}` placeholder, and instructs the model to read the matching `SKILL.md` in full via the shell before following it. There is no dedicated skill tool — reading the body is just one `read_file` or shell call (see [Tools & Approval](/tools)).

Chat can also pin skills explicitly: the message then starts with a `[use_skills]` block listing the skill names (the earlier `<use_skills>` form is still recognized when re-rendering old Traces).

If a message only names a skill without a concrete task, the model is instructed to ask what is needed before starting.

## Installation and storage

Installed Skills live under `agent_state/skills/<name>/` inside the Agent State. The files are the source of truth: every read goes straight to disk with no cache, which makes Skills naturally editable.

- The built-in Agent `default_agent` gets the whole library installed at initialization, except Skills marked `preinstall: false` — those are only ever installed manually;
- other Agents install on demand — through the Web UI's Skill library page, or via the SDK;
- installing writes the library `SKILL.md` verbatim (frontmatter included) and copies any `icon.svg` and other files in the skill directory (subdirectories preserved) alongside it; each install replaces the whole directory, so reinstalling drops files a newer version no longer ships.

The library ships as the npm package `@prismshadow/penguin-skills`, carrying the raw `skills/` directory in the tarball; at runtime the package's `skills/<name>/SKILL.md` files are likewise the source of truth for library content.

## Built-in library

The built-in Skills, by group (the group manifest is `SKILL_GROUPS` in `packages/skills/src/index.ts`; the library directory is the source of truth as Skills are added):

| Group | Skill | Purpose |
| --- | --- | --- |
| Office Productivity | `data-analysis` | Complete data-analysis tasks with bounded evidence inspection, explicit answer-changing decisions, native artifact handling and final output verification |
| | `firecrawl` | Web search and page scraping into clean markdown via the Firecrawl API |
| | `bento-slides` | Author and edit Bento presentations: single-file `.bento.html` decks whose document is JSON, mapping material to charts, morph transitions and state slides |
| Software Development | `web-design` | Penguin visual language for generated web pages and app UIs: design tokens, components, light/dark themes and chat layouts |
| | `software-engineering` | Complete software-engineering tasks: investigate and review code, implement fixes, features and refactors with minimal scope, validate changes, and report verified outcomes |
| AI App Development | `penguin-sdk` | Build AI and RAG apps on the SDK: the createSession/run streaming loop plus a complete retrieval recipe with chunk-revealing citations |
| | `penguin-cli` | Manage model API keys, default models and per-agent Vault secrets with the penguin CLI |
| | `agenthub-models` | Call model APIs through `@prismshadow/agenthub`: streaming text, image generation, speech synthesis and embeddings |
| | `vllm` | Deploy and serve LLMs with vLLM behind an OpenAI-compatible endpoint, with tool calling enabled for agent workloads |
| | `ollama` | Deploy and serve local models with Ollama: pull and run them, then expose the OpenAI-compatible endpoint to apps and agents |
| | `llamafactory` | Fine-tune LLMs with LlamaFactory: register datasets, train via YAML configs, merge LoRA adapters and serve the result |
| | `skill-porting` | Port skills from external sources — plugin marketplaces, skills.sh registries, GitHub repos or local folders — into the agent after review and normalization |
| | `remote-claude-code` | Run Claude Code on a remote host over SSH — a persistent expect session, headless `-p` with the stdin fix, a tmux-driven interactive TUI and multi-turn continuity (not preinstalled: install from the library when needed) |
| Agent Tuning | `agent-creation` | Create or configure an Agent State from a user requirement by writing AGENTS.md, setting identity metadata and installing needed Skills |
| | `benchmark-design` | Design and calibrate a multi-Case capability Benchmark for a specified Agent and establish a traceable Formal Baseline |
| | `agent-evaluation` | Internal leaf worker that executes and privately scores exactly one Case run from a complete evaluation protocol |
| | `agent-optimization` | Improve a specified Agent from a complete current baseline on a frozen Benchmark |

## Writing and optimizing Skills

- Manual install: create a directory under `agent_state/skills/<name>/` and write a `SKILL.md`; the system scans `skills/` when assembling the system prompt and injects the metadata. A directory without a `SKILL.md` does not count as a Skill.
- Uninstalling deletes the whole `skills/<name>/` directory and is idempotent.
- An Agent can rewrite its own SKILL.md as part of a task — combined with Benchmark evaluation and optimization this closes the improvement loop, see [Self-Improvement](/self-improvement).
