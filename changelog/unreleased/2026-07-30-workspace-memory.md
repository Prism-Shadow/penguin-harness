# Workspace Memory: what an agent keeps between Sessions

An agent now has a long-term store it maintains itself: Markdown notes under `agent_state/memory/`, kept per Workspace, with a shared index that enters the context and topic bodies read on demand. It covers what a later Session cannot re-derive from the Workspace — standing user feedback, project decisions with their reasons, conventions, entry points into external systems.

Memory is not context compaction. Compaction preserves one Session's short-term working state; Memory is what survives the Session ending.

## Scope and layout

The scope is `Project + Agent + Workspace`. Sessions of one agent in one Workspace share a Memory; different Workspaces of that agent keep their topic files apart but share a single index; different agents never share Memory, even in the same Workspace.

```text
agent_state/memory/
├── AGENTS.md                     # the shared index, grouped by workspace key
└── my-app-a81f32c4/
    ├── .workspace                # the Workspace path this key stands for
    ├── feedback_testing.md
    └── project_release.md
```

The workspace key is `<safe-basename>-<8 hex of the real path's sha256>`. Identity is the directory itself, with no dependence on Git: two symlinks to one directory resolve to a single key, and moving or renaming a directory makes it a new Workspace — the old Memory stays on disk under the old key rather than following a path that no longer exists.

A **temporary** Workspace gets no Memory at all. The test is the directory's location — anything under an agent's `workspaces/` — rather than whether the caller passed a Workspace explicitly, because a subagent inherits its parent's Workspace as an explicit argument, temporary ones included.

A topic file is a semantic subject, not one per Task, Session or date, and declares `name` / `description` / `type` / `updated_at` in frontmatter. `type` is `feedback`, `project` or `reference`. There is deliberately no `user` type: a Project is a multi-user boundary and Agent State is readable by every member who can reach the agent, so personal data about one person does not belong here — nor do credentials, task progress, unconfirmed guesses, or facts the code and Git history already state.

## What reaches the model

Only the index. At Session creation the Harness makes sure the Workspace's directory exists, reads `memory/AGENTS.md`, and renders the agent's own `memory.prompt` into the new `{{MEMORY}}` placeholder, substituting `{{MEMORY_DIR}}` (this Workspace's directory) and `{{MEMORY_AGENTS_MD}}` (the whole index). Every word of that block comes from `system_config.yaml`; the assembly layer adds nothing but a short "nothing saved yet" note in place of an index that does not exist. `{{MEMORY}}` expands to an empty string when Memory is off or the Session has a temporary Workspace, so the model is never told about a directory it has no reason to write to.

Reading, writing and deduplicating are the model's own work through the ordinary file tools — the Harness decides where Memory lives and keeps writes inside it, nothing more.

## Managing it in the Web App

Agent settings gain a **Memory** tab between Prompt and Runtime: the agent-level switch, a Workspace selector, the shared index pinned above that Workspace's topic files, and a Markdown editor, plus create / rename / delete. Opening the index parks the caret on the selected Workspace's group heading, since one index covers them all.

Renaming or deleting a topic file also repoints or removes the index links that named it, so the index never lists a file that is gone. The link form is exact (`](<workspace_key>/<file>)`), keeping this a mechanical edit that never rewrites prose the model wrote.

Turning Memory off keeps every file and leaves the tab fully usable; it only stops Memory from entering the context and from preparing directories for new Sessions. The tab also warns when an agent is enabled but its prompt template carries no `{{MEMORY}}` placeholder — enabled, yet injecting nothing.

The API is under `/api/projects/:p/agents/:a/memory` and never accepts a path: a file is addressed by agent, workspace key and a name inside that Workspace, each validated and then re-checked for containment after resolution.

## Existing agents

Nothing migrates. An agent runs with its on-disk `system_config.yaml` verbatim, and an existing one has neither a `memory` section nor a `{{MEMORY}}` placeholder — so Memory reaches **newly created** agents only. An existing agent opts in by inserting the placeholder on the Prompt tab, or by restoring the default configuration from Overview.
