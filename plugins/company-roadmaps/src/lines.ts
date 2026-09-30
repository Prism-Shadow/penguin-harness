/**
 * Every text this plugin puts in front of an employee: the first input of a room session, a
 * relayed room message, and the lines an establishment, an approval, a link or a reopening puts
 * on a desk.
 *
 * Two kinds of reader, two rules. A **room session** (the moderator's above all) works the
 * roadmap itself, so its texts carry the commands that answer them: `penguin org channel send`,
 * and this plugin's routes through `curl` with the session's control environment
 * (`PENGUIN_API_URL`, `PENGUIN_API_TOKEN`, `PENGUIN_PROJECT_ID`, `PENGUIN_SESSION_ID`,
 * `PENGUIN_AGENT_ID`), whose `sessionId`/`agentId` claims attribute the write to the employee:
 * the draft, the establishment, the moderator's approval of a proposal item. A **desk** gets
 * only what happened and what it means. No desk line carries a write command, and no text
 * anywhere tells anyone to create a proposal card: the proposal of an item is opened only after a
 * person and the moderator both approved its brief, by whoever the organization assigns that
 * step to, not by this plugin's words.
 */
import type { DraftItem, Roadmap } from "./ledger.js";
import type { RoomMessage } from "./room.js";

/** The route of a roadmap, as a session's shell spells it. */
export function routeOf(orgId: string, number: number | null, suffix = ""): string {
  const base = `$PENGUIN_API_URL/api/projects/$PENGUIN_PROJECT_ID/organizations/${orgId}/roadmaps`;
  return `${base}${number === null ? "" : `/${number}`}${suffix}`;
}

/** A `curl` that sends `fields` (literal JSON members) with the session's identity claim. */
export function curlOf(method: string, url: string, fields: string[] = []): string {
  const claim = [
    '\\"sessionId\\":\\"$PENGUIN_SESSION_ID\\"',
    '\\"agentId\\":\\"$PENGUIN_AGENT_ID\\"',
  ];
  const body = [...claim, ...fields].join(",");
  return `curl -sS -X ${method} "${url}" -H "authorization: Bearer $PENGUIN_API_TOKEN" -H "content-type: application/json" -d "{${body}}"`;
}

/** The same, with the body read from a JSON file the employee writes (claims included by them). */
export function curlFileOf(method: string, url: string, file: string): string {
  return `curl -sS -X ${method} "${url}" -H "authorization: Bearer $PENGUIN_API_TOKEN" -H "content-type: application/json" --data @${file}`;
}

function quote(msg: RoomMessage): string {
  return `> ${msg.time} ${msg.sender}: ${msg.text.replace(/\n/g, "\n> ")}`;
}

function itemLine(item: DraftItem): string {
  return item.kind === "proposal"
    ? `- [${item.key}] proposal ${item.proposal !== undefined ? `#${item.proposal} (existing) ` : ""}"${item.title}" — owner ${item.owner}: ${item.brief}`
    : `- [${item.key}] roadmap "${item.title}" — employees ${item.employees.join(", ")}: ${item.brief}`;
}

export function tag(r: Pick<Roadmap, "number" | "name">): string {
  return `[roadmap #${r.number} «${r.name}»]`;
}

/**
 * The first input of an employee's room session — the desk cloned for this room: who it is
 * in the room, how to speak there, what the moderator keeps, and the room so far.
 */
