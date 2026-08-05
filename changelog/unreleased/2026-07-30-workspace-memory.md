# Workspace Memory: what an agent keeps between Sessions

An agent now has a long-term store it maintains itself: Markdown notes under `agent_state/memory/`, kept in two scopes — one per Workspace and one for the agent itself — with a shared index that enters the context and topic bodies read on demand. It covers what a later Session cannot re-derive from the Workspace — standing user feedback, project decisions with their reasons, conventions, entry points into external systems.

Memory is not context compaction. Compaction preserves one Session's short-term working state; Memory is what survives the Session ending.

## Scope and layout

There are two scopes, both belonging to one agent and never shared with another:

- **Agent scope** (`memory/agent/`) — what stays true wherever the agent works: the user's standing preferences, reference material not tied to one codebase. Every session reads it.
- **Workspace scope** (`memory/<workspace_key>/`) — facts about one Workspace. Sessions of one agent in one Workspace share it; different Workspaces keep their topic files apart.

Both share a single index, and different agents never share Memory even in the same Workspace.

```text
agent_state/memory/
├── AGENTS.md                     # the shared index, grouped by scope directory name
├── agent/                        # Agent scope (no marker: it stands for no path)
│   └── feedback_style.md
└── my-app-a81f32c4/
    ├── .workspace                # the Workspace path this key stands for
    ├── feedback_testing.md
    └── project_release.md
```

`agent` is safe to reserve because every generated workspace key is `<base>-<8 hex>` and so always carries a hyphen — a hyphen-free name can never be produced.

The workspace key is `<safe-basename>-<8 hex of the real path's sha256>`. Identity is the directory itself, with no dependence on Git: two symlinks to one directory resolve to a single key, and moving or renaming a directory makes it a new Workspace — the old Memory stays on disk under the old key rather than following a path that no longer exists.

A **temporary** Workspace gets no Workspace scope. One is allocated per session, so no later session would ever run there to read it back — memory keyed off it would be write-only storage. (Not because it gets cleaned up: deleting a session removes its Traces and scratchpad and leaves `workspaces/tmp-xxxxxxxx` behind.) Such a session still gets the Agent scope, which is where anything it learns belongs anyway, since it has no project context to learn about. The test is the directory's location — anything under an agent's `workspaces/` — rather than whether the caller passed a Workspace explicitly, because a subagent inherits its parent's Workspace as an explicit argument, temporary ones included.

A topic file is a semantic subject, not one per Task, Session or date, and declares `name` / `description` / `type` / `updated_at` in frontmatter. `type` is `feedback`, `project` or `reference`. There is deliberately no `user` type: a Project is a multi-user boundary and Agent State is readable by every member who can reach the agent, so personal data about one person does not belong here — nor do credentials, task progress, unconfirmed guesses, or facts the code and Git history already state.

## What reaches the model

Only the index. At Session creation the Harness prepares the scope directories, reads `memory/AGENTS.md`, and renders the new `{{MEMORY}}` placeholder from the agent's own config: `memory.prompt` always, with `{{MEMORY_AGENT_DIR}}` and `{{MEMORY_AGENTS_MD}}` substituted, plus `memory.workspace_prompt` with `{{MEMORY_DIR}}` when the Session has a persistent Workspace. Every word comes from `system_config.yaml`; the assembly layer adds nothing but a short "nothing saved yet" note in place of an index that does not exist. `{{MEMORY}}` expands to an empty string when Memory is off.

The two halves are separate config keys because substitution has no conditionals — there is no `{{#if}}`. Each half only names placeholders that are defined wherever it appears, so a temporary Workspace is never told about a `{{MEMORY_DIR}}` it does not have. The rule for choosing between the scopes ("something about the user that would still hold in a different project goes in the agent directory; something about this codebase goes in the workspace directory — when unsure, write to the workspace directory") lives in the Workspace half for the same reason: a session with one scope has no choice to make, and never sees it.

Reading, writing and deduplicating are the model's own work through the ordinary file tools — the Harness decides where Memory lives and keeps writes inside it, nothing more.

## Managing it in the Web App

Memory gets its own page at `/memory`, alongside trace observability and the evaluation center and built the same way: a directory tree on the left, the detail on the right. The tree is three levels — Agent → scope → topic file. Under each Agent sit the shared index `memory/AGENTS.md`, then the Agent scope, then one node per Workspace: the index covers every scope so it belongs to the Agent, and the Agent scope leads the rest because it is the one every session reads. A scope is addressed by its directory name throughout — the Agent scope included — so it needed no routes, no DTOs and no tree code of its own; the only thing the API does differently is create the Agent scope's directory on demand, since it belongs to the Agent rather than to a Session that has run. The right side is a full-height Markdown editor for whatever is selected. A topic file is created from the `+` on a scope row; rename and delete act on the selected file. Opening the index parks the caret on the group heading of the Workspace you came from.

Renaming or deleting a topic file also repoints or removes the index links that named it, so the index never lists a file that is gone. The link form is exact (`](<workspace_key>/<file>)`), keeping this a mechanical edit that never rewrites prose the model wrote.

The agent-level switch is *not* on that page — it is agent configuration, not content — so Agent settings keep a **Memory** tab between Prompt and Runtime, holding the switch, the memory directory, and the way in to the page. The switch writes immediately instead of joining the tab's Save, so turning Memory off never drags an unrelated half-finished edit along with it. The tab also warns when an agent is enabled but its template carries no `{{MEMORY}}` placeholder: enabled, yet injecting nothing. Both conditions are marked on the Agent's node in the memory tree too (**Off** / **No placeholder**), so memory that cannot reach the model is visible before you open it, with a link back to the setting.

Turning Memory off keeps every file and leaves the Memory page fully usable; it only stops Memory from entering the context and from preparing directories for new Sessions.

The API is under `/api/projects/:p/agents/:a/memory` and never accepts a path: a file is addressed by agent, scope key and a name inside that scope, each validated and then re-checked for containment after resolution.

## Existing agents

Nothing migrates. An agent runs with its on-disk `system_config.yaml` verbatim, and an existing one has neither a `memory` section nor a `{{MEMORY}}` placeholder — so Memory reaches **newly created** agents only. An existing agent opts in by inserting the placeholder on the Prompt tab, or by restoring the default configuration from Overview.
