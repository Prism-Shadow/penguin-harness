/**
 * The channel a Session's ENABLED messaging binding connects, or null when none is enabled —
 * the one reading behind every row mark that says "this Session relays to a bot": the
 * development list's `SessionInfo.messagingChannel` and the company sidebar's
 * `OrgDeskItem.messagingChannel`. A saved-but-disabled config marks nothing, and neither does
 * a stored channel id that is not a `MessagingChannel`.
 */
import type { MessagingChannel } from "../../api/types.js";
import type { MessagingBindings } from "../../mechanisms/messaging.js";

/**
 * Every channel id, keyed so that a `MessagingChannel` added without an entry here fails
 * typecheck instead of silently losing its row mark.
 */
const MESSAGING_CHANNEL_IDS = {
  feishu: true,
  telegram: true,
  qq: true,
  wechat: true,
} as const satisfies Record<MessagingChannel, true>;

/** Whether a stored channel discriminator — untrusted text in the DB — names a known channel. */
export function isMessagingChannel(channel: string): channel is MessagingChannel {
  return Object.hasOwn(MESSAGING_CHANNEL_IDS, channel);
}

export function enabledMessagingChannel(
  bindings: Pick<MessagingBindings, "findEnabled">,
  sessionId: string,
): MessagingChannel | null {
  const enabled = bindings.findEnabled(sessionId);
  return enabled !== null && isMessagingChannel(enabled.channel) ? enabled.channel : null;
}
