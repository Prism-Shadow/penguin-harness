/**
 * Every text this plugin puts on an employee's desk: the line that puts it in a roadmap's room,
 * and the lines an establishment, an approval, a link or a reopening sends.
 *
 * The room is an ordinary channel and its members take part from their desks, so the lines
 * about the room's own work carry the commands that answer them: `penguin org channel send`,
 * and the roadmap Actions (`POST …/actions/<key>/runs`) through `curl` with the session's
 * control environment (`PENGUIN_API_URL`, `PENGUIN_API_TOKEN`, `PENGUIN_PROJECT_ID`,
 * `PENGUIN_SESSION_ID`, `PENGUIN_AGENT_ID`), whose `sessionId`/`agentId` claims attribute the
 * run to the employee: the draft, the establishment, the moderator's approval of a proposal
 * item. A line about a later step — an item approved, a base linked — says only what happened
 * and what it means, with no write command; and no text anywhere tells anyone to create a
 * proposal card: the proposal of an item is created by its last approval, not by this plugin's
 * words.
 */
import type { DraftItem, Roadmap } from "./domain.js";

/** The route of a roadmap, as a session's shell spells it. */
export function routeOf(orgId: string, number: number | null, suffix = ""): string {
  const base = `$PENGUIN_API_URL/api/projects/$PENGUIN_PROJECT_ID/organizations/${orgId}/roadmaps`;
  return `${base}${number === null ? "" : `/${number}`}${suffix}`;
}

/** The route that runs an Action, as a session's shell spells it. */
export function actionRouteOf(orgId: string, key: string): string {
  return `$PENGUIN_API_URL/api/projects/$PENGUIN_PROJECT_ID/organizations/${orgId}/actions/${key}/runs`;
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

/** A `curl` running Action `key` on `subject` with `params` (literal JSON members), as the session. */
export function curlActionOf(
  orgId: string,
  key: string,
  subject: string,
  params: string[] = [],
): string {
  return curlOf("POST", actionRouteOf(orgId, key), [
    `\\"subject\\":\\"${subject}\\"`,
    `\\"params\\":{${params.join(",")}}`,
  ]);
}

/** The same, with the body read from a JSON file the employee writes (claims included by them). */
export function curlFileOf(method: string, url: string, file: string): string {
  return `curl -sS -X ${method} "${url}" -H "authorization: Bearer $PENGUIN_API_TOKEN" -H "content-type: application/json" --data @${file}`;
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
 * The line an employee's desk gets when a roadmap's opener puts it in its room — or, with
 * `addedBy`, when a change of members does, or when a room is bound to a roadmap waiting for
 * one: where it is, who moderates, how to speak there, and — for the moderator — how to keep
 * the draft and establish the roadmap. The room is an ordinary channel: a message there reaches
 * this desk when it mentions you.
 */
export function roomJoinedLine(args: {
  orgId: string;
  roadmap: Roadmap;
  agentId: string;
  moderator: string;
  addedBy?: string;
}): string {
  const { orgId, roadmap: r, agentId, moderator } = args;
  const channel = r.channelId ?? "";
  const moderating = agentId === moderator;
  const role = moderating ? "you moderate" : `${moderator} moderates`;
  const how =
    args.addedBy === undefined
      ? `${r.createdBy} opened this roadmap and put you in its room`
      : `${args.addedBy} made you a member of this roadmap, in its room`;
  const lines = [
    `${tag(r)} ${how} \`${channel}\` of organization \`${orgId}\` (${role}). Topic: ${r.brief || r.name}`,
    `The room is an ordinary channel: a message there reaches this desk when it mentions you. Speak with \`penguin org channel send --org-id ${orgId} --channel ${channel} -m "<text>"\`.`,
    `Read the roadmap: \`curl -sS "${routeOf(orgId, r.number)}" -H "authorization: Bearer $PENGUIN_API_TOKEN"\`.`,
  ];
  // A room a person opened starts with that person: the moderator speaks first, to them, and
  // the others hold back until the question is agreed — or until someone speaks to them.
  const opener = r.createdBy.startsWith("user:") ? r.createdBy : null;
  if (opener !== null && args.addedBy === undefined) {
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
        `  write draft.json: {"sessionId": "$PENGUIN_SESSION_ID", "agentId": "$PENGUIN_AGENT_ID", "subject": "roadmap:${r.number}", "params": {"record": "...", "body": "...", "items": [{"key": "a", "kind": "proposal", "title": "...", "brief": "...", "owner": "<agent id>", "cites": ["<body section heading>"]}, {"key": "b", "kind": "roadmap", "title": "...", "brief": "...", "employees": ["<agent id>"], "cites": ["..."]}]}}`,
        "  (substitute the two variables' values; any of record/body/items may be left out; a proposal item is stacked on the previous one unless it says `stackedOn`)",
        "  The body is shown as Markdown beside the room: cite a proposal as `proposal:<n>` (it becomes a link to that proposal), and add a note as a footnote (`…[^1]` in the text, `[^1]: the note` below).",
        `  ${curlFileOf("POST", actionRouteOf(orgId, "roadmap.draft"), "draft.json")}`,
        'A proposal that exists already is taken in as it is, not written again: it is a proposal item with its number (`"proposal": <n>`, no cites needed) — keep such an item in the items you write. To take one in:',
        `  ${curlActionOf(orgId, "roadmap.adopt", `roadmap:${r.number}`, ['\\"proposal\\":<n>', '\\"title\\":\\"<its title>\\"', '\\"owner\\":\\"<agent id>\\"'])}`,
        "Nothing is created while the room discusses. When the room agrees, establish it — every roadmap item derives its own roadmap at once, but a proposal item stays a brief: nothing is created for it, and its owner is not told, until it has its approvals (yours as moderator and one other member's, unless the organization says otherwise):",
        `  ${curlActionOf(orgId, "roadmap.establish", `roadmap:${r.number}`)}`,
      ].join("\n"),
    );
  }
  if (r.record !== "" || r.items.length > 0) {
    lines.push(
      `The draft so far:\n${r.record}${r.items.length > 0 ? `\n${r.items.map(itemLine).join("\n")}` : ""}`,
    );
  }
  return lines.join("\n\n");
}

