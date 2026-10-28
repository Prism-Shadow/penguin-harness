---
title: "PenguinHarness 0.2.17: Unify the agent communication protocol, improve remote machines and the Trajectories panel"
date: 2026-10-26
category: news
excerpt: "The Agent API now streams a Session's records, replies can carry charts and forms, the Trajectories panel is rebuilt, and conversations on a remote machine read that machine."
---

PenguinHarness 0.2.17 is out. **The Agent API's stream is now a Session's own records, and replies can carry chart and form blocks.** The Trajectories panel is rebuilt, and a conversation on a remote machine reads that machine.

## The Agent API streams a Session's own records

**The stream is now the Session's records, exactly as the Trace stores them.** The old v1 events are gone. The `@prismshadow/amsp` SDK reads those records. A program can now follow a Session it did not start: read its history, resume its stream, and see tool calls waiting for approval. In the Web App, "Try it" on an agent's "API" tab now runs through the SDK and lists the run's records.

![The "Try it" section of an agent's "API" tab listing records](/blog-assets/penguinharness-0-2-17-agent-api-en.png)

## Charts and forms in replies

**Replies gain a `chart` block — line, area, bar, pie, scatter, histogram, gauge — and a `resources` block showing one machine's CPU, memory, disks and network.**

![A reply with a grouped bar chart and a resources block](/blog-assets/penguinharness-0-2-17-a2ui-charts-en.png)

Forms now have eleven field kinds, from text and numbers to sliders, switches and dates. An answered form keeps showing its answers after a page reload, in older conversations too. Update the `a2ui` plugin so agents can write the new chart blocks and form fields.

![A form answered and then reloaded, showing the answers read-only](/blog-assets/penguinharness-0-2-17-a2ui-form-en.png)

## A rebuilt "Trajectories" panel

**The "Trajectories" panel was rebuilt around one sticky toolbar.** Its turn button names the turn in view and opens the "Turn index". Turns are ruled rows, and each row's context ring opens the turn's token figures ("Turn readings"). The view shows each request's thinking level where it changes.

![The "Trajectories" panel with toolbar, ruled turn rows and context rings](/blog-assets/penguinharness-0-2-17-trace-en.png)

A command that exits non-zero now shows as an ordinary completed tool call in this panel, the chat and the CLI.

## Conversations on a remote machine read that machine

A remote machine is another computer this server reaches over ssh (the "Machines" page). The "Agents" page lists each connected machine's agents beside this server's. You open, edit, chat with and delete them on that machine.

![The "Agents" page listing a machine's agents beside this server's](/blog-assets/penguinharness-0-2-17-machines-en.png)

**A conversation on a machine reads that machine's memory, models, scheduled tasks and Skills.**

## Upgrading

- **Windows desktop app.** Installers are now signed with a new certificate, and apps of 0.2.16 and earlier refuse the update. Install 0.2.17 by hand once from penguin.ooo/download; later updates install normally.
- **Agent API and SDK callers.** The stream changed shape and record types were renamed. Upgrade the server and `@prismshadow/amsp` together; [the release notes](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.17) say what changed and what to do.
- **TLS-terminating reverse proxies.** Set `PENGUIN_TRUST_PROXY=1`, or every write from the Web App is refused. The proxy settings are in [the release notes](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.17).
- **Remote machines.** A remote machine must run the same version as the server. When the versions differ, the server cannot connect to it, and conversations on that machine stop updating live. After updating the server, update each machine from the **Machines** page (**Update**, or **Update all**). If a machine already shows the server's version but still cannot connect, restart its server; if that does not help, reinstall it.

Installers are available at [penguin.ooo/download](https://penguin.ooo/download). Full details are in [the 0.2.17 changelog](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.17).
