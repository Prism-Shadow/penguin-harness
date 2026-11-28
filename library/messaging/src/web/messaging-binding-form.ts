/**
 * Messaging binding form helpers — conversion between the channel-aware editor's editable
 * state and the per-channel PUT/test DTOs (pure logic, unit-tested without a DOM; the
 * mcp-servers-form convention). The form keeps one sub-state per channel so switching the
 * selector back and forth never loses what was typed; `channel` names the selected one,
 * and only its fields are validated or submitted.
 *
 * What each channel's sub-state holds, and how it validates, is that channel's own
 * (`channels/<name>/form.ts`, listed in `channels/registry.ts`); this module lifts those onto
 * the whole form and names no channel itself.
 *
 * Not every field is a credential: `linePerMessage` (send a reply one message per non-blank
 * line), `finalReplyOnly` (send only a run's last reply, when the run ends) and
 * `renderMarkdown` (render its Markdown in the channel's own markup) are per-binding
 * delivery preferences that ride the same Save as the rest, which is why they live in the form
 * state rather than behind toggles of their own.
 *
 * Secrets never round-trip: a stored binding always loads with its secret field empty (the
 * server only ever returns a masked value), and `formToPut` omits a blank one so the
 * server keeps the stored value. Validation errors come back as codes; the component maps
 * them to localized messages.
 */
import type { MessagingBindingInfo, MessagingChannel } from "@prismshadow/penguin-server/api";
import type { MessagingDeliveryFields, MessagingFormErrors } from "./channels/channel-form";
import { CHANNEL_FORMS, MESSAGING_CHANNELS, channelForm } from "./channels/registry";

export type {
  MessagingDeliveryFields,
  MessagingFormErrorCode,
  MessagingFormErrors,
  MessagingFormField,
} from "./channels/channel-form";

type Forms = typeof CHANNEL_FORMS;

/** One channel's sub-state. */
type FieldsOf<C extends MessagingChannel> = ReturnType<Forms[C]["empty"]>;

/** One channel's PUT body. */
type PutOf<C extends MessagingChannel> = Extract<
  ReturnType<Forms[C]["toPut"]>,
  { ok: true }
>["body"];

/** One channel's credential-test body; `undefined` for a channel whose probe takes none. */
type TestOf<C extends MessagingChannel> = ReturnType<Forms[C]["toTest"]>;

/** Editable state backing the binding editor: the selected channel plus every channel's fields. */
export type MessagingFormState = { channel: MessagingChannel } & {
  [C in MessagingChannel]: FieldsOf<C>;
};

/** A valid submit names its channel so the caller picks that channel's endpoint. */
export type MessagingFormResult =
  | { [C in MessagingChannel]: { ok: true; channel: C; body: PutOf<C> } }[MessagingChannel]
  | { ok: false; errors: MessagingFormErrors };

/** A channel whose probe carries no body (nothing on its form is a credential to send) has none here. */
export type MessagingTestRequestByChannel = {
  [C in MessagingChannel]: TestOf<C> extends undefined
    ? { channel: C }
    : { channel: C; body: TestOf<C> };
}[MessagingChannel];

/** The form as one record per channel: what a write to a channel's sub-state goes through. */
type SubStates = Record<MessagingChannel, MessagingDeliveryFields>;

/** Whether the registry has a form for a binding's channel (a newer server may know one it does not). */
function hasForm(binding: MessagingBindingInfo): boolean {
  return Object.hasOwn(CHANNEL_FORMS, binding.channel);
}

export function emptyMessagingForm(
  channel: MessagingChannel = MESSAGING_CHANNELS[0],
): MessagingFormState {
  const subStates = Object.fromEntries(MESSAGING_CHANNELS.map((c) => [c, channelForm(c).empty()]));
  return { channel, ...subStates } as MessagingFormState;
}

/**
 * Builds the editor's form from every saved config: each channel's non-secret fields
 * load (secrets stay empty — masked values never round-trip — and clear checkboxes start
 * unchecked), and the selector starts on the enabled channel, else the first saved one,
 * else the picker's first.
 */
export function bindingsToForm(bindings: MessagingBindingInfo[]): MessagingFormState {
  const known = bindings.filter(hasForm);
  const enabled = known.find((b) => b.enabled)?.channel;
  const form = emptyMessagingForm(enabled ?? known[0]?.channel ?? MESSAGING_CHANNELS[0]);
  for (const info of known) {
    (form as SubStates)[info.channel] = channelForm(info.channel).load(info);
  }
  return form;
}

/**
 * Validates the selected channel's fields and builds its PUT body. `hasStoredSecret`
 * relaxes the secret requirement: with a saved binding an empty field means "keep it",
 * on a first bind it is an error.
 */
export function formToPut(form: MessagingFormState, hasStoredSecret: boolean): MessagingFormResult {
  const res = channelForm(form.channel).toPut(form[form.channel], hasStoredSecret);
  return (
    res.ok ? { ok: true, channel: form.channel, body: res.body } : res
  ) as MessagingFormResult;
}

/**
 * The credential test's request: only the fields the form actually carries — omitted ones
 * fall back to the stored binding server-side, so testing a saved binding needs no
 * re-typed secret.
 */
export function formToTest(form: MessagingFormState): MessagingTestRequestByChannel {
  const body = channelForm(form.channel).toTest(form[form.channel]);
  return (
    body === undefined ? { channel: form.channel } : { channel: form.channel, body }
  ) as MessagingTestRequestByChannel;
}

/**
 * Unsaved edits on the selected channel: any field differing from the loaded baseline (a
 * typed secret always counts — it always loads empty — and so does a checked clear box, and
 * so does any delivery preference).
 */
export function formDirty(form: MessagingFormState, baseline: MessagingFormState): boolean {
  return channelForm(form.channel).dirty(form[form.channel], baseline[form.channel]);
}

/**
 * The credential probe needs a testable credential: the selected channel's draft, or its
 * stored secret (`secretConfigured` — a stored config whose secret was cleared has
 * nothing to probe).
 */
export function formTestable(form: MessagingFormState, secretConfigured: boolean): boolean {
  return channelForm(form.channel).testable(form[form.channel], secretConfigured);
}
