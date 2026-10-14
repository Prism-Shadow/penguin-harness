# Manage workbenches from Agent settings

Date: 2026-10-14
Type: feat
Scope: core, server, web, plugins
PR: [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)

[中文](./2026-10-14-workbench-management.zh.md)

Agent settings now include a Workbenches tab for opening, reloading, restoring and removing installed workbenches. Agent cards and the searchable Agent selection dialog show workbench counts.

## Navigation and conversations

Exiting full-app mode returns to the same workbench. New chats display only the selected Agent's tabs. Sessions created by a workbench carry the `workbench` source and are automatically archived; their application can continue reading and running them. Existing conversations keep their recorded sources.

## Application interactions

The support dialog closes on a backdrop click while preserving its draft. The workbench-building Skill now calls for separate lists and details, accessible dialogs, progress feedback and a two-conversation browser check. Plugin titles are updated in both languages.
