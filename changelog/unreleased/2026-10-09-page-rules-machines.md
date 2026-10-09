# List pages open their items one way, and Machines becomes a card list

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#1010](https://github.com/Prism-Shadow/penguin-harness/pull/1010)

[中文版](2026-10-09-page-rules-machines.zh.md)

Every list page in the menu now keeps one rule: a card opens its item's detail, which is a page of its own for an Agent's settings and for a Benchmark, and a dialog for a model, a plugin and a machine. A click anywhere on a card's body opens it, the card's title (a link or a button) is the keyboard's way in, and the card itself is no control. The Machines page was rebuilt as a card list in the Agents list's shape, with a Machine dialog for everything a card leaves out.

## Agents, Models and the Evaluation Center

- An Agent's name is now a link to its settings page, and a click anywhere on its card's body goes there too. The other controls on the card (New chat, Settings, the stat links, Usage, Delete, the update pill) act on their own and open nothing else. An Agent that lives only on a machine has no settings page on this server: its name is plain text and its card opens nothing.
- A click anywhere on a model card opens its config dialog, and on a published Benchmark's card its page; the warning strip's own button and a masked card's delete button still act on their own.

## Machines

- The page is as wide as the Agents page and lists one card per machine, this server first. A card's title line holds the alias (the machine id on hover), the state as one mark whose word and reason are its tooltip, the installed version, and an **Update needed** pill when the machine carries another build than this server's. Below it are the server root and how the machine is reached, the port its server answers on, and when it was last checked. The pipeline's stepper shows in the middle only while a job for the machine is queued or running.
- The state mark is a dot in the state's tone; a failed job shows a cross in the danger tone, and a machine out of reach an alert in the attention tone.
- A card offers one primary verb — **Enable**, or **Update** in its place for a machine on another build — and a gear that configures the ssh host; **Disable** is in the dialog. This server's own card has none. A click on the card's body opens the Machine dialog.
- The Machine dialog has three ruled sections: **Connection** (the ssh alias and the host block it names, the server root, the state, the server over there, the last check, the installed version, and last, in the muted ink, the machine id with a copy button), **Job** (the current or last job's stepper and output, with **Retry** and, when the failure offers it, **Force install**), and **Actions** (Enable or Update, Disable, then the single steps the server already took one at a time — Install, Connect, Restart, Disconnect and Remove from Project, each saying what it does on hover — and the ssh host's form). Disable, Disconnect, Remove from Project and Force install ask first.
- **Update all (n)** moved under the title as the notice every page's bulk update takes: "n machines to update", **Update now** behind the same confirmation, and **Dismiss**, which holds for the visit until another machine falls behind or this server's version moves.
- The selection bar and its batch Enable and Disable are gone; every verb is on its machine's card or dialog.

## The update pill

- The **Update needed** pill, the Agents card's kernel pill included, moved from the danger tint to the attention tint: being behind is not a failure, and red stays for what failed or destroys.
