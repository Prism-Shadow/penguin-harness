/**
 * The messaging channels' forms, one entry per channel: the only place the binding editor
 * learns which channels exist and what each one's half of the form is (see channel-form.ts).
 *
 * A typed table rather than a contribution slot. Every channel the Web App can edit is built
 * in, and a `Record` keyed by `MessagingChannel` makes a channel added to the wire vocabulary
 * without a form a typecheck failure rather than a blank section.
 */
import type { MessagingBindingInfo, MessagingChannel } from "@prismshadow/penguin-server/api";
import type { MessagingChannelForm, MessagingDeliveryFields } from "./channel-form";
import { feishuForm } from "./feishu";
import { qqForm } from "./qq";
import { telegramForm } from "./telegram";
import { wechatForm } from "./wechat";

export { MESSAGING_CHANNELS } from "./channel-ids";

/**
 * A channel's form widened to what every channel shares: what the shell holds when it reaches
 * a channel through a `MessagingChannel` value. Each channel's form is assignable to it because
 * the contract's members are methods, whose parameters TypeScript compares both ways. Every
 * call through it passes that same channel's sub-state, binding or body — the correlation the
 * table is keyed by, which the type system cannot follow across a union.
 */
export type AnyMessagingChannelForm = MessagingChannelForm<
  MessagingDeliveryFields,
  MessagingBindingInfo,
  unknown,
  unknown
>;

export const CHANNEL_FORMS = {
  feishu: feishuForm,
  telegram: telegramForm,
  qq: qqForm,
  wechat: wechatForm,
} satisfies Record<MessagingChannel, AnyMessagingChannelForm>;

/** One channel's form, for the shell's channel-neutral calls. */
export function channelForm(channel: MessagingChannel): AnyMessagingChannelForm {
  return CHANNEL_FORMS[channel];
}
