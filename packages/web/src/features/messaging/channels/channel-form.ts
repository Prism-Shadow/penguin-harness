/**
 * The contract one messaging channel fills for the binding editor: everything about a channel
 * the editor's shell does not share, so the shell — the picker, the connection controls, the
 * probes, the delivery rows and the FAQ frame — never asks which channel it is showing.
 *
 * A channel supplies its form logic (its sub-state, how a stored binding loads into it, how it
 * validates into a PUT body and a test body, what counts as an edit and what can be probed),
 * its fields component (credential fields, stored-secret row, scan block, and the note under
 * them), the endpoints it saves and probes through, and the copy the shell places around it.
 * The channels are listed once, in `registry.ts`.
 *
 * Copy is read through functions rather than stored: the dictionary is swapped on a locale
 * change, so a string captured when this module loaded would stay in the old language.
 */
import type { ReactNode } from "react";
import type { MessagingBindingInfo, MessagingRuntimeStatus } from "@prismshadow/penguin-server/api";
import { S } from "../../../lib/strings";

/**
 * The delivery preferences every channel carries — the saved fields that are not credentials,
 * identical in meaning on every channel, which is what lets one row render each of them
 * whichever channel is selected.
 */
export interface MessagingDeliveryFields {
  /** Deliver a reply as one message per non-blank line. */
  linePerMessage: boolean;
  /** Deliver only a run's LAST completed reply, at the run's end, instead of each as it completes. */
  finalReplyOnly: boolean;
  /** Render a reply's Markdown in this channel's own markup instead of sending its characters. */
  renderMarkdown: boolean;
}

export type MessagingFormField = "appId" | "appSecret" | "baseDomain" | "botToken";

export type MessagingFormErrorCode = "required" | "url_invalid" | "token_invalid";

export type MessagingFormErrors = Partial<Record<MessagingFormField, MessagingFormErrorCode>>;

/** One channel's server-side facts, as the editor renders them (the form fields stay client-side). */
export interface MessagingChannelFacts {
  /** A secret is stored (a cleared config keeps its row but loses this). */
  secretConfigured: boolean;
  /** The stored secret's site-wide mask (display-only, never round-trips); null without one. */
  secretMasked: string | null;
  enabled: boolean;
  status: MessagingRuntimeStatus;
  lastChatKnown: boolean;
  /** The bot the saved config signs in as (`accountIdOf`); null with nothing saved. */
  accountId: string | null;
}

/** One notice a credential test produces; the tone picks the toast that carries it. */
export interface MessagingTestNotice {
  tone: "success" | "info" | "error";
  text: string;
}

/** What one credential test came back with, as the editor reports it. */
export interface MessagingTestOutcome {
  /** In the order they are shown. */
  notices: MessagingTestNotice[];
  /** The platform's own failure text, for the report a failed test files. */
  error: string | undefined;
}

/**
 * The notices a credential probe that reports only ok/latency/error turns into: one success
 * line, or one error line.
 */
export function plainTestOutcome(res: {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}): MessagingTestOutcome {
  return {
    notices: res.ok
      ? [{ tone: "success", text: S.messaging.testOk(res.latencyMs ?? 0) }]
      : [{ tone: "error", text: S.messaging.testFail(res.error ?? S.common.unknownError) }],
    error: res.error,
  };
}

/** What the shell hands a channel's fields component. */
export interface ChannelFieldsProps<F> {
  /** The Session being edited, for a flow that talks to the API from inside the fields. */
  sessionId: string;
  /** This channel's sub-state of the form. */
  fields: F;
  /** Writes part of this channel's sub-state back. */
  patch(patch: Partial<F>): void;
  facts: MessagingChannelFacts;
  /** What is wrong with the draft, per field, once it has unsaved edits. */
  errors: MessagingFormErrors;
  /** The binding's machine is out of reach: every control shows what was saved and takes nothing. */
  readOnly: boolean;
  /** The id a field carries so the gated switch can hand focus to it (see `credentialFields`). */
  fieldId(name: string): string;
  /** The id the scan block carries, for the same hand-off on a scan channel. */
  scanId: string;
  /** A flow inside the fields saved the binding (a scan): folds it in as a Save would. */
  onBound(binding: MessagingBindingInfo): void;
}

/** One channel's half of the binding editor. */
export interface MessagingChannelForm<
  F extends MessagingDeliveryFields,
  Info extends MessagingBindingInfo,
  Put,
  Test,
> {
  /** A blank sub-state: what an unsaved channel shows. */
  empty(): F;
  /** A stored binding's non-secret fields; secrets always load empty. */
  load(info: Info): F;
  /** Validates the draft into its PUT body; `hasStoredSecret` makes a blank secret mean "keep". */
  toPut(
    fields: F,
    hasStoredSecret: boolean,
  ): { ok: true; body: Put } | { ok: false; errors: MessagingFormErrors };
  /** The credential test's body: only the fields the draft carries (blanks fall back server-side). */
  toTest(fields: F): Test;
  /** Unsaved edits against the loaded baseline. */
  dirty(fields: F, baseline: F): boolean;
  /** The probe has something to test: a draft credential, or the stored one. */
  testable(fields: F, secretConfigured: boolean): boolean;
  /** The bot a binding signs in as: the channel's public account id, never a secret. */
  accountId(info: Info): string;
  /** The stored credential's mask, under whatever name this channel's wire shape gives it. */
  secretMasked(info: Info): string | undefined;
  put(
    sessionId: string,
    body: Put,
  ): Promise<{ binding: MessagingBindingInfo | null; status: MessagingRuntimeStatus }>;
  test(sessionId: string, body: Test): Promise<MessagingTestOutcome>;
  /**
   * Where a click on the switch gated on a missing credential sends focus: the scan block, or
   * the first empty field of `credentialFields`.
   */
  enableFocus: "scan" | "credential";
  /** The typed credential fields, in order, as `[fieldId name, value]`. */
  credentialFields?(fields: F): Array<[name: string, value: string]>;
  /** The credential section: fields, stored-secret row, scan block, and the note under them. */
  Fields(props: ChannelFieldsProps<F>): ReactNode;
  /** The channel's own dictionary entries the shell places around the fields. */
  copy(): { intro: string; setupSteps: readonly string[]; testMessageNoChat: string };
  /** What the Markdown option renders as on this channel, behind that row's "?". */
  renderMarkdownHelp(): string;
  /** A second paragraph behind the "final reply only" row's "?", where the channel changes its outcome. */
  finalReplyOnlyNote?(): string;
  /** A line after the setup steps in the setup fold. */
  setupNote?(): string;
  /** A line after the intro in the "what binding does" fold. */
  whatNote?(): string;
  /** The channel's own troubleshooting entries, after the shared ones. */
  troubles(): readonly string[];
  /** The walkthrough the setup fold ends on; null for a channel with nowhere public to send a reader. */
  tutorial: string | null;
}
