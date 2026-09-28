/**
 * Every text this plugin puts in front of an employee: the first input of a room session, a
 * relayed room message, and the lines an establishment, a link or a reopening puts on a desk.
 * Each carries the commands that answer it — the organization's own `penguin org channel`
 * and `penguin org proposal`, and this plugin's routes through `curl` with the session's
 * control environment (`PENGUIN_API_URL`, `PENGUIN_API_TOKEN`, `PENGUIN_PROJECT_ID`,
 * `PENGUIN_SESSION_ID`, `PENGUIN_AGENT_ID`), whose `sessionId`/`agentId` claims attribute the
 * write to the employee.
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
    ? `- [${item.key}] proposal "${item.title}" — owner ${item.owner}: ${item.brief}`
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
    `Read the roadmap: \`curl -sS "${routeOf(orgId, r.number)}" -H "authorization: Bearer $PENGUIN_API_TOKEN"\`.`,
  ];
  if (moderating) {
    lines.push(
      [
        "You moderate. Keep the draft as the discussion moves — your record of it, the body (the discussion written as a paper, in `## ` sections) and the items it leads to, each only a brief:",
        '  write draft.json: {"sessionId": "$PENGUIN_SESSION_ID", "agentId": "$PENGUIN_AGENT_ID", "record": "...", "body": "...", "items": [{"key": "a", "kind": "proposal", "title": "...", "brief": "...", "owner": "<agent id>", "cites": ["<body section heading>"]}, {"key": "b", "kind": "roadmap", "title": "...", "brief": "...", "employees": ["<agent id>"], "cites": ["..."]}]}',
        "  (substitute the two variables' values; any of record/body/items may be left out; a proposal item is stacked on the previous one unless it says `stackedOn`)",
        `  ${curlFileOf("PUT", routeOf(orgId, r.number, "/draft"), "draft.json")}`,
        "Nothing is created while the room discusses. When the room agrees, establish it — the roadmap is archived and every proposal item goes to its owner at once:",
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

/** One room message, relayed into a room session. */
export function relayLine(r: Roadmap, msg: RoomMessage): string {
  return `${tag(r)} room \`${r.channelId ?? ""}\` — ${msg.sender} at ${msg.time}:\n${msg.text}`;
}

/** The desk line that delegates one proposal item to its owner. */
export function delegationLine(args: {
  orgId: string;
  roadmap: Roadmap;
  item: DraftItem & { kind: "proposal" };
  base: { title: string; proposal?: number } | null;
  revised: boolean;
}): string {
  const { orgId, roadmap: r, item, base } = args;
  const stacked =
    base === null
      ? "It is not stacked on another proposal of this roadmap."
      : base.proposal !== undefined
        ? `It is stacked on "${base.title}" — proposal #${base.proposal}: base your branch on that one's.`
        : `It is stacked on "${base.title}", which has no proposal number yet; you will be told when it has.`;
  return [
    `${tag(r)} ${args.revised ? "The brief of your item changed at the new establishment" : "The roadmap is established and you own one of its proposals"}: [${item.key}] "${item.title}".`,
    `Brief: ${item.brief}`,
    stacked,
    `Create it: \`penguin org proposal create --org-id ${orgId} --author ${item.owner} --title "${item.title}" --brief "<the brief above>"\`, then link its number back: \`${curlOf("POST", routeOf(orgId, r.number, `/items/${item.key}/link`), ['\\"proposal\\":<number>'])}\`.`,
    `If building it shows the roadmap lacks something it needs, reopen the room: write reopen.json {"sessionId": "$PENGUIN_SESSION_ID", "agentId": "$PENGUIN_AGENT_ID", "reason": "..."} and \`${curlFileOf("POST", routeOf(orgId, r.number, "/reopen"), "reopen.json")}\`.`,
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

/** The desk line asking a derived roadmap's moderator to open its room. */
export function roomRequestLine(args: { orgId: string; parent: Roadmap; child: Roadmap }): string {
  const { orgId, parent, child } = args;
  const invite = child.employees.map((e) => `agent:${e}`).join(" ");
  return [
    `${tag(parent)} established; it derives ${tag(child)}, which you moderate. Brief: ${child.brief}`,
    `Open its room with the channel commands — \`penguin org channel create --org-id ${orgId} <channel_id> --name "${child.name}"\`, \`penguin org channel invite --org-id ${orgId} <channel_id> ${invite}\` — then bind it: \`${curlOf("POST", routeOf(orgId, child.number, "/room"), ['\\"channelId\\":\\"<channel_id>\\"'])}\`.`,
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
