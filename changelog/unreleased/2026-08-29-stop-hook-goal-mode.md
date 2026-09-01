# Hooks in core, goal mode and skill summaries as plugins, and the skill library becomes a plugin library

- **Date:** 2026-08-29
- **Type:** feature
- **Scope:** `core`, `plugins`, `server`, `web`, `cli`, `desktop`, `docs`
- **Breaking:** yes

[中文版](2026-08-29-stop-hook-goal-mode.zh.md)

The Session gained a generic hook mechanism: core codes the hook _points_ — one so far, **stop**, the moment a Task ends — and the hooks themselves come from plugins as **hook packages**, plain Node scripts installed into `agent_state/hooks/` beside `agent_state/skills/`. Goal mode moved out of core entirely and became the `goal` plugin's stop hook, ralph-loop style: a state file the hook reads and rewrites after every Task. A second hook package, `skill-summary`, hands a long session's findings to a background subagent. The skill library was reshaped into a plugin library — one manifest per plugin, skills and hook packages inside, versions by date — and `@prismshadow/penguin-skills` is deprecated in favour of `@prismshadow/penguin-plugins`.

## Stop hooks

- After every Task of a `run` call the Session consults the Agent's installed hook packages (top-level Sessions only), running each `stop` command as a subprocess with `{ hook, session_id, trace_path }` on stdin — nothing more. Token usage, turn counts, how the Task ended and any state file are the script's to derive from the Trace.
- A script answers `continue` (with the next Task's user text as `input`), `stop`, a `subagent` request (`{ prompt, agent_id? }` — the Session spawns a detached background child Session, inherits the run's approval callback, records its session id), or nothing. Every non-empty answer becomes one generic `hook` event message — `hook`, `name` (the package), `decision`, `reason`, scalar `output` — streamed and written to the Trace; the injected input is the user message that follows it, stamped `sender: "harness"` — the structural origin mark hosts render and key on, with no text protocol. The first `continue` drives the next Task inside the same `run`; after a cutoff or an aborted signal a `continue` is recorded but never run. A script that crashes, prints non-JSON or times out (default 60 s) is recorded and treated as no opinion.
- SDK embedders can still register in-process hooks (`SessionConfig.hooks.stop`); the subprocess runner (`runHookScript`) is exported for hosts that call a package's other scripts.
- The trace page renders `hook` events; the CLI prints one dim line per non-goal hook answer.

## Goal mode as the `goal` plugin

- Core knows nothing about goals any more — `session.run`'s `goal` option, the goal file helpers, `goalOutcomeOf` and the `[goal]` marker itself are gone (the `goal-block` marker module included). Round messages are plain user text: no protocol block, origin carried by the `sender: "harness"` stamp alone. The plugin (preinstalled on `default_agent`) ships `start.mjs`, which writes `GOAL.json` (`objective`, `status`, `budget`, `round`, `tokens_used`, and `ended` once the hook has acted on a terminal status) and composes round 1's protocol message, and `stop.mjs`, which after every Task reads the round's usage off the Trace (windowed from the round's injected input; completion notices share the stamp but are not boundaries), applies the same decision order as before (model verdict → cutoff → wrap-up → 100-round cap → budget → next round) and rewrites the file.
- The server gates `goal: { budget }` on the package being installed (`409 goal_plugin_not_installed`), runs `agent_state/hooks/goal/start.mjs`, and submits your message exactly as typed (text and images) with the protocol message it prints right behind it, harness-stamped; later rounds restate the objective from the goal file. `GET /goal` reads `GOAL.json` (a file the hook has not ended reads as `aborted` while the Session is idle). The `goal_*` server events, the chat banner, the `/goal` command and `penguin run --goal` behave as before — `goal_round` and the CLI's round line now count harness-injected inputs instead of parsing text; the CLI reads the outcome from the `goal_finished` server event. File attachments are refused.
- The Web App shows a toast when a goal is started on an Agent without the plugin. Round messages render as regular user messages with an "Injected by the harness" caption — the goal-round collapse ("Goal · round N") is gone; input history and the conversation outline skip harness-injected inputs by the stamp (background completion notices keep their turn).

