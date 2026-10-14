# Agent Workbench and built-in product support

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **Breaking:** yes — Workflow contracts are renamed to Workbench

[简体中文](2026-10-14-agent-workbench.zh.md)

The three AI app examples now create an Agent with its own Agent Workbench tab. Users open the Agent, start a new chat and select its workbench to use the app.

## App creation

Switching examples replaces the selected Skills, including when both examples select the same number. The Plugin Skill explains how to load a new Agent's workbench, poll background tasks and download reports through server attachment links. `WorkbenchHost.sessionResult` exposes the latest task's final answer or failure without tool or thinking messages. Hidden alerts stay hidden when page layout rules set their display style.

## Product support

The default Project initializes a PenguinHarness support Agent with a workbench for questions, categories, search, follow-ups, source links and resolved tickets. Answers use the official documentation and repository. Ticket state survives workbench reloads; existing Agent files remain editable and are not overwritten by provisioning.

## Compatibility

The one-time directory, interface and history migration is described in [Backward compatibility](2026-10-14-backward-compatibility.md).
