# Company roadmaps

Roadmaps for company mode: a person — or an employee, asked to by one — puts **one or more employees in a room** — a channel the roadmap opens for itself and the channel list leaves out — to discuss something too big for one proposal. Each employee takes part through **its desk cloned for that room**: a session of its own that receives everything said in the room, and only that. The first employee named moderates and keeps the **draft**: a record of the discussion, a **body** written as a paper, and the **items** it leads to — proposals (a brief and an owner, stacked on one another) and roadmaps (a brief and the employees who discuss them), each citing the body sections it draws on. Nothing is created while the room discusses. **Establishing** the roadmap archives it: a roadmap item derives its roadmap at once, but a proposal item stays **a brief** — nothing is created for it and its owner is not told — until **a person and the moderator both approve** it. An owner who finds, while building, that the roadmap lacks something it needs **reopens** the room.

It depends on [company-proposals](../company-proposals/README.md): a delegated proposal is created there by its owner and linked back.

## What you get

- **A room that is a channel nobody else sees.** Opening a roadmap opens its room: an organization channel (`roadmap_<n>`) with the employees picked and the person who opened it (an employee who opens it is recorded as its creator, and is in it only when it names itself among the employees), made through the organization gateway (`OrgGateway.openRoom`) and **unlisted** — the channel list, in the sidebar and in `penguin org channel ls`, leaves it out, so the way in is the sidebar's ROADMAPS section and the roadmaps page. The room is read and spoken in on the app's own channel page — the same stream, composer and phone layout as any channel — which, for a roadmap's room, shows the roadmap in a column beside the stream. Everything else is the channel's own: posting, inviting and removing, archiving. The plugin only reads the channel — its members, and its messages by a cursor — and never writes to it. (A roadmap may still be opened over an existing channel through the API, with `channelId`.) An organization that runs on another machine has its room opened there: this server refuses (409 `org_runs_elsewhere`), since it holds only a mirror that the next copy would overwrite.
- **The desk, cloned for the room.** For every employee in the room the plugin opens a session of that employee's Agent (the way a ticket session opens) whose first input is the room: who is in it, who moderates, the last messages, how to speak there. The sessions open with the roadmap; in a room a person opened, the moderator speaks first, to that person, and the others hold back until one of the two speaks to them. Every later message reaches the other members' room sessions; an employee answers with `penguin org channel send`. At the opening each employee's desk gets one line — the room, who moderates, and the room session that takes part — and nothing more. An employee invited in gets a room session at the next pass; one removed has its session closed.
- **A draft, then an establishment.** The moderator (or a person) writes the record, the body and the items; establishing checks every cite against the body's headings, archives the roadmap, and turns every roadmap item into a derived roadmap with a room of its own, discussing at once (waiting for a room only when one could not be opened).
- **A proposal only after two approvals.** At the establishment a proposal item becomes a brief and nothing more: no proposal is created, its owner is not told, and no text anywhere tells anyone to create one. It needs two approvals of that brief — **a person's** (the **Approve** button beside the item in the roadmap's column beside its room) and **the moderator's** (from its room session, which is asked for them at the establishment) — each recorded with who and when (`POST …/:n/items/:key/approve`). With both, its owner's desk gets one line: the item, who approved it and when, and what it is stacked on — and no command: creating the proposal and linking its number back (`…/items/:key/link`, refused before the approvals) are write steps the organization does where it does writes. An item that is a proposal which exists already has nothing to start, so it is not approved: a person, or a moderator that does not own it, links it to that proposal while it is still a brief, and it is delegated at once with no approvals and no desk line (from its owner's desk a brief still waits for both). A brief that changes at a later establishment starts again with no approvals. No desk line this plugin sends carries a write command.
- **An existing proposal taken in.** A proposal that already exists joins the roadmap as it is (`POST …/:n/adopt { proposal, title, owner, brief? }`, the moderator or a person, while the room discusses or once established; the page's **Add an existing proposal** offers the organization's proposals not in it yet). It is a proposal item with its number (`proposal`, no cites needed): nothing is created, nothing waits for approvals, no desk is told; an establishment delegates it and links its number at once.
- **Stacking.** A proposal item is stacked on the previous proposal item unless it names another (`stackedOn`) or none (`stackedOn: null`). When the one below links its proposal number, the owners stacked on it are told.
- **A room the organization leaves to the plugin.** While a roadmap is under discussion, its room is claimed from the organization's mention delivery (`OrganizationModule.channelClaims`): a message there is recorded and shown as in any channel, a mention in it wakes no desk, and the message is relayed to the room sessions at once. An established or shelved roadmap's room is not claimed, and its mentions reach desks again.
- **ROADMAPS in the sidebar, and the roadmap beside its room.** Company mode's sidebar has a **ROADMAPS** section below the channel list, apart from "My channels": the five most recently active roadmaps under discussion, the rest behind "Show n more", a **+** that opens a roadmap, and **All roadmaps**. A row opens the roadmap's room — the app's channel page, with the roadmap in a column on the right, drawn by the app itself from `GET …/roadmaps/:n` and re-read every 10 s: the moderator's face and name, the items first (shaped like the proposals queue: a linked item is its proposal's row, a brief shows its approvals), then the body rendered as Markdown — `proposal:<n>` is a capsule, a footnote a note. The record is not shown there. On a narrow window the stream keeps the screen and a **Roadmap** bar swaps the column in. The org nav has no Roadmaps row. **All roadmaps** is `/org/<project>/<org>/roadmaps`, a page this plugin serves itself (in an iframe): the roadmaps one line each, as the proposals list does (number, name, status, room, moderator, how many items, when it last moved; the items are on the roadmap's own detail), and an **Open a roadmap** button whose dialog goes straight to the new roadmap's room. Asked about an organization that runs on another machine, the page asks that machine through `/server/<machine>/`, so the plugin must be installed there as well. The page wears the app's look rather than one of its own: it links the app's stylesheet for framed pages (`/workflow-ui.css`), copies the app's resolved theme from the window around it — dark or light, the gray scale, the accent, the font and the font size — and follows it when it changes. It says what it is waiting for, and why when it cannot read (the HTTP status, or no answer in 15 s).
- **Reopening, names, the shelf.** An owner, an employee of the room or a person reopens an established roadmap with a reason, which reaches every room session. A roadmap has a name (renamed at will), and a discussion can be shelved (archived) and taken back.

## Boundaries

- **A room session's cost is not in the organization's budget**, as with any session opened through the gateway (the organization counts desks and ticket sessions), and a budget-paused employee is not known to the plugin; a paused organization is not relayed to.
- **A room session hears the room while it works.** A room message goes into the Task a room session is running, between its steps (`MessagingTaskRunner.steer`), and starts its next Task only when it is running none — a message queued behind a long Task would wait for that Task to end. The room session's first input also tells it not to wait for the room (no polling of the channel's files, no sleep loops) but to end its turn.
- **Relayed only where the organization runs.** A server that holds an organization as a mirror (it runs on another machine, `OrgView.machineId`) relays nothing of it: the room sessions are that machine's, and the mirror's ledger is overwritten by the next copy.
- **On an older server the relay works as it did before.** Only a machine named in `OrgView.machineId` stops the relay. A server too old to have the field relays as it always did, and a runner without `steer` has every line started as a Task.
- **The relay keeps its own depth.** A room session always sends at the organization's hop 1, so the chain limit does not stop two room sessions answering each other; the plugin's `relayDepth` does (a person's message is 0, a reply one more than what it answers).
- The desk line at the opening asks the desk not to speak in the room; nothing stops it.
- A mention in a room is taken over only while the plugin is loaded and the roadmap discusses; in any other channel, and in the room of an established roadmap, the organization delivers as always.

## Install

On a Project's Plugins page add `@prismshadow/penguin-plugin-company-roadmaps` (with `@prismshadow/penguin-plugin-company-proposals`), or list both in the Project's `.project_config.toml`:

```toml
plugins = [
  "@prismshadow/penguin-plugin-company-proposals",
  "@prismshadow/penguin-plugin-company-roadmaps",
]
```

Settings → Plugins → **Company roadmaps**: `relayDepth` (default 3) and `pollSeconds` (default 5).

## Use

A person opens a roadmap on the **Roadmaps** page, or asks an employee to open one: **Open a roadmap** → a name and one or more of the organization's employees (the first one picked moderates) → **Open**. The page sends `POST …/roadmaps`; the roadmap opens its own unlisted room with those employees and the app goes straight to its room — the channel page, where the moderator's first message is addressed to you, with the draft on the right. The employees are told the rest in their room sessions, and each desk is told which room it is in.

The same request without the page — for a script, or an employee from its session (the opener is then that employee):

```sh
curl -X POST "$API/api/projects/<project>/organizations/<org>/roadmaps" \
  -H 'content-type: application/json' \
  -d '{"name": "Queue migration", "employees": ["acme_dev", "acme_web"]}'
```

## API

`GET /api/company-roadmaps/page` — the page (HTML). `/api/projects/:projectId/organizations/:orgId/roadmaps` — `GET /[?channel=&status=]`, `POST /` (`{ name, employees, channelId?, brief?, parent? }`, a person or an employee; without `channelId` the roadmap opens its own unlisted room), `GET|PATCH /:number` (`{ name }`), `PUT /:number/draft` (`{ record?, body?, items? }`), `POST /:number/establish | reopen { reason } | room { channelId } | archive | unarchive | items/:key/approve | items/:key/link { proposal }` (`approve`: a person, or the moderator, once each, on an established roadmap's proposal item; `link`: only after both approvals). Every route answers 404 while company mode is off.

## Where things live

`<root>/<project>/organizations/<org>/roadmaps.jsonl` is the append-only ledger, written only by this plugin; `roadmaps-relay.json` beside it holds each room's cursor and the relay depths.

## Development

```sh
pnpm --filter @prismshadow/penguin-server build
pnpm --filter @prismshadow/penguin-plugin-company-roadmaps build
pnpm --filter @prismshadow/penguin-plugin-company-roadmaps test
```

`test/integration.test.ts` starts the real server with the plugin installed (`@prismshadow/penguin-plugin-test`); the rest run over fakes of the gateway and the session runtime.