## The `skill-summary` plugin

- Not preinstalled. When the Task that just ended ran more than 20 completed turns, its stop script condenses that Task (clipped user/assistant text, tool calls and outputs) and answers with a `subagent` request whose prompt asks the child to fold durable findings into the relevant `SKILL.md` files and bump their version. The window is the Task itself, so a Task triggers at most once — at its end — and short Tasks never do. An Agent with no installed skill never fires it.

## The plugin library

- `packages/plugins` (npm `@prismshadow/penguin-plugins`) replaces `packages/skills`: `official/<plugin>/plugin.json` + `skills/<name>/` + `hooks/`. Every existing skill became a single-skill plugin; the two hook packages joined a new **Session Hooks** category. Versions are `YYYY-MM-DD.N`, and `plugin.json` is the single metadata holder — a library `SKILL.md`'s frontmatter carries only `name` and `description`, with the plugin's short descriptions and version stamped into the installable copy by the loader (the installed frontmatter stays self-describing for update checks and the UI); the icon is the plugin's `icon.svg` beside `plugin.json` (every built-in plugin ships one — the hook packages included — and skills inherit it); the natural-number `version` and the `updated` timestamp are gone.
- Agent State: `agent_state/hooks/<plugin>/` holds a hook package (`hooks.json` generated from the manifest, plus the scripts) beside `agent_state/skills/`; `installPlugin`, `installHook`, `removeHook` and `listInstalledHooks` join the state layer. `default_agent` preinstalls every plugin not marked `preinstall: false`.
- API: `GET /api/plugins` (categories → plugins with their skills' metadata and hook points), `POST …/agents/:a/plugins { names }` (whole-plugin install; reinstall = update), `GET|DELETE …/agents/:a/hooks[/:name]`. `GET /api/skills` and `POST …/skills { names }` are gone; the installed-skill routes (list, archive import/export, uninstall) stay. Agent creation takes `plugins` instead of `skills`; `AgentSummary` reports `hookCount` and `pluginUpdates` (was `skillUpdates`); `SkillMetadataItem.version` is a string and `updated` is gone.
- Web App: the skill library page is the **plugin library** (`/plugins`) — cards show a plugin's skills and hook points, install and update whole plugins; the Agent settings page gained a **Hooks** tab; the create dialog seeds plugins. CLI: `penguin agent create --plugins`.
- The design spec was updated to match ([penguin-harness-design #86](https://github.com/Prism-Shadow/penguin-harness-design/pull/86)).

## Compatibility

- **`@prismshadow/penguin-skills` is deprecated**; nothing new is published under that name. The release chain publishes `@prismshadow/penguin-plugins` instead.
- **Installed skills carry natural-number versions** from before this change; they read as an empty version, so the plugin library reports every one of them as updatable once. Reinstalling from the library brings the dated version.
- **Existing Agents have no hook packages installed** — nothing is auto-installed into an Agent that already exists. Goal mode on such an Agent answers `409 goal_plugin_not_installed` until the `goal` plugin is installed from the plugin library; `default_agent`s created from now on have it.
- **`goal_finished` and the `goal` run option no longer exist** (removed with the previous iteration's `goal_state` table); the `goal_*` server events are unchanged. Traces from earlier versions still carry `goal_finished` records, which readers treat as an unknown event.
- **The `[goal]` marker is gone** — `parseGoalMessage`, `isGoalRoundInput`, `downgradeGoalInput` and `GoalRoundMessage` are no longer exported. Old Traces with `[goal]`-blocked rounds render those messages as plain text (the block visible, no round notice), open outline entries and enter input history like any user message; new rounds carry the `sender: "harness"` stamp instead.
- **`hooks.skill_summary` in `system_config.yaml`** is no longer read: installing the `skill-summary` plugin is the switch.
- The `skills: string[]` field of agent creation and the CLI's `--skills` are `plugins` / `--plugins` now.
