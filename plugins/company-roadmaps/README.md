# Company roadmaps

Roadmaps for company mode: a person puts **one or more employees in a room** — an ordinary organization channel — to discuss something too big for one proposal. Each employee takes part through **its desk cloned for that room**: a session of its own that receives everything said in the room, and only that. The first employee named moderates and keeps the **draft**: a record of the discussion, a **body** written as a paper, and the **items** it leads to — proposals (a brief and an owner, stacked on one another) and roadmaps (a brief and the employees who discuss them), each citing the body sections it draws on. Nothing is created while the room discusses. **Establishing** the roadmap archives it and delegates every item at once; an owner who finds, while building, that the roadmap lacks something it needs **reopens** the room.

It depends on [company-proposals](../company-proposals/README.md): a delegated proposal is created there by its owner and linked back.

## What you get

- **A room that is a channel.** Nothing of chat is implemented here: the room is created, joined, invited to, removed from and archived with the channel's own commands and page. The plugin only reads the channel — its members, and its messages by a cursor — and never writes to it.
- **The desk, cloned for the room.** For every employee in the room the plugin opens a session of that employee's Agent (the way a ticket session opens) whose first input is the room: who is in it, who moderates, the last messages, how to speak there. Every later message reaches the other members' room sessions; an employee answers with `penguin org channel send`. An employee invited in gets a room session at the next pass; one removed has its session closed.
- **A draft, then an establishment.** The moderator (or a person) writes the record, the body and the items; establishing checks every cite against the body's headings, archives the roadmap, puts one line on each proposal owner's desk — the brief, what it is stacked on, and the commands to create and link it — and turns every roadmap item into a derived roadmap waiting for its room.
- **Stacking.** A proposal item is stacked on the previous proposal item unless it names another (`stackedOn`) or none (`stackedOn: null`). When the one below links its proposal number, the owners stacked on it are told.
- **A room the organization leaves to the plugin.** While a roadmap is under discussion, its room is claimed from the organization's mention delivery (`OrganizationModule.channelClaims`): a message there is recorded and shown as in any channel, a mention in it wakes no desk, and the message is relayed to the room sessions at once. An established or shelved roadmap's room is not claimed, and its mentions reach desks again.
- **An entry after the handbook.** Company mode's sidebar shows a **Roadmaps** row after the organization's own pages; it opens `/org/<project>/<org>/roadmaps`, a read-only page this plugin serves itself (in an iframe): the roadmaps with their status, room, items and owners, and one roadmap's record and body.
- **Reopening, names, the shelf.** An owner, an employee of the room or a person reopens an established roadmap with a reason, which reaches every room session. A roadmap has a name (renamed at will), and a discussion can be shelved (archived) and taken back.

## Boundaries

- **A room session's cost is not in the organization's budget**, as with any session opened through the gateway (the organization counts desks and ticket sessions), and a budget-paused employee is not known to the plugin; a paused organization is not relayed to.
- **The relay keeps its own depth.** A room session always sends at the organization's hop 1, so the chain limit does not stop two room sessions answering each other; the plugin's `relayDepth` does (a person's message is 0, a reply one more than what it answers).
- The draft beside the room on the channel page is not part of this package: the channel page can read `GET …/roadmaps?channel=<id>`.
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

A person opens a roadmap over a room whose members already include the employees:

```sh
penguin org channel create room_queue --name "Queue migration"
penguin org channel invite room_queue agent:acme_dev agent:acme_web
curl -X POST "$API/api/projects/<project>/organizations/<org>/roadmaps" \
  -H 'content-type: application/json' \
  -d '{"name": "Queue migration", "channelId": "room_queue", "employees": ["acme_dev", "acme_web"]}'
```

The employees are told the rest in their room sessions and on their desks.

## API

`GET /api/company-roadmaps/page` — the page (HTML). `/api/projects/:projectId/organizations/:orgId/roadmaps` — `GET /[?channel=&status=]`, `POST /` (`{ name, channelId, employees, brief?, parent? }`, a person), `GET|PATCH /:number` (`{ name }`), `PUT /:number/draft` (`{ record?, body?, items? }`), `POST /:number/establish | reopen { reason } | room { channelId } | archive | unarchive | items/:key/link { proposal }`. Every route answers 404 while company mode is off.

## Where things live

`<root>/<project>/organizations/<org>/roadmaps.jsonl` is the append-only ledger, written only by this plugin; `roadmaps-relay.json` beside it holds each room's cursor and the relay depths.

## Development

```sh
pnpm --filter @prismshadow/penguin-server build
pnpm --filter @prismshadow/penguin-plugin-company-roadmaps build
pnpm --filter @prismshadow/penguin-plugin-company-roadmaps test
```

`test/integration.test.ts` starts the real server with the plugin installed (`@prismshadow/penguin-plugin-test`); the rest run over fakes of the gateway and the session runtime.