/**
 * The line the moderator's desk gets when the roadmap is established with proposal
 * items: they are briefs now, each waiting for its approvals — the moderator's (this command)
 * and another member's, unless the organization binds other roles. Approving says the brief is
 * ready to become a proposal; the last approval creates it.
 */
export function approvalRequestLine(args: {
  orgId: string;
  roadmap: Roadmap;
  items: ReadonlyArray<DraftItem & { kind: "proposal" }>;
}): string {
  const { orgId, roadmap: r } = args;
  return [
    `${tag(r)} established. Its proposal items are briefs now; each needs its approvals — yours as moderator and another member's, unless the organization binds other roles — and the last creates its proposal:`,
    ...args.items.map((i) => `- [${i.key}] "${i.title}" — owner ${i.owner}: ${i.brief}`),
    `Approve an item whose brief is ready: \`${curlActionOf(orgId, "roadmap.item.approve", `item:${r.number}/<key>`)}\`. The last approval creates the item's proposal, its owner the author, and links it; leave an item unapproved, or reopen the roadmap, when its brief is not ready.`,
    `An item that is a proposal which exists already is not approved — there is no work to start: link it to that proposal, which delegates it without the approvals and tells its owner nothing (an item you own yourself is linked by someone else): \`${curlActionOf(orgId, "roadmap.item.link", `item:${r.number}/<key>`, ['\\"proposal\\":<n>'])}\`.`,
  ].join("\n");
}

/**
 * The desk line telling an owner that its proposal item was approved — each approval named,
 * with its role and when — that its proposal is created and linked, with the number, and what it
 * is stacked on. It carries no command: the proposal is written in the step the
 * organization assigns for it. `rebriefed`: the item's changed brief was approved again and
 * the open proposal it is linked to got the new brief instead of a second proposal being made.
 */
export function approvedLine(args: {
  roadmap: Roadmap;
  item: DraftItem & { kind: "proposal" };
  base: { title: string; proposal?: number } | null;
  approvals: ReadonlyArray<{ role: string; by: string; at: string }>;
  proposal: number;
  rebriefed?: boolean;
}): string {
  const { roadmap: r, item, base } = args;
  const stacked =
    base === null
      ? "It is not stacked on another proposal of this roadmap."
      : base.proposal !== undefined
        ? `It is stacked on "${base.title}" — proposal #${base.proposal}: base your branch on that one's.`
        : `It is stacked on "${base.title}", which has no proposal number yet; you will be told when it has.`;
  return [
    `${tag(r)} Your item [${item.key}] "${item.title}" is approved: ${args.approvals.map((a) => `by ${a.by} as ${a.role} (${a.at})`).join(" and ")}.`,
    `Brief: ${item.brief}`,
    stacked,
    args.rebriefed === true
      ? `No new proposal is created: proposal #${args.proposal}, linked to this item, has this brief now in place of the old one (its revisions, comments and approvals stand). Revising it to match is a write step: it is done where your organization does write steps, not from this desk.`
      : `Its proposal is created for you: proposal #${args.proposal}, with you as its author and this brief, linked to this item. Writing it is a write step: it is done where your organization does write steps, not from this desk.`,
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
    "Its room could not be opened yet, so it waits for one. Nothing is needed from this desk; when a room is bound to it, you are told.",
  ].join("\n");
}

/** The desk line telling a derived roadmap's moderator that its room is open already. */
export function roomOpenedLine(args: { parent: Roadmap; child: Roadmap }): string {
  const { parent, child } = args;
  return [
    `${tag(parent)} established; it derives ${tag(child)}, which you moderate. Brief: ${child.brief}`,
    `Its room is open — the channel \`${child.channelId ?? ""}\`, with ${child.employees.join(", ")} — where a message that mentions you reaches this desk.`,
  ].join("\n");
}

/** The line a reopening puts on every member's desk. */
export function reopenLine(r: Roadmap, by: string, reason: string, moderator: string): string {
  return `${tag(r)} reopened by ${by}: ${reason}\n\nThe room is discussing again. ${moderator === "" ? "" : `${moderator}, as moderator: put this in the room and revise the draft.`}`.trimEnd();
}
