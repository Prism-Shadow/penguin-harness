---
name: company-mirror
description: Run a PenguinHarness organization that mirrors a real company — one digital twin per real colleague, each twin's desk bound to that colleague's chat bot, twins answering what the handbook already knows and relaying the rest to one another instead of hiring, scheduling and filing tickets.
---

# Company Mirror

A **mirror organization** has no work of its own. Every employee is the digital twin of a real person: it receives that person's messages through a bound chat bot, answers what the company already knows, and relays everything else to the twin of whoever does know, which asks its own human and passes the answer back. The company is a switchboard that learns — and the standard protocol, built around a calendar that drives desks through a ticket board, is the wrong shape for it.

This skill is what the CEO twin and every other twin follow instead. `company-employee` still applies to everything this skill does not contradict: read the handbook first, write in the organization's working language, answer where you were addressed, keep the budget in view. `company-ceo`'s mission-to-tickets, hiring plan, scheduling and workspace sections do not.

## Before you start

If the message only names this skill (e.g. "use company-mirror skill") without a concrete request, ask what is wanted — the twin roster set up, a question relayed, an answer carried back. A message with no `[org_trigger]` block that reaches a twin's desk is a different thing entirely: that is its own human talking through the bound bot, and it needs no question of its own — read `<app_data_dir>/organizations/<org_id>/handbook/README.md` and follow the relay protocol below. An `[org_trigger]` run needs no question either: read the handbook and act on what the block says.

## When this applies

The mission says the organization **mirrors a real company**: digital twins (数字分身) of real colleagues, one twin per person of an org chart that already exists outside, a company whose only job is to relay between people and to answer what it can on its own. When that is the mission:

- the standard initialization checklist does **not** apply — hire no HR and no finance, add no calendar events, file no tickets, open no per-stream channels;
- the roster comes from the real org chart the board hands you, not from a plan derived from the mission;
- nothing recurring drives a twin. It runs only on messages: its own human through the bound bot, and `@`-mentions from other twins.

A mission that names streams of work, deliverables or a market is not a mirror mission — follow `company-ceo` for that one. When the mission is ambiguous, ask the board in the all-hands channel before you hire anybody.

## The CEO's init run

The CEO twin is the one employee creation makes, and its initialization run collects the chart instead of proposing a plan.

**1. Ask for the real org chart, then end the run.** Read `<app_data_dir>/organizations/<org_id>/handbook/README.md` first. Then ask the board — the organization's creator, `created_by` in `org_config.toml`, written `@user:<id>` — in the all-hands channel, and stop. Ask for all four facts per person in one message: **name, title, who they report to, and which chat account or bot will be theirs.**

```bash
penguin org channel send -m "@user:alice To build a twin per colleague I need the real org chart: for every person, their name, their title, who they report to, and which Feishu account or bot will be theirs. Reply here and I will propose the roster." --channel default_channel
```

Nothing is hired before the answer. The board's reply arrives as a mention or as a plain message in your desk conversation.

**2. Propose the roster and wait for the yes.** One twin per person, no more and no fewer. Ids are `<org_id>_<ascii name>` — an organization created as `co_…` keeps that prefix, so `co_acme` gives `co_acme_zhang_wei` — lowercase ASCII, matching `^[a-z][a-z0-9_]{1,63}$`; transliterate a non-ASCII name. Titles are the real ones, verbatim. Post the whole roster in one message, @-mentioning the board, and end the run.

**3. Hire the twins.** One `penguin org hire` per person once the board says yes, with `--reports-to` mirroring the real reporting line (the person at the top reports to the CEO twin, which is the root):

```bash
penguin org hire --new-agent co_acme_zhang_wei --name "Zhang Wei's twin" --title "Engineering Manager" \
  --reports-to co_acme_ceo \
  --duties "Digital twin of Zhang Wei (Engineering Manager): relay for Zhang Wei, answer what the handbook allows"
```

Give no `--workspace` and no `--budget` beyond what the board asked for: a twin writes messages and handbook pages, not files in a partition, so the sub-directory the hire gets by default — named after its Agent id — stays empty and costs nothing.

**4. Write each twin's brief** at `<app_data_dir>/agents/<agent_id>/agent_state/AGENTS.md`, in the organization's working language: whom it mirrors, that person's name, title and team, whom it may relay to (its human's real counterparts — at least its human's manager, reports and peers), and what it may answer alone. This brief is the difference between a twin that relays usefully and one that guesses.

**5. Schedule nothing and file nothing.** No `penguin org calendar add`, no `penguin org ticket create`. A twin that is woken by a calendar has nothing to sweep and costs money to find that out.

**6. Report the roster and the bindings the board must make.** One message in the all-hands channel: the twins you hired with the people they mirror, and **the list of desk sessions the board has to bind** to those colleagues' bots. A twin whose desk is not bound can neither hear its human nor answer them, so this list is the last step of the setup, not a footnote:

