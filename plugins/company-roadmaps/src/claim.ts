/**
 * The channel claim: the organization's question, before it delivers a channel's mentions to
 * desks, whether this plugin handles the channel itself (`OrganizationModule.channelClaims`).
 * It does for the room of a roadmap under discussion — the message stays in the room and no
 * desk is woken; the room sessions receive it through the relay.
 *
 * It lives apart from the service because of where it sits in the tree: the organization
 * module depends on what is contributed to it, so the node that contributes the claim cannot
 * require the organization gateway that module provides (that is a cycle, which the tree
 * refuses to boot). This node therefore needs only the data root: it answers from the ledger
 * file itself, read afresh at every question (the question comes once per channel per
 * organization pass, and only for a channel with new messages), so it never answers from a
 * stale copy of what the service wrote. What it claims is handed to the listeners the service
 * registers — through this module's scope, which the two nodes of one bundle share — so the
 * message is relayed at once rather than at the next poll.
 */
import { readFileSync } from "node:fs";
import { foldLedger, ledgerPath, parseLedger } from "./ledger.js";

export interface ChannelRef {
  projectId: string;
  orgId: string;
  channelId: string;
}

export type ClaimListener = (channel: ChannelRef, number: number) => void;

/** The service's listeners: registered at its setup, removed when its App stops. */
export const claimListeners = new Set<ClaimListener>();

/** The number of the roadmap under discussion (not archived) whose room this channel is, or null. */
export function discussingRoomOf(root: string, channel: ChannelRef): number | null {
  let text: string;
  try {
    text = readFileSync(ledgerPath(root, channel.projectId, channel.orgId), "utf8");
  } catch {
    return null;
  }
  for (const r of foldLedger(parseLedger(text).lines).roadmaps.values()) {
    if (r.channelId === channel.channelId && r.status === "discussing" && !r.archived) {
      return r.number;
    }
  }
  return null;
}

/** The claim a node binds: claims a discussing room and hands it to `handle`; anything else is not claimed. */
export function roomClaim(
  root: string,
  handle: ClaimListener,
): (channel: ChannelRef) => boolean {
  return (channel) => {
    const number = discussingRoomOf(root, channel);
    if (number === null) return false;
    handle(channel, number);
    return true;
  };
}
