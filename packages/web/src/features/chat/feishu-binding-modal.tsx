/**
 * Feishu binding dialog (session-row "Bind to Feishu…"): APP_ID / APP_SECRET / API-domain
 * form with an enabled switch, a credential test on the draft values, a "send test
 * message" probe of the outbound leg, and an unbind behind a confirmation. Modeled on the
 * MCP-server dialog (immediate persistence, test-as-toast); on top of that it keeps a live
 * status line — the GET is re-polled while the dialog is open, so connect/error flips show
 * up without closing it — which is also why a successful save keeps the dialog open.
 *
 * The secret never round-trips: the field always starts empty, and submitting it empty
 * keeps the stored secret (the server's PUT contract).
 */
import { useEffect, useState } from "react";
import type { FeishuRuntimeStatus, SessionInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk, type Tone } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { PasswordInput } from "../../components/ui/password-input";
import { Switch } from "../../components/ui/switch";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { toastError, toastSuccess } from "../../components/ui/toast";
import {
  bindingToForm,
  emptyFeishuForm,
  formToPut,
  formToTest,
  type FeishuFormErrors,
  type FeishuFormState,
} from "./feishu-binding-form";

/** How often the open dialog refreshes the runtime status (connects settle within a poll or two). */
const STATUS_POLL_MS = 3000;

const STATUS_TONE: Record<FeishuRuntimeStatus["state"], Tone> = {
  disconnected: "muted",
  connecting: "busy",
  connected: "success",
  error: "danger",
};

function errorText(code: FeishuFormErrors[keyof FeishuFormErrors]): string | undefined {
  if (code === undefined) return undefined;
  return code === "required" ? S.common.requiredField : S.feishu.invalidDomain;
}

export function FeishuBindingModal({
  session,
  onClose,
  onChanged,
}: {
  session: SessionInfo;
  onClose: () => void;
  /** Fired after a save/unbind changed whether the Session is bound (the sidebar refreshes its row indicator). */
  onChanged?: (sessionId: string, bound: boolean) => void;
}) {
  const sessionId = session.sessionId;
  // null until the stored binding has been loaded (the form must start from it, not race it).
  const [form, setForm] = useState<FeishuFormState | null>(null);
  const [hasStored, setHasStored] = useState(false);
  const [status, setStatus] = useState<FeishuRuntimeStatus>({ state: "disconnected" });
  const [lastChatKnown, setLastChatKnown] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FeishuFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  // Initial load fills the form; the poll afterwards refreshes ONLY the runtime facts
  // (status / chat-known / bound), never the fields being edited.
  useEffect(() => {
    let cancelled = false;
    const refresh = async (initial: boolean) => {
      try {
        const res = await api.getFeishuBinding(sessionId);
        if (cancelled) return;
        setStatus(res.status);
        setHasStored(res.binding !== null);
        setLastChatKnown(res.binding?.lastChatKnown ?? false);
        if (initial) setForm(res.binding ? bindingToForm(res.binding) : emptyFeishuForm());
      } catch (e) {
        if (cancelled) return;
        if (initial) {
          toastError(apiErrorText(e));
          onClose();
        }
      }
    };
    void refresh(true);
    const timer = setInterval(() => void refresh(false), STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // onClose is stable enough for the load-failure path; re-running on its identity
    // would restart the poll every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const patchForm = (patch: Partial<FeishuFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setFieldErrors({});
  };

  /** Probes the current draft values (stored ones fill any blank), reporting as a toast. */
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

  /** Save = persist + (re)connect when enabled; the dialog stays open to show the status flip. */
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
      setLastChatKnown(res.binding?.lastChatKnown ?? false);
      // The secret is stored now: clear the field back to the keep-stored state.
      if (res.binding) setForm(bindingToForm(res.binding));
      toastSuccess(S.common.saved);
      onChanged?.(sessionId, true);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const unbind = async () => {
    setBusy(true);
    try {
      await api.deleteFeishuBinding(sessionId);
      setUnbinding(false);
      onChanged?.(sessionId, false);
      onClose();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  // The credential probe needs an app identity: the draft's, or the stored binding's.
  const testable = form !== null && (form.appId.trim() !== "" || hasStored);

  return (
    <>
      <Modal
        open
        title={S.feishu.dialogTitle}
        onClose={onClose}
        footer={
          <>
            {hasStored && (
              <Button variant="danger" disabled={busy} onClick={() => setUnbinding(true)}>
                {S.feishu.unbind}
              </Button>
            )}
            <Button onClick={onClose}>{S.common.close}</Button>
            <Button variant="primary" disabled={busy || form === null} onClick={() => void save()}>
              {busy ? S.common.saving : S.common.save}
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{S.feishu.dialogIntro}</p>
            {/* Runtime status line: refreshed by the poll while the dialog is open. */}
            <p className="flex items-center gap-2 text-xs">
              <span className="text-gray-500 dark:text-gray-400">{S.feishu.statusLabel}</span>
              <span
                {...(status.lastError !== undefined ? { title: status.lastError } : {})}
                className={`font-medium ${toneInk[STATUS_TONE[status.state]]}`}
              >
                {S.feishu.status[status.state]}
              </span>
              {status.state === "error" && status.lastError !== undefined && (
                <span className="min-w-0 flex-1 truncate text-gray-400 dark:text-gray-500">
                  {status.lastError}
                </span>
              )}
            </p>
            {/* Entry-level probes — the MCP dialog idiom: standalone buttons, results as toasts. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={testing || busy || !testable}
                onClick={() => void testConnection()}
              >
                {testing ? S.feishu.testing : S.feishu.test}
              </Button>
              <Button
                size="sm"
                disabled={sendingTest || busy || !hasStored || !lastChatKnown}
                {...(!lastChatKnown ? { title: S.feishu.testMessageNoChat } : {})}
                onClick={() => void sendTestMessage()}
              >
                {sendingTest ? S.feishu.sendingTestMessage : S.feishu.sendTestMessage}
              </Button>
            </div>
            {/* Format guidance, kept visible while the target chat is still unknown: the
                send button above stays disabled until the bot has been messaged once. */}
            {!lastChatKnown && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {S.feishu.testMessageNoChat}
              </p>
            )}
            <Input
              size="sm"
              label={S.feishu.appId}
              required
              error={errorText(fieldErrors.appId)}
              value={form.appId}
              onChange={(e) => patchForm({ appId: e.target.value })}
              className="font-mono"
              placeholder="cli_xxxxxxxxxxxxxxxx"
              autoComplete="off"
            />
            <PasswordInput
              size="sm"
              label={S.feishu.appSecret}
              {...(hasStored ? { hint: S.feishu.appSecretKeepHint } : { required: true })}
              error={errorText(fieldErrors.appSecret)}
              value={form.appSecret}
              onChange={(e) => patchForm({ appSecret: e.target.value })}
              autoComplete="off"
            />
            <Input
              size="sm"
              label={S.feishu.baseDomain}
              hint={S.feishu.baseDomainHint}
              error={errorText(fieldErrors.baseDomain)}
              value={form.baseDomain}
              onChange={(e) => patchForm({ baseDomain: e.target.value })}
              className="font-mono"
              placeholder="https://open.feishu.cn"
              autoComplete="off"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Switch checked={form.enabled} onChange={(v) => patchForm({ enabled: v })} />
              {S.feishu.enabled}
            </label>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={unbinding}
        title={S.feishu.unbindConfirmTitle}
        busy={busy}
        onClose={() => setUnbinding(false)}
        onConfirm={() => void unbind()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.feishu.unbindConfirmBody}</p>
      </ConfirmModal>
    </>
  );
}