export function cloneBrief(args: {
  orgId: string;
  roadmap: Roadmap;
  agentId: string;
  moderator: string;
  members: string[];
  recent: RoomMessage[];
}): string {
  const { orgId, roadmap: r, agentId, moderator } = args;
  const channel = r.channelId ?? "";
  const moderating = agentId === moderator;
  const lines = [
    `${tag(r)} This session is your desk, cloned for one discussion: the room \`${channel}\` of organization \`${orgId}\`. Everything said in the room reaches you here, and only here; your own desk is not told.`,
    `Topic: ${r.brief || r.name}`,
    `In the room: ${args.members.join(", ")}. Moderator: ${moderator}${moderating ? " (you)" : ""}.`,
    `Speak with \`penguin org channel send --org-id ${orgId} --channel ${channel} -m "<text>"\`. Every member reads every message here, so a mention is not needed; while the room discusses, a mention reaches this room and wakes no one's desk.`,
    "Do not wait for the room. Every room message comes to this session as input — while you work too — so do not poll the channel's files, sleep in a loop or wait in a command for an answer: say what you have to say, finish what you are doing, and end your turn; the next message starts your next one.",
    `Read the roadmap: \`curl -sS "${routeOf(orgId, r.number)}" -H "authorization: Bearer $PENGUIN_API_TOKEN"\`.`,
  ];
  // A room a person opened starts with that person: the moderator speaks first, to them, and
  // the others hold back until the question is agreed — or until someone speaks to them.
  const opener = r.createdBy.startsWith("user:") ? r.createdBy : null;
  const started = args.recent.some((m) => m.sender === `agent:${moderator}`);
  if (opener !== null && !started) {
    lines.push(
      moderating
        ? `Open the room: ${opener} (a person) opened this roadmap. Before anything else, send one message in the room to @${opener} — who is here, the topic in a sentence, and what you need to know from them first: what they want from this roadmap, and what is out of it. Settle the question with them, then bring the others in.`
        : `The room opens with ${moderator} and ${opener} (the person who opened it) settling the question. Until one of them speaks to you, take the room in and do not answer.`,
    );
  }
  if (moderating) {
    lines.push(
      [
        "You moderate. Keep the draft as the discussion moves — your record of it, the body (the discussion written as a paper, in `## ` sections) and the items it leads to, each only a brief:",
        '  write draft.json: {"sessionId": "$PENGUIN_SESSION_ID", "agentId": "$PENGUIN_AGENT_ID", "record": "...", "body": "...", "items": [{"key": "a", "kind": "proposal", "title": "...", "brief": "...", "owner": "<agent id>", "cites": ["<body section heading>"]}, {"key": "b", "kind": "roadmap", "title": "...", "brief": "...", "employees": ["<agent id>"], "cites": ["..."]}]}',
        "  (substitute the two variables' values; any of record/body/items may be left out; a proposal item is stacked on the previous one unless it says `stackedOn`)",
        "  The body is shown as Markdown beside the room: cite a proposal as `proposal:<n>` (it becomes a link to that proposal), and add a note as a footnote (`…[^1]` in the text, `[^1]: the note` below).",
        `  ${curlFileOf("PUT", routeOf(orgId, r.number, "/draft"), "draft.json")}`,
        'A proposal that exists already is taken in as it is, not written again: it is a proposal item with its number (`"proposal": <n>`, no cites needed) — keep such an item in the items you write. To take one in:',
        `  ${curlOf("POST", routeOf(orgId, r.number, "/adopt"), ['\\"proposal\\":<n>', '\\"title\\":\\"<its title>\\"', '\\"owner\\":\\"<agent id>\\"'])}`,
        "Nothing is created while the room discusses. When the room agrees, establish it — every roadmap item derives its own roadmap at once, but a proposal item stays a brief: nothing is created for it, and its owner is not told, until a person and you (the moderator) have both approved it:",
        `  ${curlOf("POST", routeOf(orgId, r.number, "/establish"))}`,
      ].join("\n"),
    );
  }
  if (r.record !== "" || r.items.length > 0) {
    lines.push(
      `The draft so far:\n${r.record}${r.items.length > 0 ? `\n${r.items.map(itemLine).join("\n")}` : ""}`,
    );
  }
  if (args.recent.length > 0) lines.push(`The room so far:\n${args.recent.map(quote).join("\n")}`);
  return lines.join("\n\n");
}

/**
 * The line an employee's desk gets when a roadmap's opener puts it in its room: where it is, who
 * moderates, and that the room session — not this desk — takes part.
 */
export function roomJoinedLine(args: {
  roadmap: Roadmap;
  agentId: string;
  moderator: string;
  sessionId: string | null;
}): string {
  const { roadmap: r, agentId, moderator } = args;
  const role = agentId === moderator ? "you moderate" : `${moderator} moderates`;
  const session =
    args.sessionId === null
      ? "Your room session opens at the plugin's next pass"
      : `Your room session \`${args.sessionId}\` takes part`;
  return `${tag(r)} ${r.createdBy} opened this roadmap and put you in its room \`${r.channelId ?? ""}\` (${role}). ${session}; nothing is needed from this desk, and do not speak in the room from here.`;
}

/** One room message, relayed into a room session. */
export function relayLine(r: Roadmap, msg: RoomMessage): string {
  return `${tag(r)} room \`${r.channelId ?? ""}\` — ${msg.sender} at ${msg.time}:\n${msg.text}`;
}

/**
 * The input the moderator's room session gets when the roadmap is established with proposal
 * items: they are briefs now, each waiting for two approvals — a person's (on the roadmaps page)
 * and the moderator's (this command). Approving says the brief is ready to become a proposal;
 * it creates nothing.
 */
