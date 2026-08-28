/**
 * The channel-shaped half of the messaging HTTP surface, so the routes beside it can stop
 * asking which channel they are serving.
 *
 * `runtime/messaging/connector.ts` already does this for the RUNTIME: a connector owns its
 * wire protocol and hands the bridge a channel-neutral view. The HTTP layer had no such seam,
 * so every one of its six endpoints was written three times and each new saved field was
 * written three more. What differs between channels here is small and enumerable — which
 * credential field a PUT reads, how an account identity is derived from it, and how a stored
 * row masks into its wire shape — and that is what a {@link MessagingChannelSpec} carries.
 *
 * **This is not the connector's config parser, and must not be merged with it.** The two run
 * in opposite directions: a connector reads a STORED document to build a client, while this
 * reads a REQUEST to decide what to store, and rejects what the connector would only find
 * malformed later. They share knowledge of a document's shape and nothing else, and collapsing
 * them would put request validation inside the runtime.
 *
 * What deliberately stays hand-written in `messaging.ts`: each channel's PUT and its
 * credential test. Their SHAPE is shared — `resolveSecret` below is the ladder all three climb
 * — but the order their inputs are validated in, and how an account id falls out of a
 * credential, genuinely differ, and a table that hid that would only move the difference
 * somewhere harder to read.
 */
import { HttpError } from "../errors.js";
import { optionalBoolean } from "../validate.js";
import { maskApiKey } from "../../services/project-config-service.js";
import type { MessagingBindingRow } from "../../db/repos/messaging-bindings.js";
import type { MessagingChannel } from "../../runtime/messaging/connector.js";
import type {
  MessagingBindingCommon,
  MessagingBindingInfo,
  MessagingDeliveryPatch,
} from "../../api/types.js";

/**
 * One channel's contribution to the shared HTTP surface.
 *
 * Everything a channel does NOT appear in is the point: the read, the state toggle, the
 * delete and the test message are written once against this interface.
 */
export interface MessagingChannelSpec {
  readonly channel: MessagingChannel;
  /**
   * The channel's name as a person writes it — "Feishu", "Telegram", "QQ". It appears in the
   * shared endpoints' error messages, which name the channel a caller is asking about; the
   * `channel` discriminant above is the machine-facing half and is not capitalised.
   */
  readonly label: string;
  /**
   * The stored credential, read tolerantly — `""` when none is stored, which is what the
   * enable gate and the masking below both key on. A malformed document reads as absent
   * rather than throwing: the row still has an identity and a state worth reporting, and the
   * connector is where an unusable document is diagnosed.
   */
  storedSecret(row: MessagingBindingRow): string;
  /**
   * The 400 code for "this binding has no credential". Channel-specific because the word is:
   * a Feishu or QQ binding is missing a *secret*, a Telegram one a *token*, and the code is
   * what a client branches on.
   */
  readonly secretRequiredCode: string;
  /** One stored row as its wire shape, secret masked. */
  toInfo(row: MessagingBindingRow): MessagingBindingInfo;
}

/**
 * The half of a binding's wire shape that has nothing to do with which channel it is.
 *
 * Written once here rather than spelled into each channel's projection, for the reason
 * {@link MessagingBindingCommon} exists: this is the half that grows, and it grew by three
 * fields in one release.
 */
export function commonBindingFields(row: MessagingBindingRow): MessagingBindingCommon {
  return {
    sessionId: row.sessionId,
    enabled: row.enabled,
    linePerMessage: row.linePerMessage,
    finalReplyOnly: row.finalReplyOnly,
    renderMarkdown: row.renderMarkdown,
    lastChatKnown: row.lastChatId !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A stored secret as it may leave the server: masked, or absent entirely.
 *
 * The absence is load-bearing rather than tidiness — the editor renders "not configured" from
 * the field being missing, so a cleared secret must not come back as a mask of the empty
 * string.
 */
export function maskedSecretField<K extends string>(
  key: K,
  secret: string,
): Partial<Record<K, string>> {
  return secret === "" ? {} : ({ [key]: maskApiKey(secret) } as Record<K, string>);
}

/**
 * The delivery preferences a PUT carries, read off its body in the shape the repo's update
 * takes: a field the request omitted is absent here, and absent means "keep what is stored".
 *
 * Read once for every channel, because these are the fields that are the same on all of them.
 * A fourth preference is one line here and nowhere else — the three-per-channel spread this
 * replaces is what made the last two cost nine.
 */
export function deliveryPatchOf(body: Record<string, unknown>): MessagingDeliveryPatch {
  const linePerMessage = optionalBoolean(body, "linePerMessage");
  const finalReplyOnly = optionalBoolean(body, "finalReplyOnly");
  const renderMarkdown = optionalBoolean(body, "renderMarkdown");
  return {
    ...(linePerMessage !== undefined ? { linePerMessage } : {}),
    ...(finalReplyOnly !== undefined ? { finalReplyOnly } : {}),
    ...(renderMarkdown !== undefined ? { renderMarkdown } : {}),
  };
}

/** What {@link resolveSecret} decided, and where it came from. */
export interface ResolvedSecret {
  secret: string;
  /**
   * Whether the secret arrived in THIS request. The channels that derive an account identity
   * from the credential itself (Telegram, from the token's numeric half) re-derive it only
   * then; the other branches keep the identity the row already had.
   */
  fromRequest: boolean;
}

/**
 * The credential ladder every channel's PUT climbs, in the one order they all agree on:
 *
 * 1. a typed credential wins — including over the clear flag, which is the models-page idiom;
 * 2. otherwise the clear flag drops the stored one, **refused while the binding is enabled**:
 *    a live connection must never keep running on a credential the store no longer has;
 * 3. otherwise the stored credential carries over, so a save that only changes a preference
 *    never has to round-trip the secret — which is what lets the masked value stay masked;
 * 4. and a first bind with nothing at any step is a 400 naming the channel's own code.
 *
 * A blank typed value is not a credential: it is what an untouched field submits, and treating
 * it as one would let a save with an empty box wipe a working binding.
 */
export function resolveSecret(args: {
  typed: string | undefined;
  clear: boolean;
  existing: MessagingBindingRow | null;
  stored: string;
  requiredCode: string;
  requiredMessage: string;
}): ResolvedSecret {
  const typed = args.typed !== undefined && args.typed !== "" ? args.typed : undefined;
  if (typed !== undefined) return { secret: typed, fromRequest: true };
  if (args.clear && args.existing !== null) {
    if (args.existing.enabled) {
      throw new HttpError(
        409,
        "messaging_disable_before_clear",
        "Disable the connection before clearing its credential.",
      );
    }
    return { secret: "", fromRequest: false };
  }
  if (args.stored === "") throw new HttpError(400, args.requiredCode, args.requiredMessage);
  return { secret: args.stored, fromRequest: false };
}
