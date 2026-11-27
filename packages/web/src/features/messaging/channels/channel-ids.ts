/**
 * Every messaging channel the Web App offers, in the order the binding editor's picker shows
 * them. Dependency-free on purpose: the editor's shell iterates it, and the ui-gallery's mock
 * routes import it without pulling in any channel's form.
 */
import type { MessagingChannel } from "@prismshadow/penguin-server/api";

const ORDER = ["feishu", "telegram", "qq", "wechat"] as const satisfies readonly MessagingChannel[];

/** A `MessagingChannel` the list above does not name; `never` while the list is complete. */
type Unlisted = Exclude<MessagingChannel, (typeof ORDER)[number]>;

/**
 * The channels in picker order. A tuple, so its length is a literal the picker's column count
 * can take; and a channel added to `MessagingChannel` without an entry here fails typecheck.
 */
export const MESSAGING_CHANNELS: typeof ORDER & ([Unlisted] extends [never] ? unknown : never) =
  ORDER;