export function approvalRequestLine(args: {
  orgId: string;
  roadmap: Roadmap;
  items: ReadonlyArray<DraftItem & { kind: "proposal" }>;
}): string {
  const { orgId, roadmap: r } = args;
  return [
    `${tag(r)} established. Its proposal items are briefs now; each needs two approvals, and the second creates its proposal — a person's, given on the roadmaps page, and yours as moderator:`,
    ...args.items.map((i) => `- [${i.key}] "${i.title}" — owner ${i.owner}: ${i.brief}`),
    `Approve an item whose brief is ready: \`${curlOf("POST", routeOf(orgId, r.number, "/items/<key>/approve"))}\`. The second approval — a person's and yours — creates the item's proposal, its owner the author, and links it; leave an item unapproved, or reopen the roadmap, when its brief is not ready.`,
    `An item that is a proposal which exists already is not approved — there is no work to start: link it to that proposal, which delegates it without the two approvals and tells its owner nothing (an item you own yourself is linked by a person): \`${curlOf("POST", routeOf(orgId, r.number, "/items/<key>/link"), ['\\"proposal\\":<n>'])}\`.`,
  ].join("\n");
}

/**
 * The desk line telling an owner that its proposal item was approved — by a person and by the
 * moderator, named with when — that its proposal is created and linked, with the number, and
 * what it is stacked on. It carries no command: the proposal is written in the step the
 * organization assigns for it.
 */
export function approvedLine(args: {
  roadmap: Roadmap;
  item: DraftItem & { kind: "proposal" };
  base: { title: string; proposal?: number } | null;
  person: { by: string; at: string };
  moderator: { by: string; at: string };
  proposal: number;
}): string {
  const { roadmap: r, item, base } = args;
  const stacked =
    base === null
      ? "It is not stacked on another proposal of this roadmap."
      : base.proposal !== undefined
        ? `It is stacked on "${base.title}" — proposal #${base.proposal}: base your branch on that one's.`
        : `It is stacked on "${base.title}", which has no proposal number yet; you will be told when it has.`;
  return [
    `${tag(r)} Your item [${item.key}] "${item.title}" is approved: by ${args.person.by} (${args.person.at}) and by the moderator ${args.moderator.by} (${args.moderator.at}).`,
    `Brief: ${item.brief}`,
    stacked,
    `Its proposal is created for you: proposal #${args.proposal}, with you as its author and this brief, linked to this item. Writing it is a write step: it is done where your organization does write steps, not from this desk.`,
  ].join("\n");
}

/** The desk line telling a stacked proposal's owner the number of the one it is stacked on. */
export function baseLinkedLine(
  r: Roadmap,
  item: DraftItem,
  base: DraftItem,
  proposal: number,
): string {
  return `${tag(r)} "${base.title}", which your item [${item.key}] "${item.title}" is stacked on, is proposal #${proposal} now: base your branch on that one's.`;
}

/**
 * The desk line telling a derived roadmap's moderator that its room could not be opened. It
 * carries no command: a room is opened, and bound to the roadmap, by a person or in the step the
 * organization assigns for writes.
 */
export function roomRequestLine(args: { parent: Roadmap; child: Roadmap }): string {
  const { parent, child } = args;
  return [
    `${tag(parent)} established; it derives ${tag(child)}, which you moderate, with ${child.employees.join(", ")}. Brief: ${child.brief}`,
    "Its room could not be opened yet, so it waits for one. Nothing is needed from this desk; when a room is bound to it, your room session there starts on its own.",
  ].join("\n");
}

/** The desk line telling a derived roadmap's moderator that its room is open already. */
export function roomOpenedLine(args: { parent: Roadmap; child: Roadmap }): string {
  const { parent, child } = args;
  return [
    `${tag(parent)} established; it derives ${tag(child)}, which you moderate. Brief: ${child.brief}`,
    `Its room is open — the channel \`${child.channelId ?? ""}\`, with ${child.employees.join(", ")} — and your room session there starts on its own.`,
  ].join("\n");
}

/** The input a reopening puts in every open room session. */
export function reopenLine(r: Roadmap, by: string, reason: string, moderator: string): string {
  return `${tag(r)} reopened by ${by}: ${reason}\n\nThe room is discussing again. ${moderator === "" ? "" : `${moderator}, as moderator: put this in the room and revise the draft.`}`.trimEnd();
}