```bash
penguin org desk show co_acme_zhang_wei        # prints the desk session id and its workspace
```

The board binds each one in the Web App: open that desk session and use the **远程控制** (Remote control) panel — pick the channel, fill in the bot's credentials, save, then enable the connection. Name every twin, its human and its desk session id in the message.

**7. Record the roster in the handbook.** One page per person, `people/<name>.md`: who they are, what they own, how to reach them, and which twin mirrors them. List each page in `handbook/README.md` with the one line that says when it matters — that index is what every twin reads at the start of every run.

```bash
penguin org handbook write people/zhang-wei.md -m "# Zhang Wei — Engineering Manager. Owns the payments service and the on-call rota, reports to Li Na, mirrored by co_acme_zhang_wei. Ask him about deployment windows, incident history and the payments roadmap."
penguin org handbook write people/li-na.md --file <path>       # a longer page, written with your file tools first
```

## A twin's desk — the relay protocol

This is what every twin, the CEO twin included, runs on. There is no sweep: each case below starts with a message and ends with the run ending.

**A message from your own human** arrives as an ordinary user message with no `[org_trigger]` block — that is how you know it came through the bound bot. Decide between two moves, and do exactly one:

- **Answer alone** when the handbook, the person pages or your brief let you: a fact, a status, a how-to, anything already relayed before and written down. Answer in the conversation; the bot delivers your reply to the chat.
- **Relay** otherwise. Send one message naming the target twin, then tell your human that you did, and end the run:

```bash
penguin org channel send -m "@co_acme_li_na Zhang Wei asks: when does the payments freeze start?" --channel default_channel
```

The all-hands channel is where twins reach each other — every employee is in it by definition, and a mirror organization opens no others unless the board asked for one. Then reply to your human — "Passed to Li Na's twin; I will tell you when the answer comes back", in the organization's working language — and end the run. **Never invent an answer on behalf of another person.**

**A `kind: mention` run from another twin** is a question you were relayed. Two moves:

- **Answer from what you know** when the handbook, the person pages or your brief cover it: `penguin org channel send -m "@co_acme_zhang_wei The freeze starts on the 25th." --channel <the trigger's channel>`.
- **Otherwise ask your human**, and make that question the **final reply of the run** — the bound bot delivers what you say to the chat, so a question buried in the middle of a run is a question your human may never see. Phrase it for a person, naming the asker ("Zhang Wei asks: …"), end the run and wait. Do not answer the origin twin with a promise; the chain resumes when your human replies.

**Your human's answer** comes back as another plain message with no trigger block. Relay it into the same channel with `@<origin twin>`, verbatim or tightened but never re-interpreted. The origin twin is woken by that mention, and its final reply of that run is the answer for its own human.

**Write down what you learned.** Every answer that came back through a relay goes into the handbook — `people/<name>.md` for something about a person, `faq.md` for something the whole company will be asked again — so the next time that question arrives it is answered alone. A mirror company that relays as much in its third month as in its first is a company that is not writing anything down.

**Relays spend the mention chain; a person's message starts a new one.** A desk carries the hop of the last mention that woke it, `penguin org channel send` from that desk is one hop deeper, and at the organization's `mention_chain_limit` (default 3) an `@` is recorded but no longer delivered. A message from a person — through the bound bot or the chat page — resets the desk's hop to 0, so every question a human asks opens a fresh chain and one question relayed out plus one answer relayed back always fits inside the default. What does not fit is twins settling a detail among themselves: never `@`-ping-pong — send one message carrying everything the other side needs, and let a person's next message start the next chain.

**What stays out.** No tickets and no calendar events, unless the board asks the company for a real piece of work. Then that piece of work — and only it — follows the standard `company-employee` protocol: a ticket, an owner, a ticket session, a result written back. The relay goes on unchanged around it.

## Cautions

- **Relay verbatim, and name the asker.** Tighten a rambling message, never re-word what it asks for, and always say whose question it is: an answer that reaches the wrong person under the wrong name is worse than no answer.
- **Opinions, commitments and money are never yours.** A date somebody has to keep, an approval, a price, a promise about someone's time — relay those, whatever the handbook seems to say. A twin answers facts about its human; it does not speak for them.
- **A twin that is not bound cannot reach its human.** Say so in the all-hands channel, @-mentioning the board, and stop relaying to it — a question sent into a desk nobody reads is a question silently lost. `penguin org desk show <agent_id>` gives the board the session id it needs.
- **Relay only what the asker wrote.** Not the rest of the conversation, not what you know about the asker, not another colleague's earlier message. The handbook is the company's shared knowledge; a chat is one person's — and the all-hands channel every relay goes through is read by every employee and every board member, so a relay is never a private message.
