/**
 * OrgGateway.changeRoomMembers: employees in and out of a channel, for the plugin work that owns
 * it (a roadmap's room). It is the routes' invite and remove (OrganizationService's
 * addChannelMember / removeChannelMember) without their caller rule — the owning work decided who
 * is in its room, so `by` need not be a member — and limited to employees: people in the channel
 * are never touched. Called under the organization's lock; the caller reconciles afterwards.
 */
import { HttpError } from "../../http/errors.js";
import { badRequest } from "../../http/validate.js";
import { DEFAULT_CHANNEL_ID, isChannelId } from "../../organization/paths.js";
import { agentPrincipal, parsePrincipal } from "../../organization/principal.js";
import { runsOn } from "./deps.js";
import type { OrgDeps } from "./deps.js";
import type { LoadedOrg } from "./model.js";
import { channelMemberAdded, channelMemberRemoved, systemMessage } from "./notices.js";
import { appendChannelMessage } from "./reconcile.js";

export interface RoomMembersChange {
  channelId: string;
  by: string;
  add: string[];
  remove: string[];
}

/** Applies `change` to the channel's members; answers the employees that actually joined and left. */
export async function changeRoomMembers(
  deps: OrgDeps,
  org: LoadedOrg,
  change: RoomMembersChange,
): Promise<{ added: string[]; removed: string[] }> {
  const { channelId, by } = change;
  const elsewhere = runsOn(deps, org.config);
  if (elsewhere !== null) {
    throw new HttpError(
      409,
      "org_runs_elsewhere",
      `This organization runs on machine ${elsewhere}; change the room's members there.`,
    );
  }
  const notFound = (why = ""): HttpError =>
    new HttpError(404, "channel_not_found", `No channel ${channelId}${why}`);
  if (!isChannelId(channelId)) throw notFound();
  if (channelId === DEFAULT_CHANNEL_ID) {
    throw new HttpError(
      400,
      "all_hands_immutable",
      "Everyone is in the all-hands channel, and nobody leaves it.",
    );
  }
  const file = await deps.store.readChannel(org.dir, channelId);
  if (file === null) throw notFound();
  if (!file.parsed.ok) throw notFound(`: invalid channel.toml: ${file.parsed.error}`);
  const cfg = file.parsed.value;
  if (cfg.archived) {
    throw new HttpError(
      409,
      "channel_archived",
      `Channel ${channelId} is archived: unarchive it before writing to it.`,
    );
  }
  const actor = parsePrincipal(by);
  if (actor?.kind !== "agent" && actor?.kind !== "user") throw badRequest(`Not a principal: ${by}`);
  const both = change.add.find((a) => change.remove.includes(a));
  if (both !== undefined) throw badRequest(`${both} cannot be both added and removed.`);
  for (const agentId of change.add) {
    if (!org.byId.has(agentId)) {
      throw new HttpError(400, "not_an_employee", `${agentId} is not an employee of ${org.orgId}`);
    }
  }
  const before = cfg.members ?? [];
  const leaving = new Set(change.remove.map(agentPrincipal));
  const removed = before.filter((m) => leaving.has(m));
  const members = before.filter((m) => !leaving.has(m));
  const added: string[] = [];
  for (const agentId of change.add) {
    const principal = agentPrincipal(agentId);
    if (members.includes(principal)) continue;
    members.push(principal);
    added.push(principal);
  }
  if (added.length === 0 && removed.length === 0) return { added: [], removed: [] };
  await deps.store.writeChannel(org.dir, channelId, { ...cfg, members });
  for (const principal of removed) {
    await appendChannelMessage(
      deps,
      org,
      channelId,
      systemMessage(channelMemberRemoved(by, principal)),
    );
  }
  for (const principal of added) {
    await appendChannelMessage(
      deps,
      org,
      channelId,
      systemMessage(channelMemberAdded(by, principal)),
    );
  }
  const id = (p: string): string => p.slice("agent:".length);
  return { added: added.map(id), removed: removed.map(id) };
}
