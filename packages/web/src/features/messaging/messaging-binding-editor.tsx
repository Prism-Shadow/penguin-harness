/**
 * Shared messaging binding editor — ONE implementation behind both the session-row dialog
 * and the conversation's Messaging dock panel (the two hosts differ only in where they
 * place the Save/Unbind actions, so the state machine is a hook and the fields are a
 * body component; neither host forks the form).
 *
 * Channel-aware: a channel selector (Feishu / Telegram) chooses which channel's fields
 * the editor shows while the Session is unbound — the mcp-servers transport idiom, the
 * choice decides every field below — and locks once bound (one binding per Session;
 * switching means unbinding first). The hook loads the channel-agnostic GET, so whichever
 * channel is bound is what it renders, and submits to that channel's endpoints.
 *
 * Two separate concerns, two separate controls:
 * - **Save** persists the selected channel's credential form — credentials only, it
 *   never opens or closes a connection (server-side exception: an enabled binding's
 *   connector restarts with the just-saved credentials, so stored config and live
 *   connection never diverge).
 * - **Enable** is a Switch that flips the connection immediately using the STORED
 *   credentials. While the form has unsaved edits the toggle is gated with a "save
 *   credentials first" hint rather than silently saving on the user's behalf.
 *
 * The GET is re-polled while the host shows the editor (the hook's `poll` flag) so
 * connect/error flips show up live. Secrets never round-trip: the field always starts
 * empty, a stored secret shows only as the site-wide masked placeholder (models-page
 * configured-key idiom — type to replace, blank keeps stored).
 */
import { useEffect, useRef, useState } from "react";
import type {
  MessagingBindingInfo,
  MessagingBindingResponse,
  MessagingChannel,
  MessagingRuntimeStatus,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk, type Tone } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { CHANNEL_ICONS } from "../../components/ui/icons";
import { Icon } from "../../components/ui/group-list";
import { Input } from "../../components/ui/input";
import { PasswordInput } from "../../components/ui/password-input";
import { Segmented } from "../../components/ui/segmented";
import { Switch } from "../../components/ui/switch";
import { toastError, toastSuccess } from "../../components/ui/toast";
import {
  bindingToForm,
  emptyMessagingForm,
  formDirty,
  formTestable,
  formToPut,
  formToTest,
  type MessagingFormErrors,
  type MessagingFormState,
} from "./messaging-binding-form";

/** How often the visible editor refreshes the runtime status (connects settle within a poll or two). */
const STATUS_POLL_MS = 3000;

/** Per-channel external links: the walkthrough, and the console where the bot/app is created. */
const CHANNEL_LINKS: Record<MessagingChannel, { tutorial: string; console: string }> = {
  feishu: {
    // Feishu's own echo-bot walkthrough: creating a self-built app and its long connection.
    tutorial: "https://open.feishu.cn/document/develop-an-echo-bot/introduction",
    console: "https://open.feishu.cn/app",
  },
  telegram: {
    tutorial: "https://core.telegram.org/bots/tutorial",
    console: "https://core.telegram.org/bots/api",
  },
};

const STATUS_TONE: Record<MessagingRuntimeStatus["state"], Tone> = {
  disconnected: "muted",
  connecting: "busy",
  connected: "success",
  error: "danger",
};

function errorText(code: MessagingFormErrors[keyof MessagingFormErrors]): string | undefined {
  if (code === undefined) return undefined;
  if (code === "required") return S.common.requiredField;
  if (code === "token_invalid") return S.telegram.invalidToken;
  return S.feishu.invalidDomain;
}

/** Everything a host renders the editor from: state + handlers, one instance per session. */
export interface MessagingBindingEditorState {
  /** null until the stored binding has been loaded (hosts show nothing until then). */
  form: MessagingFormState | null;
  patchForm(patch: Partial<MessagingFormState>): void;
  /** The stored binding's channel; null while unbound (the selector is live only then). */
  boundChannel: MessagingChannel | null;
  /** The selector's write: switches the form's channel while unbound (no-op once bound). */
  selectChannel(channel: MessagingChannel): void;
  hasStored: boolean;
  enabled: boolean;
  status: MessagingRuntimeStatus;
  lastChatKnown: boolean;
  /** The stored secret's site-wide mask (display-only, never round-trips); null while unbound. */
  secretMasked: string | null;
  fieldErrors: MessagingFormErrors;
  /** Unsaved edits: any selected-channel field differing from the loaded baseline (a typed secret always counts). */
  dirty: boolean;
  busy: boolean;
  toggling: boolean;
  testing: boolean;
  sendingTest: boolean;
  /** The credential probe needs an account identity: the draft's, or the stored binding's. */
  testable: boolean;
  /** The toggle acts on STORED credentials only: gated while unsaved edits would diverge. */
  toggleBlocked: boolean;
  save(): Promise<void>;
  toggleEnabled(next: boolean): Promise<void>;
  testConnection(): Promise<void>;
  sendTestMessage(): Promise<void>;
  /** The confirmed unbind (hosts own the confirmation dialog); resets to the unbound form. */
  unbind(): Promise<boolean>;
}

