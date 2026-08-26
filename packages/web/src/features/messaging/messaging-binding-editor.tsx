/**
 * Shared messaging binding editor — ONE implementation behind both the session-row dialog
 * and the conversation's Messaging dock panel (the two hosts differ only in where they
 * place the Save action and the FAQ folds, so the state machine is a hook and the pieces
 * are body components; neither host forks the form).
 *
 * Channel model: a Session keeps at most one saved config PER channel — both may sit
 * saved side by side — and AT MOST ONE of them is enabled. The channel selector switches
 * freely between the two channel forms (each independently savable, each showing its own
 * configured/enabled state); enabling one channel while the other is enabled is gated
 * with a "turn that one off first" hint (the server refuses it too, 409).
 *
 * The form opens on the connection controls and the credential fields trail them: the two
 * channels' field lists differ in length, so controls placed under the fields would sit at
 * a different height in each channel and move on every switch. The explanation lives in
 * collapsed FAQ folds below the save area (`MessagingBindingHelp`), and the channel's
 * leading credential field — where the console values start being pasted — carries the
 * developer-console link at its label's top-right corner (the models-page "get API key"
 * idiom, which puts the link on the field, not in a row of its own). Secrets follow that
 * page's interaction: the field always starts empty, a stored secret shows as a masked
 * line under it with a "clear stored …" checkbox (typing unchecks it; applied on Save),
 * blank keeps the stored value — and clearing requires the channel's connection to be
 * disabled first. There is no unbind affordance: removing a credential IS the per-field
 * clear.
 *
 * The GET is re-polled while the host shows the editor (the hook's `poll` flag) so
 * connect/error flips show up live.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  MessagingBindingInfo,
  MessagingBindingsResponse,
  MessagingChannel,
  MessagingRuntimeStatus,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk, type Tone } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { FieldLabel } from "../../components/ui/field";
import { HelpFold } from "../../components/ui/help-fold";
import { Input } from "../../components/ui/input";
import { PasswordInput } from "../../components/ui/password-input";
import { Segmented } from "../../components/ui/segmented";
import { Switch } from "../../components/ui/switch";
import { toastError, toastSuccess } from "../../components/ui/toast";
import {
  bindingsToForm,
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

/** Per-channel external links: the walkthrough (setup FAQ fold) and the console where the credential is fetched (field corner). */
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

/** One channel's server-side facts, as the editor renders them (the form fields stay client-side). */
export interface MessagingChannelFacts {
  /** A secret is stored (a cleared config keeps its row but loses this). */
  secretConfigured: boolean;
  /** The stored secret's site-wide mask (display-only, never round-trips); null without one. */
  secretMasked: string | null;
  enabled: boolean;
  status: MessagingRuntimeStatus;
  lastChatKnown: boolean;
}

const EMPTY_FACTS: MessagingChannelFacts = {
  secretConfigured: false,
  secretMasked: null,
  enabled: false,
  status: { state: "disconnected" },
  lastChatKnown: false,
};

type ChannelFactsMap = Record<MessagingChannel, MessagingChannelFacts>;

function factsOf(
  binding: MessagingBindingInfo | null,
  status: MessagingRuntimeStatus,
): MessagingChannelFacts {
  if (binding === null) return { ...EMPTY_FACTS, status };
  const masked = binding.channel === "telegram" ? binding.botTokenMasked : binding.appSecretMasked;
  return {
    secretConfigured: masked !== undefined,
    secretMasked: masked ?? null,
    enabled: binding.enabled,
    status,
    lastChatKnown: binding.lastChatKnown,
  };
}

function factsFromList(res: MessagingBindingsResponse): ChannelFactsMap {
  const map: ChannelFactsMap = { feishu: EMPTY_FACTS, telegram: EMPTY_FACTS };
  for (const entry of res.bindings) {
    map[entry.binding.channel] = factsOf(entry.binding, entry.status);
  }
  return map;
}

/** Everything a host renders the editor from: state + handlers, one instance per session. */
export interface MessagingBindingEditorState {
  /** null until the stored bindings have been loaded (hosts show nothing until then). */
  form: MessagingFormState | null;
  patchForm(patch: Partial<MessagingFormState>): void;
  /** The selector's write: switches which channel's form shows (both stay editable). */
  selectChannel(channel: MessagingChannel): void;
  /** Per-channel server-side facts (secret / enabled / status / chat-known). */
  channels: ChannelFactsMap;
  fieldErrors: MessagingFormErrors;
  /** Unsaved edits on the SELECTED channel (a typed secret and a checked clear box count). */
  dirty: boolean;
  busy: boolean;
  toggling: boolean;
  testing: boolean;
  sendingTest: boolean;
  /** The credential probe needs a testable credential: the selected channel's draft or stored secret. */
  testable: boolean;
  /** The enable switch is gated (see toggleHint for the reason shown to the user). */
  toggleBlocked: boolean;
  /** Why the switch is gated, when a reason is worth showing (null otherwise). */
  toggleHint: string | null;
  save(): Promise<void>;
  toggleEnabled(next: boolean): Promise<void>;
  testConnection(): Promise<void>;
  sendTestMessage(): Promise<void>;
}

