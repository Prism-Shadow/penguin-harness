/**
 * Shared Feishu binding editor — ONE implementation behind both the session-row dialog
 * and the conversation's Messaging dock panel (the two hosts differ only in where they
 * place the Save/Unbind actions, so the state machine is a hook and the fields are a
 * body component; neither host forks the form).
 *
 * Two separate concerns, two separate controls:
 * - **Save** persists the APP_ID / APP_SECRET / API-domain form — credentials only, it
 *   never opens or closes a connection (server-side exception: an enabled binding's
 *   connector restarts with the just-saved credentials, so stored config and live
 *   connection never diverge).
 * - **Enable** is a Switch that flips the connection immediately using the STORED
 *   credentials. While the form has unsaved edits the toggle is gated with a "save
 *   credentials first" hint rather than silently saving on the user's behalf.
 *
 * The GET is re-polled while the host shows the editor (the hook's `poll` flag) so
 * connect/error flips show up live. The secret never round-trips: the field always
 * starts empty, a stored secret shows only as the site-wide masked placeholder
 * (models-page configured-key idiom — type to replace, blank keeps stored).
 */
import { useEffect, useRef, useState } from "react";
import type { MessagingRuntimeStatus } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk, type Tone } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { PasswordInput } from "../../components/ui/password-input";
import { Switch } from "../../components/ui/switch";
import { toastError, toastSuccess } from "../../components/ui/toast";
import {
  bindingToForm,
  emptyFeishuForm,
  formToPut,
  formToTest,
  type FeishuFormErrors,
  type FeishuFormState,
} from "./feishu-binding-form";

/** How often the visible editor refreshes the runtime status (connects settle within a poll or two). */
const STATUS_POLL_MS = 3000;

/** Feishu's own echo-bot walkthrough: creating a self-built app and its long connection. */
const FEISHU_TUTORIAL_URL = "https://open.feishu.cn/document/develop-an-echo-bot/introduction";

const STATUS_TONE: Record<MessagingRuntimeStatus["state"], Tone> = {
  disconnected: "muted",
  connecting: "busy",
  connected: "success",
  error: "danger",
};

function errorText(code: FeishuFormErrors[keyof FeishuFormErrors]): string | undefined {
  if (code === undefined) return undefined;
  return code === "required" ? S.common.requiredField : S.feishu.invalidDomain;
}