export function useMessagingBinding(
  sessionId: string,
  opts: {
    /** Keep the status poll running (hosts pass their visibility, e.g. the dock tab's `active`). */
    poll: boolean;
    /** Fired after a save/unbind changed the binding (null = unbound); callers refresh their row/list. */
    onChanged?: (sessionId: string, channel: MessagingChannel | null) => void;
    /** Fired when the initial load fails (the dialog closes itself; the panel shows its own retry). */
    onLoadFailed?: () => void;
  },
): MessagingBindingEditorState {
  const { poll, onChanged, onLoadFailed } = opts;
  const [form, setForm] = useState<MessagingFormState | null>(null);
  /** What the form last loaded/saved — the dirty check compares against it. */
  const [baseline, setBaseline] = useState<MessagingFormState | null>(null);
  const [boundChannel, setBoundChannel] = useState<MessagingChannel | null>(null);
  const [secretMasked, setSecretMasked] = useState<string | null>(null);
  /** Stored connection INTENT (the Switch's value); `status` is what the connection actually is. */
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<MessagingRuntimeStatus>({ state: "disconnected" });
  const [lastChatKnown, setLastChatKnown] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<MessagingFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  /** Which session the form was loaded for (the initial load runs once per session, not per poll flip). */
  const loadedFor = useRef<string | null>(null);

  /** The masked secret of whichever channel a response's binding is (never the plaintext). */
  const maskOf = (binding: MessagingBindingInfo | null): string | null => {
    if (binding === null) return null;
    return binding.channel === "telegram" ? binding.botTokenMasked : binding.appSecretMasked;
  };

  /** Applies one GET/PUT/state response's runtime facts (never the fields being edited). */
  const applyResponse = (res: MessagingBindingResponse): void => {
    setStatus(res.status);
    setBoundChannel(res.binding?.channel ?? null);
    setSecretMasked(maskOf(res.binding));
    setEnabled(res.binding?.enabled ?? false);
    setLastChatKnown(res.binding?.lastChatKnown ?? false);
  };

  // Initial load fills the form; the poll afterwards refreshes ONLY the runtime facts
  // (status / chat-known / bound / enabled / mask), never the fields being edited. A
  // re-shown editor (the dock keeps hidden tabs mounted, `poll` flips back on) only
  // resumes that refresh: the form survives hide/show untouched.
  useEffect(() => {
    let cancelled = false;
    let initialDone = loadedFor.current === sessionId;
    const refresh = async (initial: boolean) => {
      try {
        const res = await api.getMessagingBinding(sessionId);
        if (cancelled) return;
        applyResponse(res);
        if (initial) {
          const initialForm = res.binding ? bindingToForm(res.binding) : emptyMessagingForm();
          setForm(initialForm);
          setBaseline(initialForm);
          initialDone = true;
        }
      } catch (e) {
        if (cancelled) return;
        if (initial) {
          initialDone = true; // reported; a retry is the host's call, not a silent loop
          toastError(apiErrorText(e));
          onLoadFailed?.();
        }
      }
    };
    if (loadedFor.current !== sessionId) {
      loadedFor.current = sessionId;
      // A swapped session must never show the previous one's fields while its load runs.
      setForm(null);
      setBaseline(null);
      void refresh(true);
    }
    const timer = poll ? setInterval(() => void refresh(false), STATUS_POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
      // An initial load cancelled mid-flight (poll flipped, host unmounted) must retry on
      // the next run instead of leaving the form permanently unloaded.
      if (!initialDone && loadedFor.current === sessionId) loadedFor.current = null;
    };
    // Only sessionId/poll may restart the effect: onLoadFailed's identity would
    // otherwise re-run it every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, poll]);

  const patchForm = (patch: Partial<MessagingFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setFieldErrors({});
  };

  const selectChannel = (channel: MessagingChannel) => {
    // Locked once bound: one binding per Session, switching means unbinding first.
    if (boundChannel !== null) return;
    patchForm({ channel });
  };

  const hasStored = boundChannel !== null;
  const dirty = form !== null && baseline !== null && formDirty(form, baseline);

  const testConnection = async () => {
    if (!form) return;
    setTesting(true);
    try {
      const draft = formToTest(form);
      if (draft.channel === "telegram") {
        const res = await api.testTelegramBinding(sessionId, draft.body);
        if (res.ok) {
          const ms = res.latencyMs ?? 0;
          // The success line names the bot: the one detail a user can check against @BotFather.
          toastSuccess(
            res.botUsername !== undefined
              ? S.messaging.testOkAs(res.botUsername, ms)
              : S.messaging.testOk(ms),
          );
        } else toastError(S.messaging.testFail(res.error ?? S.common.unknownError));
      } else {
        const res = await api.testFeishuBinding(sessionId, draft.body);
        if (res.ok) toastSuccess(S.messaging.testOk(res.latencyMs ?? 0));
        else toastError(S.messaging.testFail(res.error ?? S.common.unknownError));
      }
    } catch (e) {
      toastError(S.messaging.testFail(apiErrorText(e)));
    } finally {
      setTesting(false);
    }
  };

  const sendTestMessage = async () => {
    if (boundChannel === null) return;
    setSendingTest(true);
    try {
      await api.sendMessagingTestMessage(sessionId, boundChannel);
      toastSuccess(S.messaging.testMessageSent);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setSendingTest(false);
    }
  };

  /** Save = persist the selected channel's credentials (no connection side effect; the toggle owns that). */
  const save = async () => {
    if (!form) return;
    const built = formToPut(form, hasStored && boundChannel === form.channel);
    if (!built.ok) {
      setFieldErrors(built.errors);
      return;
    }
    setBusy(true);
    try {
      const res =
        built.channel === "telegram"
          ? await api.putTelegramBinding(sessionId, built.body)
          : await api.putFeishuBinding(sessionId, built.body);
      applyResponse(res);
      // The secret is stored now: clear the field back to the keep-stored state.
      if (res.binding) {
        const saved = bindingToForm(res.binding);
        setForm(saved);
        setBaseline(saved);
      }
      toastSuccess(S.common.saved);
      onChanged?.(sessionId, res.binding?.channel ?? null);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** The Switch: connect/disconnect with the stored credentials, reflected in the status line. */
  const toggleEnabled = async (next: boolean) => {
    if (boundChannel === null) return;
    setToggling(true);
    try {
      const res = await api.setMessagingBindingState(sessionId, boundChannel, next);
      applyResponse(res);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setToggling(false);
    }
  };

  /** Returns whether the unbind went through (hosts close/reset on true). */
  const unbind = async (): Promise<boolean> => {
    if (boundChannel === null) return true;
    setBusy(true);
    try {
      await api.deleteMessagingBinding(sessionId, boundChannel);
      // Back to the unbound shape: an empty form (still on this channel) ready for a fresh bind.
      const fresh = emptyMessagingForm(boundChannel);
      setForm(fresh);
      setBaseline(fresh);
      setBoundChannel(null);
      setSecretMasked(null);
      setEnabled(false);
      setStatus({ state: "disconnected" });
      setLastChatKnown(false);
      onChanged?.(sessionId, null);
      return true;
    } catch (e) {
      toastError(apiErrorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    form,
    patchForm,
    boundChannel,
    selectChannel,
    hasStored,
    enabled,
    status,
    lastChatKnown,
    secretMasked,
    fieldErrors,
    dirty,
    busy,
    toggling,
    testing,
    sendingTest,
    testable: form !== null && formTestable(form, boundChannel),
    toggleBlocked: !hasStored || dirty || toggling || busy,
    save,
    toggleEnabled,
    testConnection,
    sendTestMessage,
    unbind,
  };
}

/** External link in the intro row (tutorial / developer console), same styling for both. */
function IntroLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="whitespace-nowrap text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
    >
      {label} ↗
    </a>
  );
}

/**
 * The editor's body — the channel selector, intro + links row, the enable toggle with
 * the live status line, the two probes, and the selected channel's credential fields.
 * Hosts place their own Save/Unbind actions (dialog footer vs panel action row) around it.
 */
export function MessagingBindingBody({ b }: { b: MessagingBindingEditorState }) {
  const { form } = b;
  if (!form) return null;
  const channel = b.boundChannel ?? form.channel;
  const links = CHANNEL_LINKS[channel];
  const perChannel = channel === "telegram" ? S.telegram : S.feishu;
  return (
    <div className="space-y-3">
      {/* Channel first — the choice decides every field below (the mcp transport idiom).
          Once bound it collapses to a read-only identity row: switching = unbind first. */}
      {b.boundChannel === null ? (
        <Segmented
          cols={2}
          options={[
            { value: "feishu" as MessagingChannel, label: S.messaging.channelName.feishu },
            { value: "telegram" as MessagingChannel, label: S.messaging.channelName.telegram },
          ]}
          value={form.channel}
          onChange={(v) => b.selectChannel(v)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
          <span className="text-gray-400 dark:text-gray-500">
            <Icon d={CHANNEL_ICONS[channel]} size={14} />
          </span>
          {S.messaging.channelName[channel]}
          <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
            {S.messaging.channelLocked}
          </span>
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {perChannel.intro} <IntroLink href={links.tutorial} label={S.messaging.tutorial} />{" "}
        <IntroLink href={links.console} label={S.messaging.console} />
      </p>
      {/* The connection toggle + live status on one line: the Switch is the intent, the
          tone-colored text is what the connection actually is right now. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Switch
            checked={b.enabled}
            disabled={b.toggleBlocked}
            onChange={(v) => void b.toggleEnabled(v)}
          />
          {S.messaging.enabled}
        </label>
        <span className="ml-2 text-gray-500 dark:text-gray-400">{S.messaging.statusLabel}</span>
        <span
          {...(b.status.lastError !== undefined ? { title: b.status.lastError } : {})}
          className={`font-medium ${toneInk[STATUS_TONE[b.status.state]]}`}
        >
          {S.messaging.status[b.status.state]}
        </span>
        {b.status.state === "error" && b.status.lastError !== undefined && (
          <span className="min-w-0 flex-1 truncate text-gray-400 dark:text-gray-500">
            {b.status.lastError}
          </span>
        )}
      </div>
      {/* Why the toggle is gated: it connects with the STORED credentials, so unsaved
          edits must be saved first rather than silently submitted. */}
      {b.hasStored && b.dirty && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{S.messaging.saveBeforeEnable}</p>
      )}
      {/* Entry-level probes — the MCP dialog idiom: standalone buttons, results as toasts. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={b.testing || b.busy || !b.testable}
          onClick={() => void b.testConnection()}
        >
          {b.testing ? S.messaging.testing : S.messaging.test}
        </Button>
        <Button
          size="sm"
          disabled={b.sendingTest || b.busy || b.status.state !== "connected" || !b.lastChatKnown}
          {...(!b.lastChatKnown ? { title: perChannel.testMessageNoChat } : {})}
          onClick={() => void b.sendTestMessage()}
        >
          {b.sendingTest ? S.messaging.sendingTestMessage : S.messaging.sendTestMessage}
        </Button>
      </div>
      {/* Format guidance, kept visible while the target chat is still unknown: the send
          button above stays disabled until the bot has been messaged once. */}
      {!b.lastChatKnown && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{perChannel.testMessageNoChat}</p>
      )}
      {channel === "telegram" ? (
        /* Stored token: the site-wide mask shows as the placeholder (models-page
           configured-key idiom) — type to replace it, leave blank to keep it. */
        <PasswordInput
          size="sm"
          label={S.telegram.botToken}
          {...(b.hasStored
            ? { hint: S.telegram.botTokenKeepHint, placeholder: b.secretMasked ?? undefined }
            : { required: true })}
          error={errorText(b.fieldErrors.botToken)}
          value={form.telegram.botToken}
          onChange={(e) => b.patchForm({ telegram: { botToken: e.target.value } })}
          autoComplete="off"
        />
      ) : (
        <>
          <Input
            size="sm"
            label={S.feishu.appId}
            required
            error={errorText(b.fieldErrors.appId)}
            value={form.feishu.appId}
            onChange={(e) => b.patchForm({ feishu: { ...form.feishu, appId: e.target.value } })}
            className="font-mono"
            placeholder="cli_xxxxxxxxxxxxxxxx"
            autoComplete="off"
          />
          {/* Stored secret: the site-wide mask shows as the placeholder (models-page
              configured-key idiom) — type to replace it, leave blank to keep it. */}
          <PasswordInput
            size="sm"
            label={S.feishu.appSecret}
            {...(b.hasStored
              ? { hint: S.feishu.appSecretKeepHint, placeholder: b.secretMasked ?? undefined }
              : { required: true })}
            error={errorText(b.fieldErrors.appSecret)}
            value={form.feishu.appSecret}
            onChange={(e) => b.patchForm({ feishu: { ...form.feishu, appSecret: e.target.value } })}
            autoComplete="off"
          />
          <Input
            size="sm"
            label={S.feishu.baseDomain}
            hint={S.feishu.baseDomainHint}
            error={errorText(b.fieldErrors.baseDomain)}
            value={form.feishu.baseDomain}
            onChange={(e) =>
              b.patchForm({ feishu: { ...form.feishu, baseDomain: e.target.value } })
            }
            className="font-mono"
            placeholder="https://open.feishu.cn"
            autoComplete="off"
          />
        </>
      )}
    </div>
  );
}
