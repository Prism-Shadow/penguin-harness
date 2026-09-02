---
title: Skills & Plugins
description: Plugins package skills (SKILL.md directories, metadata up front, body on demand) and session hooks (scripts the loop consults) — installed into an Agent's state from one library, versioned by date.
---

## Plugins

The built-in library is a set of **plugins**. A plugin is a directory with a `plugin.json` manifest and the content it ships: **skills** — reusable instructions the model reads on demand — and/or a **hook package** — scripts the harness runs at the loop's hook points (see [The Agent Loop](/agent-loop#stop-hooks)). Installing a plugin puts its skills under `agent_state/skills/` and its hook package under `agent_state/hooks/`, two first-class parts of the Agent State that the rest of this page describes.

```text
plugins/<plugin>/
├── plugin.json                # manifest — the plugin's single metadata holder
├── icon.svg                   # the plugin's icon (every built-in plugin ships one)
├── skills/<name>/SKILL.md     # zero or more skills (reference/… alongside)
└── hooks/*.mjs                # at most one hook package: plain Node scripts
```

`plugin.json`:

| Field | Meaning |
| --- | --- |
| `description` / `description_zh` | One-line description (English required for a hook-only plugin; a skill plugin falls back to its first skill's) |
| `short_description` / `short_description_zh` | Card labels (fall back to the first skill's) |
| `version` | `YYYY-MM-DD.N` — the date plus a sequence number for that day |
| `category` | One of `office-productivity`, `software-development`, `ai-app-development`, `agent-tuning`, `session-hooks`; missing or unknown lands in "Other" |
| `preinstall` | Optional; `false` keeps the plugin out of `default_agent`'s preinstalled set — install it manually from the library |
| `hooks.stop` / `hooks.pre_tool_use` / `hooks.user_prompt` | The hook package's commands per [hook point](/agent-loop#stop-hooks): `[{ "command": "stop.mjs", "timeout": 60 }]`, paths relative to `hooks/`, timeout in seconds |

The plugin name is its directory name (`^[A-Za-z0-9_-]+$`). Versions are compared by date, then by sequence number, so `2026-08-29.10` follows `2026-08-29.9`; the manifest's version is the version of everything the plugin ships. There is no other version scheme.

Every plugin is its own npm package — `@penguinharness/<name>`, `plugins/<name>/` in the repo. The loader lives in `@prismshadow/penguin-core`, which depends on the plugin packages and resolves their directories (the desktop build bundles the same directories beside it instead). At runtime the plugin files are the source of truth for library content, read on every call.

## Anatomy of a Skill

A Skill is a directory containing a `SKILL.md` and any other files the `SKILL.md` references (for example a `reference/` subtree it links to). Skills carry no icon of their own — the icon belongs to the plugin (`icon.svg` beside `plugin.json`); an installed skill shown on its own falls back to a default book glyph. The directory name is the authoritative skill name and must match `^[A-Za-z0-9_-]+$`; a `name` in the frontmatter is overridden by it.

A library `SKILL.md`'s frontmatter carries only two fields — everything else lives in `plugin.json`:

| Field | Meaning |
| --- | --- |
| `name` | Skill name, matching the directory name |
| `description` | English one-liner injected into the system prompt |

```md
---
name: my-skill
description: One-line English description injected into the system prompt.
---

# My Skill

Concrete steps, boundaries and acceptance criteria...
```

The **installed** copy is self-describing: at load time the library regenerates each skill's frontmatter with the plugin's `short_description`, `short_description_zh` and `version` stamped in (the way an installed hook package's `hooks.json` is generated from the manifest), and that is what gets written into `agent_state/skills/`. Update checks read the installed frontmatter's `version`; the UI reads its short descriptions. Parsing is tolerant: only `key: value` scalar lines inside the first `---` block are recognized, and a `version` that is not `YYYY-MM-DD.N` reads as empty — older than any library version, so the library's copy counts as an update.

## Progressive loading

Skills follow an "index first, body on demand" design: the system prompt injects only each installed Skill's metadata (name + description) through the `{{SKILL_METADATA}}` placeholder, and instructs the model to read the matching `SKILL.md` in full via the shell before following it. There is no dedicated skill tool — reading the body is just one `read_file` or shell call (see [Tools & Approval](/tools)).

Chat can also pin skills explicitly: the message then starts with a `[use_skills]` block listing the skill names (the earlier `<use_skills>` form is still recognized when re-rendering old Traces).

If a message only names a skill without a concrete task, the model is instructed to ask what is needed before starting.

## Hook packages

A hook package is the plugin's `hooks/` directory installed as `agent_state/hooks/<plugin>/`, with a generated `hooks.json` beside the scripts — the manifest's identity fields (`name`, `description`, `description_zh`, `version`) plus the commands per hook point:

```json
{
  "name": "goal",
  "description": "Goal mode: …",
  "version": "2026-08-29.1",
  "stop": [{ "command": "stop.mjs", "timeout": 60 }]
}
```

Installed is active: every top-level Session of the Agent consults its installed hook packages at the loop's hook points. The scripts are plain Node with builtins only — they run wherever the harness runs, as subprocesses with JSON on stdin and a JSON answer on stdout; the contract is on [The Agent Loop](/agent-loop#stop-hooks). A hook package's other scripts are the host's to call by convention: the goal plugin's `start.mjs` is what the server runs when a user starts a goal ([Goal Mode](/goal-mode)).

## Installation and storage

Installed Skills live under `agent_state/skills/<name>/`, hook packages under `agent_state/hooks/<name>/`. The files are the source of truth: every read goes straight to disk with no cache, which makes Skills naturally editable.

- The built-in Agent `default_agent` gets the whole library installed at initialization, except plugins marked `preinstall: false` — those are only ever installed manually;
- other Agents install on demand — through the Web UI's plugin library page, or via the SDK;
- installing a skill writes its installable `SKILL.md` (the frontmatter regenerated with the plugin's metadata, see above) and copies any other files in the skill directory (subdirectories preserved) alongside it (a user-authored or imported skill may include its own `icon.svg`, which is copied too); installing a hook package writes `hooks.json` and every file under the plugin's `hooks/`. Each install replaces the whole directory, so reinstalling drops files a newer version no longer ships — reinstalling is how an installed copy is updated, and the Agents page flags a plugin whose installed skill or hook package is behind the library.

## Built-in library

The built-in plugins, by category (`PLUGIN_CATEGORIES` in `packages/plugins/src/index.ts`; the library directory is the source of truth as plugins are added):

| Category | Plugin | Purpose |
| --- | --- | --- |
| Office Productivity | `data-analysis` | Complete data-analysis tasks with bounded evidence inspection, explicit answer-changing decisions, native artifact handling and final output verification |
| | `firecrawl` | Web search and page scraping into clean markdown via the Firecrawl API |
| | `bento-slides` | Author and edit Bento presentations: single-file `.bento.html` decks whose document is JSON, mapping material to charts, morph transitions and state slides |
| | `humanizer` | Strip AI-writing tells from prose in any language and rewrite it into the register of books, newspapers and encyclopedias (not preinstalled: install from the library when needed) |
| Software Development | `software-development` | Software development end to end — two skills: `software-engineering` (investigate, implement and validate with minimal scope) and `web-design` (the Penguin visual language for generated web UIs) |
| | `remote-claude-code` | Run Claude Code on a remote host over SSH — a persistent expect session, headless `-p` with the stdin fix, a tmux-driven interactive TUI and multi-turn continuity (not preinstalled: install from the library when needed) |
| AI App Development | `agent-development` | Agent development on PenguinHarness — four skills: `penguin-sdk` (build agent/AI/RAG apps on the SDK), `unified-llm-api` (call model APIs through `@prismshadow/agenthub`), `penguin-config` (manage model keys, defaults and Vault secrets) and `penguin-orchestration` (drive agents, sessions, costs and schedules from a shell) |
| | `model-development` | Model development on your own hardware — three skills: `llamafactory` (fine-tune), `ollama` (run local models) and `vllm` (serve behind an OpenAI-compatible endpoint) |
| | `skill-porting` | Port skills from external sources — plugin marketplaces, skills.sh registries, GitHub repos or local folders — into the agent after review and normalization |
| Agent Tuning | `agent-tuning` | The tuning loop as four skills: `agent-initialization` (set an agent up from a requirement), `benchmark-design` (design and calibrate a capability Benchmark), `agent-evaluation` (execute and score one isolated Case) and `agent-optimization` (improve the agent from measured results) |
| Session Hooks | `goal` | The stop hook behind [goal mode](/goal-mode): keeps the session working toward an objective until it is complete, blocked, or out of token budget (preinstalled) |
| | `skill-summary` | When a task ends after more than 30 turns, hands its condensed excerpt to a background subagent that folds the durable findings into the agent's skills (not preinstalled) |

## Writing and optimizing Skills

- Manual install: create a directory under `agent_state/skills/<name>/` and write a `SKILL.md`; the system scans `skills/` when assembling the system prompt and injects the metadata. A directory without a `SKILL.md` does not count as a Skill.
- Uninstalling deletes the whole `skills/<name>/` (or `hooks/<name>/`) directory and is idempotent.
- An Agent can rewrite its own SKILL.md as part of a task — combined with Benchmark evaluation and optimization this closes the improvement loop, see [Self-Improvement](/self-improvement). Bump `version` to today's date with the next sequence number when you do.
- Long tasks can feed back on their own: with the `skill-summary` plugin installed, a task that ends after more than 30 turns has its stop hook hand a condensed excerpt of that task to a background subagent, which folds the durable findings into the relevant SKILL.md files — see [The Agent Loop](/agent-loop#stop-hooks).
