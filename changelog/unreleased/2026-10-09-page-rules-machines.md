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
- The Machine dialog, as wide as the model dialogs, opens with a header: a server tile, the state as one chip — a glyph and one plain word in the state's tone, with the reason (a failure's words, ssh's diagnostic) on the glyph's hover — the installed version, and one line saying how the machine is reached. **Details** lists the facts with a glyph beside each label and plain names: the connection, its address, the data directory, the remote server (with ssh's own words under it when the machine is out of reach), the last check ("4 minutes ago · 10-10 18:54": how long ago, then the time itself in the muted ink), the installed version and whether it is the latest, when it was installed, and last, in the muted ink, the machine id with a copy button. **Progress** shows a queued, running or failed job as its six steps, each marked done, current, failed or still to come; a job that finished well is one line, and the log is folded under **Show log**, open while the job runs. A failed job says at which step it stopped, in the far side's own words, with **Retry** and, when the failure offers it, **Force install** right under it. **Actions** starts with the one thing to do for the machine — **Update**, **Start server**, **Connect** or **Try again** — with what it does beside it, then two groups under small ruled captions, **Maintenance** (Install program, Reconnect, Restart server, Configure ssh) and **Stop using** (Disable, Disconnect, Remove from Project), each verb on a line of its own with what it does beside it. Reconnect is left out where the one thing to do already connects. A verb that cannot run now stays in place, disabled, and its line says why instead: a job on its way, no version to install, nothing connected, a machine out of reach. What the dialog has to say is written out; only the chip's glyph adds a hover. Disable, Disconnect, Remove from Project and Force install ask first.
- The state words are plainer, on the card's mark and the dialog's chip alike: a machine whose server runs but which nothing is connected to reads **Not connected** (it read Offline), and **Running**, **Update available**, **Not running**, **Connected, not running** and **Not checked** replace Serving, Behind, Stopped, Connected, not serving and Unchecked. A machine installed as far as this server can take it wears a muted mark rather than an attention one: nothing waits on anyone.
- **Update all (n)** moved under the title as the notice every page's bulk update takes: "n machines to update", **Update now** behind the same confirmation, and **Dismiss**, which holds for the visit until another machine falls behind or this server's version moves.
- The selection bar and its batch Enable and Disable are gone; every verb is on its machine's card or dialog.

## The update pill

- The **Update needed** pill, the Agents card's kernel pill included, moved from the danger tint to the attention tint: being behind is not a failure, and red stays for what failed or destroys.
