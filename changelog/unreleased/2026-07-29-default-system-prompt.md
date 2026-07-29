# Core: a tighter default system prompt, a reply-language rule, and a shared dependency directory

The built-in Agent template is re-read by the model on every turn, and had grown wordy in exactly the sections that repeat most. They are trimmed by roughly a quarter without a single rule being dropped, and two behaviours the prompt never stated are now in it.

## What the trim changed

Personality pins the reply language to the user's own — the tool schema already demanded that of every call description, so the two agreed in practice while only one of them said so. The process/port constraint collapses from two sentences into one, with the same guarantees: don't kill what you didn't start (PenguinHarness's own services included) unless asked, don't take a service port, pick another free port when the one you want is busy.

API auth handling stops being split across two sections. Constraints carried "retry at most once" and Stop rules carried a fourth rule for what to do afterwards; it is now stated once, as the special case of the existing "an error you cannot resolve" rule — retry at most once, then stop calling tools and ask the user to update the key in the Agent's vault or the model settings outside the chat. The facts that made the old wording long are intact: the secret is never pasted into the conversation, and a new key only takes effect in the next conversation, so further retries cannot succeed.

System markers lose about half their words while keeping all four markers and their instructions. File system goes from eight bullets to six, merging the workspace-relative-path convention into the `CWD` bullet and another agent's state into the description of your own. Suggested workflows now says out loud that dispatching independent subtasks to subagents **in parallel** is the fast way through a large task, and drops the duplicated "browse with Playwright/curl" line that Tool use already carried.

## Skill dependencies install once

The Skills section loses the "There is no skill tool" filler — the sentence explained an absence — and gains a convention in its place: install a skill's dependencies once, not per task. Python virtualenvs, npm packages and similar reusable environments go into the shared `<app_data_dir>/agents/<agent_id>/env/` directory and are reused across Sessions, unless the current directory already has an environment of its own, which always wins.

`env/` is a prompt-level convention, not a path the code creates: `paths.ts` is untouched, and Agent State snapshots still package `agent_state/` alone, so a virtualenv can never bloat an export. The data-layout tree in the Sessions & Traces documentation lists the directory with that caveat spelled out.

## Existing Agents

Nothing migrates and nothing is rewritten. An Agent always runs with its on-disk `agent_state/system_config.yaml` verbatim, so this reaches **newly created** Agents only. An existing Agent adopts it through the settings page's *Restore default configuration* action, which overwrites the whole configuration — custom system prompt, tool list, model and compaction settings, MCP Servers — keeping only `name`, `description` and `version`.
