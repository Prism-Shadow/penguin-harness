# Agent Workbench and built-in product support

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)
- **Breaking:** yes — Workflow contracts are renamed to Workbench

[简体中文](2026-10-14-agent-workbench.zh.md)

The three AI app examples now create an Agent with its own Agent Workbench tab. Users open the Agent, start a new chat and select its workbench to use the app.

## App creation

Switching examples replaces the selected Skills, including when both examples select the same number. The Plugin Skill explains how to load a new Agent's workbench, poll background tasks and download reports through server attachment links. `WorkbenchHost.sessionResult` exposes the latest task's final answer or failure without tool or thinking messages. Hidden alerts stay hidden when page layout rules set their display style.

## Product support

The default Project initializes a PenguinHarness support Agent with a workbench for questions, search, follow-ups, source links and resolved tickets. Answers use the official documentation and repository. Ticket state survives workbench reloads; existing Agent files remain editable and are not overwritten by provisioning.

The support agent installs the `penguin-support` plugin through the regular plugin installer. Its Skill and workbench source live in `plugins/penguin-support/`. The workbench uses a centered question list and dialogs for new questions and conversation details. Plugin workbenches participate in install, update and uninstall; updates preserve their saved state. Answers use inline numbered source links such as [1], without a separate link list. The support Skill reuses a reference checkout across tickets and searches both Workbench and the older Workflow name.

## Compatibility

The one-time directory, interface and history migration is described in [Backward compatibility](2026-10-14-backward-compatibility.md).
