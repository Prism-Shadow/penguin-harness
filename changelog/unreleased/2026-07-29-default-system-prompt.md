# Core: a tighter default system prompt, a reply-language rule, and a shared tooling directory

The built-in Agent template is re-read by the model on every turn, and had grown wordy in exactly the sections that repeat most. The six rewritten sections lose about a fifth of their words (829 → 649) with no rule going with them, and two behaviours the prompt never stated are now in it.

## What the trim changed

Personality pins the reply language to the user's own — the tool schema already demanded that of every call description, so the two agreed in practice while only one of them said so. It scopes to prose: code, identifiers and commit messages keep their own conventions. The process/port constraint collapses from two sentences into one, with the same guarantees: don't kill what you didn't start (PenguinHarness's own services included) unless asked, don't take a service port, pick another free port when the one you want is busy.

API auth handling stops being split across two sections. Constraints carried "retry at most once" and Stop rules carried a fourth rule for what to do afterwards; it is now stated once, as the special case of the existing "an error you cannot resolve" rule — retry at most once, then stop calling tools and ask the user to update the key in the Agent's vault or the model settings outside the chat. The facts that made the old wording long are intact: the secret is never pasted into the conversation, and a new key only takes effect in the next conversation, so further retries cannot succeed.

System markers lose about half their words while keeping all four markers and their instructions. File system goes from eight bullets to six, merging the workspace-relative-path convention into the `CWD` bullet and another agent's state into the description of your own. Suggested workflows already recommended dispatching independent subtasks in parallel; it now says out loud that this is the fast way through a large task. Its Playwright/curl line folds into the Tool use bullet, which keeps both halves the two lines used to carry separately: prefer Playwright when it is installed, otherwise `curl`.

## Tooling installs once

File system gains a convention, and the Skills section loses the "There is no skill tool" filler that explained an absence: install tooling once, not per task. Interpreter and tool environments — Python virtualenvs, pipx tools, model and package caches — go under the shared `<app_data_dir>/agents/<agent_id>/shared_env/`, one subdirectory per environment, and are reused across Sessions; an environment already present in the current directory always wins. It sits in File system rather than Skills because it governs any task that installs a tool, not only a skill run.

A project's own dependencies are deliberately the opposite case, and the prompt says so: Node resolves `node_modules` from the project, so anything installed under the agent directory would be unreachable from `CWD`. They install inside the project itself, with pnpm preferred there — its shared store keeps repeated installs from duplicating on disk.

`shared_env/` is a prompt-level convention, not a path the code creates: `paths.ts` is untouched, and Agent State snapshots still package `agent_state/` alone, so a virtualenv can never bloat an export. The data-layout tree in the Sessions & Traces documentation lists the directory with that caveat spelled out, and the per-Agent layout in `01-PRINCIPLES.md` records it too.

## The App Data Dir bullet stops contradicting itself

The same section's App Data Dir bullet said the directory "is NOT the task's directory" and that deliverables must never be left there. A temporary Workspace is `<app_data_dir>/agents/<agent_id>/workspaces/tmp-<8hex>` — inside that very tree, and `CWD` for any task that is given one — so the rule broke exactly where it was needed. It now carries the input rule alone (the App Data Dir's contents were not supplied by the user and are never task input) and says plainly that `CWD` may sit inside the tree, that one folder being the task's and the rest not. Where deliverables go was already stated positively by the scratchpad bullet below it, which holds wherever `CWD` points.

## Existing Agents

Nothing migrates and nothing is rewritten. An Agent always runs with its on-disk `agent_state/system_config.yaml` verbatim, so this reaches **newly created** Agents only. An existing Agent adopts it through the settings page's *Restore default configuration* action, which overwrites the whole configuration — custom system prompt, tool list, model and compaction settings, MCP Servers — keeping only `name`, `description` and `version`.
