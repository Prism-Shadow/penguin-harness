---
title: Skills & Plugins
description: Browse plugins, install Skills and hook packages on an agent, add server plugins to a Project, use Skills in a chat, and write your own.
---

A **Skill** is a set of reusable instructions that an agent reads when a task calls for it. A **hook package** is a set of scripts that the harness runs at fixed points of the agent loop. A **plugin** bundles Skills, a hook package, or both. The built-in plugins make up the plugin library, which the Web App's **Plugins** page lists together with [server plugins](#server-plugins), plugins that extend the server rather than an agent.

- **Looking for new abilities?** See [Browse plugins](#browse-plugins) and [Install a plugin on an agent](#install-a-plugin-on-an-agent).
- **An update is waiting?** See [Update installed plugins](#update-installed-plugins).
- **Want the agent to use a specific Skill?** See [Use a Skill in a chat](#use-a-skill-in-a-chat).
- **Managing one agent's Skills and hooks?** See [Manage an agent's Skills](#manage-an-agents-skills) and [Hook packages](#hook-packages).
- **Adding a sandbox backend or another server plugin?** See [Server plugins](#server-plugins).
- **Writing your own Skill?** See [Write a Skill](#write-a-skill).
- **Looking for file formats and internals?** See [How it works](#how-it-works).

## Browse plugins

1. In the sidebar, select **Plugins**.
2. Browse the lists. **Installed plugins** comes first and starts folded; select its header to unfold it. It holds the plugin library, followed by the server plugins the current Project asks for. **Available** lists the server plugins the Project can still add.
3. To narrow the lists, type in the search box, or pick options in the filter column beside them: **Categories**, **Contains** and **Status**. **Clear filters** clears the picks and the search box. Both lists unfold while a search or filter is active.
4. Select a library plugin's card to open its details.

Each card shows the plugin's name, a short description, and a line in the form `v<version> · updated N days ago · used by N agents`. The agent count covers the agents in the current Project that have any part of the plugin installed. The tags below that line give the plugin's category (Office Productivity, Software Development, AI App Development, Agent Company or Other), **built in**, and how many Skills and hook packages it ships.

The details show the full description, the hook points the plugin's hook package runs at, and a file browser. The tree on the left has one folder per Skill, with its `SKILL.md` first and its reference files after it, and a **Hooks** folder for the hook scripts. The preview on the right shows the selected file.

The buttons on the right of a card:

| Button | When it appears | What it does |
| --- | --- | --- |
| **Manage installs** | Always | Installs the plugin on an agent, or uninstalls it. |
| **Quick start** | The plugin ships at least one Skill | Opens a new chat draft that uses the Skill. It is available only when the current agent has one of the plugin's Skills installed. |
| Update | An agent's install is behind the library | Updates those installs. See [Update installed plugins](#update-installed-plugins). |

## Install a plugin on an agent

1. On the **Plugins** page, select **Manage installs** on the plugin's card. The dialog lists every agent in the current Project.
2. Next to the agent, select **Install**.

The whole plugin is installed: all of its Skills and its hook package. New conversations pick it up right away; running ones pick it up after their next compaction.

To uninstall a plugin, point at **Installed** next to the agent, select **Uninstall**, and confirm. Uninstalling deletes the installed Skill and hook files, including any local edits.

Any Project member can install, update and uninstall plugins.

Other ways to install:

- When you create an agent, pick plugins in the **Plugins** field of the **Create agent** dialog. See [Agents](/agents).
- The built-in agent `default_agent` gets the whole library when it is initialized, except plugins marked `preinstall: false`. The [Built-in library](#built-in-library) table notes which plugins are not preinstalled.
- To install a Skill or hook package from outside the library, import it on the agent's settings page. See [Import a Skill](#import-a-skill) and [Import a hook package](#import-a-hook-package).

## Update installed plugins

New versions of the built-in plugins arrive with PenguinHarness updates. An agent keeps its installed copy until you update it. When an install is behind the library, you see:

- a red dot on **Plugins** in the sidebar;
- a notice at the top of the **Plugins** page, "Changes detected: N to upgrade", with **Update now** and **Dismiss**;
- an update button on the plugin's card, and an **Update** button next to the agent in **Manage installs**.

To update:

1. Choose what to update:
   - To update every outdated plugin, select **Update now** in the notice.
   - To update one plugin on every agent, select the update button on its card.
   - To update one plugin on one agent, select **Update** next to the agent in **Manage installs**.
2. Review what the update will touch, then select **Update**.

> [!WARNING]
> Updating reinstalls the library copy over each agent's installed Skill and hook files. Any local edits are lost, so export a backup first if you need them. See [Manage an agent's Skills](#manage-an-agents-skills).

**Dismiss** hides the notice and the sidebar dot until the library version changes again. The update buttons on the cards stay.

## Use a Skill in a chat

An agent sees the name and description of every installed Skill, and reads a Skill's full instructions when a task calls for it. To make sure it uses a particular Skill:

1. In the message box, select **Skills**, then select one or more Skills. You can also type `/` followed by the Skill's name to select it.
2. Type your task and send the message.

The selected Skills appear as chips above the text, and the sent message shows "Using skill: *name*". If you send the Skills without any text, the message becomes "use the *name* skill". When a message names a Skill but gives no task, the agent asks what you need before it starts.

The **Skills** menu lists only the Skills installed on the current agent, and it is unavailable while a Task is running.

**Quick start** on a plugin's card does the same in one step: it opens a new chat draft with the Skill selected and "use the *name* skill" filled in, without sending it.

## Manage an agent's Skills

To see the Skills installed on one agent, open **Agents**, select the agent, and open the **Skills** tab.

- Each row shows a Skill's name, short description and version, with two actions: **Export** downloads the Skill as a zip file, and **Uninstall** deletes its directory.
- **Enable skills** controls whether the agent's system prompt lists the installed Skills. With it off, the agent is not told which Skills exist, but Skills you select in a chat still work.
- **Skills prompt** is the text that introduces the Skill list in the system prompt. Its `{{SKILL_METADATA}}` placeholder becomes one line per installed Skill.

The Skills tab has no update action and cannot add plugins from the library. Update and install plugins on the **Plugins** page.

### Import a Skill

You can import a Skill from outside the library in two ways. The first is recommended, because the agent reads and reviews the Skill before installing it.

To import it through a chat:

1. On the **Skills** tab, select **Import skill**.
2. In **Skill source**, enter a web page, a GitHub repository or directory, a local path, or an install command from another ecosystem, such as `npx skills add <name>`.
3. Select **Open a new chat**. A new chat opens with the prompt filled in. You can also select **Copy prompt** to use the prompt elsewhere.
4. Send the message. The agent reads the source in full, checks that it is safe, and installs the Skill. If the `skill-porting` Skill is installed, the agent follows its process.

To upload a zip file:

1. On the **Skills** tab, select **Import skill**.
2. Under **Upload a skill zip**, select **Choose zip file**. The zip must hold `SKILL.md` at its root, or exactly one top-level directory that contains `SKILL.md`.
3. If a Skill with the same name is already installed, confirm with **Overwrite**. Overwriting replaces all of its files.

A zip file can be up to 14 MB, with at most 200 files, 5 MB per file and 20 MB in total after unpacking.

## Hook packages

A hook package runs scripts at the agent loop's [hook points](/agent-loop#stop-hooks): when you send a message, before a tool call, and when a Task ends. For example, the `goal` plugin's hook package drives [goal mode](/goal-mode). Hook packages usually come with a plugin from the library.

To manage one agent's hook packages, open **Agents**, select the agent, and open the **Hooks** tab.

- **Enable hooks** turns hooks on or off for the whole agent, not one package at a time. With it on, every Session the agent starts runs all installed hook packages. With it off, new Sessions run no hooks, and the packages stay installed. The change takes effect from the next turn; a Task that is already running keeps the setting it started with. Only the Project owner can change this switch.
- Each row shows a package's name, the hook points it runs at, its description and version, with **Export** and **Uninstall**.

### Import a hook package

To import it through a chat:

1. On the **Hooks** tab, select **Import hook**.
2. In **Hook source**, enter a URL, a GitHub repository, a local path, a description of the hook you want, or another tool's hook configuration, such as the `hooks` block of a Claude Code `settings.json`.
3. Select **Open a new chat**, or **Copy prompt**.
4. Send the message. The agent reads the source, reviews every script, and installs the package on this agent.

To upload a zip file:

1. On the **Hooks** tab, select **Import hook**.
2. Under **Upload a hook package zip**, select **Choose zip file**. The zip must hold `hooks.json` and the scripts at its root, or in exactly one top-level directory. Every command in `hooks.json` must name a file inside the zip.
3. If a package with the same name is already installed, confirm with **Overwrite**.

> [!WARNING]
> An imported hook package takes effect at once. While the agent has hooks on, its scripts run on this machine at every hook point, so import only packages you trust.

## Server plugins

A server plugin extends the server itself rather than an agent: it is an npm package of server modules, such as a sandbox backend. A Project asks for the server plugins it needs, and the server runs every plugin that any of its Projects asks for, so what a plugin contributes is available to every Project.

On the **Plugins** page, a server plugin's row shows its package name, description, version and status, with tags for its categories, **built in** when it ships with PenguinHarness, and its keywords. Select a row to open the plugin's page, with its license, authors, links and documentation. A plugin the registry has no entry for has no page.

To add a server plugin to the current Project:

1. Under **Available**, select **Install** on the plugin's row.
2. Confirm. Adding or removing a server plugin stops the agent runs in progress in every Project.

To remove one, select **Remove** on its row under **Installed plugins**, and confirm. The plugin leaves the Project's list; nothing is deleted from disk.

Only admins see **Install** and **Remove**. Only plugins that ship with PenguinHarness can be added, so nothing is downloaded. A change applies without restarting the server: the server rebuilds its business surface around the new list, which is why runs in progress stop. Afterwards the row's status reads **running**, **restart to load** when the server could not apply the change without a restart, or **failed to load** with the reason.

The list is the `[plugins]` table of the Project's config; see [Configuration Reference](/configuration#plugins). For the routes, see [Server API](/server-api#plugin-registry-and-project-plugins), and for how the server loads plugins, see [Server Boot and Subsystems](/server-boot#re-assembly).

## Write a Skill

A Skill is a directory under the agent's `agent_state/skills/` that contains a `SKILL.md` file and any other files the `SKILL.md` refers to.

1. Create the directory `agent_state/skills/<name>/`. The directory name is the Skill's name and must match `^[A-Za-z0-9_-]+$`.
2. In the directory, create `SKILL.md`: a frontmatter block with `name` and `description`, followed by the instructions. See the example below.
3. Add any other files the `SKILL.md` refers to, such as a `reference/` directory it links to.

```md
---
name: my-skill
description: One-line English description injected into the system prompt.
---

# My Skill

Concrete steps, boundaries and acceptance criteria...
```

The agent picks up the Skill the next time its system prompt is assembled. A directory without a `SKILL.md` is not a Skill. Because every read goes straight to the files, you can also edit an installed Skill in place.

A Skill has no icon of its own. An installed Skill or hook package shows the icon of the plugin it came from. One with no plugin icon, such as a Skill you wrote yourself, shows a book for a Skill or a hook for a hook package.

### Improve Skills over time

An agent can rewrite its own `SKILL.md` as part of a Task. Combined with Benchmark evaluation and optimization, this closes the improvement loop; see [Self-Improvement](/self-improvement). When you change a Skill, set `version` to today's date with the next sequence number.

Long Tasks can also feed their lessons back. With the `continual-learning` plugin installed, when a Task ends after more than 30 turns, its stop hook hands a condensed excerpt of the Task to a background subagent. The subagent folds the lasting findings into the relevant `SKILL.md` files; see [The Agent Loop](/agent-loop#stop-hooks).

## Built-in library

The built-in plugins, by category (`PLUGIN_CATEGORIES` in `packages/core/src/plugins/index.ts`; the library directory is the source of truth as plugins are added):

| Category | Plugin | Purpose |
| --- | --- | --- |
| Office Productivity | `data-analysis` | Complete data-analysis tasks with bounded evidence inspection, explicit answer-changing decisions, native artifact handling and final output verification |
| | `use-firecrawl` | Web search and page scraping into clean markdown via the Firecrawl API |
| | `use-bento-slides` | Author and edit Bento presentations: single-file `.bento.html` decks whose document is JSON, mapping material to charts, morph transitions and state slides |
| | `humanizer` | Strip AI-writing tells from prose in any language and rewrite it into the register of books, newspapers and encyclopedias (not preinstalled: install from the library when needed) |
| | `goal` | The stop hook behind [goal mode](/goal-mode): keeps the Session working toward an objective until it is complete, blocked, or out of Token budget (preinstalled) |
| | `continual-learning` | When a Task ends after more than 30 turns, hands its condensed excerpt to a background subagent that folds the durable findings into the agent's Skills (not preinstalled) |
| Software Development | `software-development` | Software development end to end, with two Skills: `software-engineering` (investigate, implement and validate with minimal scope) and `web-design` (the Penguin visual language for generated web UIs) |
| | `use-claude-code` | Run Claude Code on a remote host over SSH: a persistent expect session, headless `-p` with the stdin fix, a tmux-driven interactive TUI and multi-turn continuity (not preinstalled: install from the library when needed) |
| AI App Development | `agent-development` | Agent development on PenguinHarness, with four Skills: `penguin-sdk` (build agent/AI/RAG apps on the SDK), `unified-llm-api` (call model APIs through `@prismshadow/agenthub`), `penguin-config` (manage model keys, defaults and Vault secrets) and `penguin-orchestration` (drive agents, Sessions, costs and schedules from a shell) |
| | `model-development` | Model development on your own hardware, with three Skills: `llamafactory` (fine-tune), `ollama` (run local models) and `vllm` (serve behind an OpenAI-compatible endpoint) |
| | `skill-porting` | Port Skills from external sources (plugin marketplaces, skills.sh registries, GitHub repos or local folders) into the agent after review and normalization |
| | `agent-tuning` | The tuning loop as four Skills: `agent-initialization` (set an agent up from a requirement), `benchmark-design` (design and calibrate a capability Benchmark), `agent-evaluation` (execute and score one isolated case) and `agent-optimization` (improve the agent from measured results) |
| Agent Company | `agent-company` | The whole toolkit of [company mode](/company-mode), with seven Skills: `company-setup` (create an organization with the user: one question at a time, a summary to confirm, then `penguin org create`; it never hires or files tickets), `company-employee` (the protocol every desk and ticket Session follows: trigger blocks, the ticket board, blocking, asking the board before heavy or irreversible work, channel etiquette, budgets), `company-ceo` (mission to tickets, hiring, Workspace partitioning, review, reporting to the board), `company-hr` (calendar coverage, hiring and offboarding, evaluation), `company-finance` (budgets, the daily audit, alerts and pauses), `company-research` (a research organization's authors and reviewers: freeze the evaluation harness and the metric, run the experiment loop inside a resource envelope the board approved, keep only what improves the metric, and put every claim through a reviewer who tries to break it) and `company-mirror` (a company of digital twins: one twin per real colleague, bound to that colleague's bot, relaying instead of filing tickets). Not preinstalled: the organization installs it when it creates the CEO and hires employees, and an agent that should be able to create an organization installs it from the library |

## How it works

This section describes the file formats, naming and versioning rules, loading and installation behind the tasks above.

### Plugin file format

A plugin is a directory with a `plugin.json` manifest and the content it ships:

```text
plugins/<plugin>/
├── plugin.json                # manifest — the plugin's single metadata holder
├── icon.svg                   # the plugin's icon (every built-in plugin ships one)
├── skills/<name>/SKILL.md     # zero or more skills (reference/… alongside)
└── hooks/*.mjs                # at most one hook package: plain Node scripts
```

`plugin.json` fields:

| Field | Meaning |
| --- | --- |
| `description` / `description_zh` | One-line description (English required) |
| `short_description` / `short_description_zh` | Card labels (optional; the full description stands in) |
| `version` | `YYYY.MM.DD.N`: the date plus a sequence number for that day |
| `category` | One of `office-productivity`, `software-development`, `ai-app-development`, `agent-company`; a missing or unknown category lands in "Other" |
| `preinstall` | Optional; `false` keeps the plugin out of `default_agent`'s preinstalled set, so it is installed only manually from the library |
| `hooks.stop` / `hooks.pre_tool_use` / `hooks.user_prompt` | The hook package's commands per [hook point](/agent-loop#stop-hooks): `[{ "command": "stop.mjs", "timeout": 60 }]`, paths relative to `hooks/`, timeout in seconds |

### Plugin naming and versioning

- The plugin name is its directory name and must match `^[A-Za-z0-9_-]+$`.
- A plugin built around someone else's product carries a `use-` prefix (`use-firecrawl`), so the name says what it is for rather than claiming the product.
- Versions are compared by date, then by sequence number: `2026.08.29.10` follows `2026.08.29.9`.
- The manifest's `version` is the version of everything the plugin ships. It is separate from the package's npm version, which follows the release. There is no other version scheme.
- Every plugin is its own npm package, `@penguinharness/<name>`, at `plugins/<name>/` in the repository. The loader in `@prismshadow/penguin-core` reads the plugin names from the host package's dependency list and resolves each package through Node. The desktop app declares the same packages as dependencies, and its installer packs them. At runtime the plugin files are the source of truth for library content and are read on every call.

### Skill file format

A Skill's directory name is its authoritative name and must match `^[A-Za-z0-9_-]+$`; it overrides any `name` in the frontmatter.

A library `SKILL.md` has only two frontmatter fields. Everything else lives in `plugin.json`.

| Field | Meaning |
| --- | --- |
| `name` | Skill name, matching the directory name |
| `description` | English one-liner injected into the system prompt |

The installed copy describes itself. At load time the library regenerates each Skill's frontmatter with the plugin's `short_description`, `short_description_zh` and `version` added, the same way an installed hook package's `hooks.json` is generated from the manifest, and writes that into `agent_state/skills/`. Update checks read the installed frontmatter's `version`, and the Web App reads its short descriptions.

Parsing is tolerant: only `key: value` scalar lines inside the first `---` block count. A `version` that is neither `YYYY.MM.DD.N` nor the legacy `YYYY-MM-DD.N` of an older installed copy reads as empty. An empty version is older than any library version, so the library's copy counts as an update.

### Hook package manifest

An installed hook package is the plugin's `hooks/` directory, installed as `agent_state/hooks/<plugin>/` with a generated `hooks.json` beside the scripts. The manifest holds the plugin's identity fields (`name`, `description`, `description_zh`, `version`) and one command list per hook point:

```json
{
  "name": "goal",
  "description": "Goal mode: …",
  "description_zh": "目标模式：…",
  "version": "2026.09.01.1",
  "stop": [{ "command": "stop.mjs", "timeout": 60 }],
  "pre_tool_use": [],
  "user_prompt": [{ "command": "start.mjs", "timeout": 60 }]
}
```

The scripts are plain Node that uses only built-in modules, so they run wherever the harness runs. Each runs as a subprocess that reads JSON on stdin and writes a JSON answer to stdout; [The Agent Loop](/agent-loop#stop-hooks) describes the contract. Every top-level Session of the agent consults the installed hook packages at the loop's hook points. The `hooks.enabled` key in the agent's `system_config.yaml` holds the **Enable hooks** switch; when the key is absent, hooks are on.

A hook package's other scripts are for the host to call by convention. For example, the `goal` plugin's `start.mjs` is what the server runs when a user starts a goal; see [Goal Mode](/goal-mode).

### Progressive loading

Skills load in two steps: the index first, the body on demand.

- The system prompt's `{{SKILLS}}` placeholder expands to the **Skills prompt**, whose `{{SKILL_METADATA}}` placeholder lists each installed Skill's name and description. Nothing is injected when **Enable skills** is off or the template has no `{{SKILLS}}` placeholder.
- The prompt tells the model to read the matching `SKILL.md` in full before it follows the Skill. There is no dedicated Skill tool: reading the body is one `read_file` or shell call; see [Tools & Approval](/tools).
- When you select Skills in a chat, the message starts with a `[use_skills]` block that lists their names. The earlier `<use_skills>` form is still recognized when old Traces are displayed.

### Installation and storage

Installed Skills live under `agent_state/skills/<name>/`, and hook packages under `agent_state/hooks/<name>/`. The files are the source of truth: every read goes straight to disk with no cache.

- Installing a Skill writes its installable `SKILL.md` (with the regenerated frontmatter), the plugin's `icon.svg`, and the other files in the Skill directory, keeping subdirectories. A Skill you write or import may include its own `icon.svg`, which is copied instead.
- Installing a hook package writes `hooks.json`, the plugin's `icon.svg`, and every file under the plugin's `hooks/`.
- Each install replaces the whole directory, so reinstalling drops files a newer version no longer ships. Reinstalling is how an installed copy is updated.
- Uninstalling deletes the whole `skills/<name>/` or `hooks/<name>/` directory.
- A running Session keeps the hook packages it was built with. After a hook package is installed or removed, or the **Enable hooks** switch changes, the server rebuilds the agent's cached runtimes the next time they are idle.
- Besides the Web App, plugins can be installed through the SDK.
