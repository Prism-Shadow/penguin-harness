# List pages open their items one way, and Machines becomes a card list

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `web`

[中文版](2026-10-09-page-rules-machines.zh.md)

Every list page in the menu now keeps one rule: a card opens its item's detail, which is a page of its own for an Agent's settings and for a Benchmark, and a dialog for a model, a plugin and a machine. The Agents card became the link to its settings page, and the Machines page was rebuilt as a card list in the Agents list's shape, with a Machine dialog for everything a card leaves out.

## Agents

- A click anywhere on an Agent's card, or Enter while the card has focus, opens the Agent's settings page. The controls on the card (New chat, Settings, the stat links, Usage, Delete, the update pill) act on their own and open nothing else. An Agent that lives only on a machine has no settings page on this server, so its card opens nothing.

## Machines

- The page is as wide as the Agents page and lists one card per machine, this server first. A card's title line holds the alias (the machine id on hover), the state as one mark whose word and reason are its tooltip, the installed version, and an **Update needed** pill when the machine carries another build than this server's. Below it are the server root and how the machine is reached, the port its server answers on, and when it was last checked. The pipeline's stepper shows in the middle only while a job for the machine is queued or running.
- A card's verbs are **Enable** (**Update** in its place for a machine on another build), **Disable**, and a gear that configures the ssh host; this server's own card has none. A click on the card's body opens the Machine dialog.
- The Machine dialog has three ruled sections: **Connection** (the machine id with a copy button, the ssh alias and the host block it names, the server root, the state, the server over there, the last check, the installed version), **Job** (the current or last job's stepper and output, with **Retry** and, when the failure offers it, **Force install**), and **Actions** (Enable or Update, Disable, then the single steps the server already took one at a time — Install, Connect, Restart, Disconnect and Remove from Project, each saying what it does on hover — and the ssh host's form). Disconnect and Remove from Project ask first.
- **Update all (n)** moved under the title as the notice every page's bulk update takes: "n machines to update", **Update now** behind the same confirmation, and **Dismiss**, which holds for the visit until another machine falls behind or this server's version moves.
- The selection bar and its batch Enable and Disable are gone; every verb is on its machine's card or dialog.