/** Everything a host renders the editor from: state + handlers, one instance per session. */
export interface FeishuBindingEditorState {
  /** null until the stored binding has been loaded (hosts show nothing until then). */
  form: FeishuFormState | null;
  patchForm(patch: Partial<FeishuFormState>): void;
  hasStored: boolean;
  enabled: boolean;
  status: MessagingRuntimeStatus;
  lastChatKnown: boolean;
  /** The stored secret's site-wide mask (display-only, never round-trips); null while unbound. */
  secretMasked: string | null;
  fieldErrors: FeishuFormErrors;
  /** Unsaved edits: any field differing from the loaded baseline (a typed secret always counts). */
  dirty: boolean;
  busy: boolean;
  toggling: boolean;
  testing: boolean;
  sendingTest: boolean;
  /** The credential probe needs an app identity: the draft's, or the stored binding's. */
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

export function useFeishuBinding(
  sessionId: string,
  opts: {
    /** Keep the status poll running (hosts pass their visibility, e.g. the dock tab's `active`). */
    poll: boolean;
    /** Fired after a save/unbind changed whether the Session is bound (callers refresh their row/list). */
    onChanged?: (sessionId: string, bound: boolean) => void;
    /** Fired when the initial load fails (the dialog closes itself; the panel shows its own retry). */
    onLoadFailed?: () => void;
  },
): FeishuBindingEditorState {
  const { poll, onChanged, onLoadFailed } = opts;
  const [form, setForm] = useState<FeishuFormState | null>(null);
  /** What the form last loaded/saved — the dirty check compares against it. */
  const [baseline, setBaseline] = useState<FeishuFormState | null>(null);
  const [hasStored, setHasStored] = useState(false);
  const [secretMasked, setSecretMasked] = useState<string | null>(null);
  /** Stored connection INTENT (the Switch's value); `status` is what the connection actually is. */
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<MessagingRuntimeStatus>({ state: "disconnected" });
  const [lastChatKnown, setLastChatKnown] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FeishuFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  /** Which session the form was loaded for (the initial load runs once per session, not per poll flip). */
  const loadedFor = useRef<string | null>(null);

  // Initial load fills the form; the poll afterwards refreshes ONLY the runtime facts
  // (status / chat-known / bound / enabled / mask), never the fields being edited. A
  // re-shown editor (the dock keeps hidden tabs mounted, `poll` flips back on) only
  // resumes that refresh: the form survives hide/show untouched.
  useEffect(() => {
    let cancelled = false;
    let initialDone = loadedFor.current === sessionId;
    const refresh = async (initial: boolean) => {
      try {
        const res = await api.getFeishuBinding(sessionId);
        if (cancelled) return;
        setStatus(res.status);
        setHasStored(res.binding !== null);
        setSecretMasked(res.binding?.appSecretMasked ?? null);
        setEnabled(res.binding?.enabled ?? false);
        setLastChatKnown(res.binding?.lastChatKnown ?? false);
        if (initial) {
          const initialForm = res.binding ? bindingToForm(res.binding) : emptyFeishuForm();
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

  const patchForm = (patch: Partial<FeishuFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setFieldErrors({});
  };

  const dirty =
    form !== null &&
    baseline !== null &&
    (form.appId !== baseline.appId ||
      form.baseDomain !== baseline.baseDomain ||
      form.appSecret.trim() !== "");

  const testConnection = async () => {
    if (!form) return;
    setTesting(true);
    try {
      const res = await api.testFeishuBinding(sessionId, formToTest(form));
      if (res.ok) toastSuccess(S.feishu.testOk(res.latencyMs ?? 0));
      else toastError(S.feishu.testFail(res.error ?? S.common.unknownError));
    } catch (e) {
      toastError(S.feishu.testFail(apiErrorText(e)));
    } finally {
      setTesting(false);
    }
  };

  const sendTestMessage = async () => {
    setSendingTest(true);
    try {
      await api.sendFeishuTestMessage(sessionId);
      toastSuccess(S.feishu.testMessageSent);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setSendingTest(false);
    }
  };

  /** Save = persist the credentials (no connection side effect; the toggle owns that). */
  const save = async () => {
    if (!form) return;
    const built = formToPut(form, hasStored);
    if (!built.ok) {
      setFieldErrors(built.errors);
      return;
    }
    setBusy(true);
    try {
      const res = await api.putFeishuBinding(sessionId, built.body);
      setStatus(res.status);
      setHasStored(true);
      setSecretMasked(res.binding?.appSecretMasked ?? null);
      setEnabled(res.binding?.enabled ?? false);
      setLastChatKnown(res.binding?.lastChatKnown ?? false);
      // The secret is stored now: clear the field back to the keep-stored state.
      if (res.binding) {
        const saved = bindingToForm(res.binding);
        setForm(saved);
        setBaseline(saved);
      }
      toastSuccess(S.common.saved);
      onChanged?.(sessionId, true);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** The Switch: connect/disconnect with the stored credentials, reflected in the status line. */
  const toggleEnabled = async (next: boolean) => {
    setToggling(true);
    try {
      const res = await api.setFeishuBindingState(sessionId, next);
      setStatus(res.status);
      setEnabled(res.binding?.enabled ?? false);
      setLastChatKnown(res.binding?.lastChatKnown ?? false);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setToggling(false);
    }
  };

  /** Returns whether the unbind went through (hosts close/reset on true). */
  const unbind = async (): Promise<boolean> => {
    setBusy(true);
    try {
      await api.deleteFeishuBinding(sessionId);
      // Back to the unbound shape: an empty form ready for a fresh bind.
      const fresh = emptyFeishuForm();
      setForm(fresh);
      setBaseline(fresh);
      setHasStored(false);
      setSecretMasked(null);
      setEnabled(false);
      setStatus({ state: "disconnected" });
      setLastChatKnown(false);
      onChanged?.(sessionId, false);
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
    testable: form !== null && (form.appId.trim() !== "" || hasStored),
    toggleBlocked: !hasStored || dirty || toggling || busy,
    save,
    toggleEnabled,
    testConnection,
    sendTestMessage,
    unbind,
  };
}

/**
 * The editor's body — intro + tutorial link, the enable toggle with the live status
 * line, the two probes, and the three credential fields. Hosts place their own
 * Save/Unbind actions (dialog footer vs panel action row) around it.
 */
export function FeishuBindingBody({ b }: { b: FeishuBindingEditorState }) {
  const { form } = b;
  if (!form) return null;
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {S.feishu.dialogIntro}{" "}
        <a
          href={FEISHU_TUTORIAL_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="whitespace-nowrap text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
        >
          {S.feishu.tutorial} ↗
        </a>
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
          {S.feishu.enabled}
        </label>
        <span className="ml-2 text-gray-500 dark:text-gray-400">{S.feishu.statusLabel}</span>
        <span
          {...(b.status.lastError !== undefined ? { title: b.status.lastError } : {})}
          className={`font-medium ${toneInk[STATUS_TONE[b.status.state]]}`}
        >
          {S.feishu.status[b.status.state]}
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
        <p className="text-xs text-gray-400 dark:text-gray-500">{S.feishu.saveBeforeEnable}</p>
      )}
      {/* Entry-level probes — the MCP dialog idiom: standalone buttons, results as toasts. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={b.testing || b.busy || !b.testable}
          onClick={() => void b.testConnection()}
        >
          {b.testing ? S.feishu.testing : S.feishu.test}
        </Button>
        <Button
          size="sm"
          disabled={b.sendingTest || b.busy || b.status.state !== "connected" || !b.lastChatKnown}
          {...(!b.lastChatKnown ? { title: S.feishu.testMessageNoChat } : {})}
          onClick={() => void b.sendTestMessage()}
        >
          {b.sendingTest ? S.feishu.sendingTestMessage : S.feishu.sendTestMessage}
        </Button>
      </div>
      {/* Format guidance, kept visible while the target chat is still unknown: the send
          button above stays disabled until the bot has been messaged once. */}
      {!b.lastChatKnown && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{S.feishu.testMessageNoChat}</p>
      )}
      <Input
        size="sm"
        label={S.feishu.appId}
        required
        error={errorText(b.fieldErrors.appId)}
        value={form.appId}
        onChange={(e) => b.patchForm({ appId: e.target.value })}
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
        value={form.appSecret}
        onChange={(e) => b.patchForm({ appSecret: e.target.value })}
        autoComplete="off"
      />
      <Input
        size="sm"
        label={S.feishu.baseDomain}
        hint={S.feishu.baseDomainHint}
        error={errorText(b.fieldErrors.baseDomain)}
        value={form.baseDomain}
        onChange={(e) => b.patchForm({ baseDomain: e.target.value })}
        className="font-mono"
        placeholder="https://open.feishu.cn"
        autoComplete="off"
      />
    </div>
  );
}