export function useMessagingBinding(
  sessionId: string,
  opts: {
    /** Keep the status poll running (hosts pass their visibility, e.g. the dock tab's `active`). */
    poll: boolean;
    /** Fired when the ENABLED channel changed (null = none); callers refresh their row/list indicator. */
    onChanged?: (sessionId: string, channel: MessagingChannel | null) => void;
    /** Fired when the initial load fails (the dialog closes itself; the panel shows its own retry). */
    onLoadFailed?: () => void;
  },
): MessagingBindingEditorState {
  const { poll, onChanged, onLoadFailed } = opts;
  const [form, setForm] = useState<MessagingFormState | null>(null);
  /** What the form last loaded/saved — the dirty check compares against it. */
  const [baseline, setBaseline] = useState<MessagingFormState | null>(null);
  const [channels, setChannels] = useState<ChannelFactsMap>({
    feishu: EMPTY_FACTS,
    telegram: EMPTY_FACTS,
  });
  const [fieldErrors, setFieldErrors] = useState<MessagingFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  /** Which session the form was loaded for (the initial load runs once per session, not per poll flip). */
  const loadedFor = useRef<string | null>(null);

  // Initial load fills the form; the poll afterwards refreshes ONLY the per-channel
  // facts (stored / secret / enabled / status / chat-known), never the fields being
  // edited. A re-shown editor (the dock keeps hidden tabs mounted, `poll` flips back on)
  // only resumes that refresh: the form survives hide/show untouched.
  useEffect(() => {
    let cancelled = false;
    let initialDone = loadedFor.current === sessionId;
    const refresh = async (initial: boolean) => {
      try {
        const res = await api.getMessagingBinding(sessionId);
        if (cancelled) return;
        setChannels(factsFromList(res));
        if (initial) {
          const initialForm = bindingsToForm(res.bindings.map((b) => b.binding));
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
    patchForm({ channel });
  };

  const selected: MessagingChannel = form?.channel ?? "feishu";
  const facts = channels[selected];
  const enabledChannel: MessagingChannel | null = channels.feishu.enabled
    ? "feishu"
    : channels.telegram.enabled
      ? "telegram"
      : null;
  const otherEnabled = enabledChannel !== null && enabledChannel !== selected;
  const dirty = form !== null && baseline !== null && formDirty(form, baseline);

  /** One channel's PUT/state response lands only in that channel's facts + form baseline. */
  const applyChannel = (
    channel: MessagingChannel,
    binding: MessagingBindingInfo | null,
    status: MessagingRuntimeStatus,
  ): void => {
    setChannels((prev) => ({ ...prev, [channel]: factsOf(binding, status) }));
    if (binding !== null) {
      const fresh = bindingsToForm([binding]);
      const sub = channel === "feishu" ? { feishu: fresh.feishu } : { telegram: fresh.telegram };
      setForm((prev) => (prev ? { ...prev, ...sub } : prev));
      setBaseline((prev) => (prev ? { ...prev, ...sub } : prev));
    }
  };

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
    setSendingTest(true);
    try {
      await api.sendMessagingTestMessage(sessionId, selected);
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
    const built = formToPut(form, channels[form.channel].secretConfigured);
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
      applyChannel(built.channel, res.binding, res.status);
      toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** The Switch: connect/disconnect the SELECTED channel with its stored credentials. */
  const toggleEnabled = async (next: boolean) => {
    setToggling(true);
    try {
      const res = await api.setMessagingBindingState(sessionId, selected, next);
      applyChannel(selected, res.binding, res.status);
      onChanged?.(sessionId, next && res.binding?.enabled === true ? selected : null);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setToggling(false);
    }
  };

  // Enabling needs a saved credential, no unsaved edits, and the other channel dark;
  // disabling is always allowed. The hint names the strongest reason.
  const enableBlocked = !facts.enabled && (otherEnabled || !facts.secretConfigured || dirty);
  const toggleHint =
    !facts.enabled && enabledChannel !== null && otherEnabled
      ? S.messaging.otherEnabledHint(S.messaging.channelName[enabledChannel])
      : !facts.enabled && !facts.secretConfigured
        ? S.messaging.credentialMissingHint
        : !facts.enabled && dirty
          ? S.messaging.saveBeforeEnable
          : null;

  return {
    form,
    patchForm,
    selectChannel,
    channels,
    fieldErrors,
    dirty,
    busy,
    toggling,
    testing,
    sendingTest,
    testable: form !== null && formTestable(form, facts.secretConfigured),
    toggleBlocked: enableBlocked || toggling || busy,
    toggleHint,
    save,
    toggleEnabled,
    testConnection,
    sendTestMessage,
  };
}

/** External link styled like the models dialog's "get API key" corner action. */
function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="shrink-0 text-xs text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
    >
      {label} ↗
    </a>
  );
}

/**
 * A field with an action link at the label's top-right corner — the models dialog's
 * "get API key" idiom. The control inside carries `aria-label` itself: this wrapper's
 * label row is layout, not a <label> element.
 */
function CornerLinkedField({
  label,
  required,
  link,
  children,
}: {
  label: string;
  required?: boolean;
  link: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <FieldLabel block={false} {...(required ? { required: true } : {})}>
          {label}
        </FieldLabel>
        {link}
      </span>
      {children}
    </div>
  );
}

/**
 * The stored secret's status row, under the secret field — the models-page configured-key
 * idiom: the site-wide mask in mono, and a "clear stored …" checkbox applied on Save
 * (typing into the field unchecks it). Clearing requires the channel's connection to be
 * disabled first, so the checkbox is gated with that hint while enabled.
 */
function StoredSecretRow({
  masked,
  clearLabel,
  checked,
  enabled,
  onChange,
}: {
  masked: string;
  clearLabel: string;
  /** The clear checkbox's state (lives in the form, applied on Save). */
  checked: boolean;
  /** The channel's connection is enabled: clearing is gated until it is turned off. */
  enabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
      <span className="font-mono">{masked}</span>
      <label
        className={`flex items-center gap-1.5 ${enabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={enabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {clearLabel}
      </label>
      {/* A disabled checkbox does not reliably fire hover, so the reason is on screen rather
          than in a title: a gated control that never says why is the bug this avoids. */}
      {enabled && (
        <span className="text-gray-400 dark:text-gray-500">
          {S.messaging.disableBeforeClearHint}
        </span>
      )}
    </div>
  );
}

/**
 * The editor's body, top to bottom: the channel selector, the connection controls (enable
 * toggle + live status, then the two probes, then the hint naming what gates the switch),
 * then the selected channel's credential fields (console link at the credential field's
 * corner, models-style stored-secret row). Only the selector and the controls sit above the
 * fields, and everything above the fields is channel-independent in height, so the toggle
 * and the probes hold one vertical position no matter which channel is selected. Hosts
 * place their own Save action after it and `MessagingBindingHelp` below that.
 */
export function MessagingBindingBody({ b }: { b: MessagingBindingEditorState }) {
  const { form } = b;
  if (!form) return null;
  const channel = form.channel;
  const facts = b.channels[channel];
  const links = CHANNEL_LINKS[channel];
  return (
    <div className="space-y-3">
      {/* Channel first — each channel's config is saved independently, so the selector
          switches forms rather than locking (the mcp transport idiom). */}
      <div role="group" aria-label={S.messaging.channelLabel}>
        <Segmented
          cols={2}
          options={[
            { value: "feishu" as MessagingChannel, label: S.messaging.channelName.feishu },
            { value: "telegram" as MessagingChannel, label: S.messaging.channelName.telegram },
          ]}
          value={channel}
          onChange={(v) => b.selectChannel(v)}
        />
      </div>
      {/* The connection toggle + live status on one line: the Switch is the intent, the
          tone-colored text is what the connection actually is right now. At most one
          channel is enabled per Session — the hint under the probes names what gates the
          switch. The error state's `lastError` gets its own line below rather than a track
          on this one: the connection failures worth reporting name what to do about them
          ("another program is already polling this bot …"), and a share of a row that
          already carries a switch, a label and a status word truncates that to a couple of
          words. Clamped to two lines so an error still cannot push the probes far, with
          the whole message on hover. */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <Switch
              checked={facts.enabled}
              disabled={b.toggleBlocked}
              onChange={(v) => void b.toggleEnabled(v)}
            />
            {S.messaging.enabled}
          </label>
          <span className="ml-2 text-gray-500 dark:text-gray-400">{S.messaging.statusLabel}</span>
          <span className={`font-medium ${toneInk[STATUS_TONE[facts.status.state]]}`}>
            {S.messaging.status[facts.status.state]}
          </span>
        </div>
        {facts.status.state === "error" && facts.status.lastError !== undefined && (
          <p
            title={facts.status.lastError}
            className="line-clamp-2 text-xs break-words text-gray-500 dark:text-gray-400"
          >
            {facts.status.lastError}
          </p>
        )}
      </div>
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
          disabled={
            b.sendingTest || b.busy || facts.status.state !== "connected" || !facts.lastChatKnown
          }
          {...(!facts.lastChatKnown
            ? {
                title:
                  channel === "telegram"
                    ? S.telegram.testMessageNoChat
                    : S.feishu.testMessageNoChat,
              }
            : {})}
          onClick={() => void b.sendTestMessage()}
        >
          {b.sendingTest ? S.messaging.sendingTestMessage : S.messaging.sendTestMessage}
        </Button>
      </div>
      {/* The gating reason closes the control block rather than sitting under the switch:
          it comes and goes with the switch's own state, so anything below it shifts by a
          line — trailing the probes leaves both of them at a fixed offset. */}
      {b.toggleHint !== null && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{b.toggleHint}</p>
      )}
      {/* The credential fields trail the controls above; explanations live in the FAQ folds
          below the save area. */}
      {channel === "telegram" ? (
        <>
          <CornerLinkedField
            label={S.telegram.botToken}
            required={!facts.secretConfigured}
            link={<ExternalLink href={links.console} label={S.messaging.console} />}
          >
            <PasswordInput
              size="sm"
              aria-label={S.telegram.botToken}
              {...(facts.secretConfigured ? { placeholder: S.telegram.botTokenKeepHint } : {})}
              error={errorText(b.fieldErrors.botToken)}
              value={form.telegram.botToken}
              onChange={(e) =>
                b.patchForm({ telegram: { botToken: e.target.value, clearToken: false } })
              }
              autoComplete="off"
            />
          </CornerLinkedField>
          {facts.secretMasked !== null && form.telegram.botToken === "" && (
            <StoredSecretRow
              masked={facts.secretMasked}
              clearLabel={S.telegram.clearToken}
              checked={form.telegram.clearToken}
              enabled={facts.enabled}
              onChange={(checked) =>
                b.patchForm({ telegram: { ...form.telegram, clearToken: checked } })
              }
            />
          )}
        </>
      ) : (
        <>
          <CornerLinkedField
            label={S.feishu.appId}
            required
            link={<ExternalLink href={links.console} label={S.messaging.console} />}
          >
            <Input
              size="sm"
              aria-label={S.feishu.appId}
              error={errorText(b.fieldErrors.appId)}
              value={form.feishu.appId}
              onChange={(e) => b.patchForm({ feishu: { ...form.feishu, appId: e.target.value } })}
              className="font-mono"
              placeholder="cli_xxxxxxxxxxxxxxxx"
              autoComplete="off"
            />
          </CornerLinkedField>
          <PasswordInput
            size="sm"
            label={S.feishu.appSecret}
            {...(facts.secretConfigured
              ? { placeholder: S.feishu.appSecretKeepHint }
              : { required: true })}
            error={errorText(b.fieldErrors.appSecret)}
            value={form.feishu.appSecret}
            onChange={(e) =>
              b.patchForm({
                feishu: { ...form.feishu, appSecret: e.target.value, clearSecret: false },
              })
            }
            autoComplete="off"
          />
          {facts.secretMasked !== null && form.feishu.appSecret === "" && (
            <StoredSecretRow
              masked={facts.secretMasked}
              clearLabel={S.feishu.clearSecret}
              checked={form.feishu.clearSecret}
              enabled={facts.enabled}
              onChange={(checked) =>
                b.patchForm({ feishu: { ...form.feishu, clearSecret: checked } })
              }
            />
          )}
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

/**
 * The collapsed-by-default FAQ under the save area — three titled `HelpFold`s: the
 * selected channel's setup steps (ending in its tutorial link), what binding does, and
 * troubleshooting. Hosts place it below their Save controls, which is what keeps the
 * form itself opening on the channel selector and the connection controls.
 */
export function MessagingBindingHelp({ channel }: { channel: MessagingChannel }) {
  const per = channel === "telegram" ? S.telegram : S.feishu;
  const links = CHANNEL_LINKS[channel];
  return (
    <div className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800">
      <HelpFold title={S.messaging.faqSetupTitle}>
        <ol className="list-decimal space-y-1 pl-4">
          {per.setupSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-1.5">
          <ExternalLink href={links.tutorial} label={S.messaging.tutorial} />
        </p>
      </HelpFold>
      <HelpFold title={S.messaging.faqWhatTitle}>
        <p>{per.intro}</p>
      </HelpFold>
      <HelpFold title={S.messaging.faqTroubleTitle}>
        <ul className="list-disc space-y-1 pl-4">
          <li>{S.messaging.troubleNoChat}</li>
          <li>{S.messaging.troubleConnError}</li>
          {channel === "telegram" && <li>{S.messaging.troubleOnePoller}</li>}
        </ul>
      </HelpFold>
    </div>
  );
}
