/**
 * A schedule's webhook trigger, inside its detail dialog: create the trigger (the URL
 * shows once — copy it then), read its shape, rotate or delete it, flip it on and off,
 * set or clear its signing secret, and read the delivery audit trail with per-row
 * replay. Members read; every write is owner-only, like the dialog around it.
 *
 * Old servers predate the routes: every call 404s without the webhook envelope, and
 * the section then stays hidden instead of crying wolf.
 */
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  ConfirmModal,
  Select,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import type { BadgeStyle } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import type {
  ScheduleWebhookDeliveryView,
  ScheduleWebhookProvider,
  ScheduleWebhookView,
} from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { writeClipboard } from "../../lib/clipboard";
import { formatDateTime } from "../../lib/format";
import { shortSession } from "./schedule-fire";

const DELIVERY_BADGE: Record<string, BadgeStyle> = {
  accepted: { tone: "success" },
  duplicate: { tone: "neutral" },
  ignored: { tone: "attention" },
  rejected: { tone: "danger" },
  queued: { tone: "neutral", variant: "solid" },
  skipped: { tone: "neutral" },
};

export function ScheduleWebhookSection({
  projectId,
  agentId,
  name,
  canEdit,
}: {
  projectId: string;
  agentId: string;
  name: string;
  /** Members read; writes stay owner-only. */
  canEdit: boolean;
}) {
  // The trigger, once read: null while loading, "missing" when the schedule has none,
  // "stale" when the server predates the routes (the section then hides itself).
  const [view, setView] = useState<ScheduleWebhookView | "missing" | "stale" | null>(null);
  const [deliveries, setDeliveries] = useState<ScheduleWebhookDeliveryView[] | null>(null);
  /** The trigger URL right after creation or rotation: shown once, never re-read. */
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ScheduleWebhookProvider>("generic");
  const [secret, setSecret] = useState("");
  const [editingSecret, setEditingSecret] = useState(false);
  const [confirming, setConfirming] = useState<"rotate" | "delete" | null>(null);

  const load = async () => {
    try {
      const [v, d] = await Promise.all([
        api.getScheduleWebhook(projectId, agentId, name),
        api.listScheduleWebhookDeliveries(projectId, agentId, name, 10),
      ]);
      setView(v);
      setDeliveries(d.deliveries);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && e.code === "webhook_not_found") {
        setView("missing");
        setDeliveries([]);
        setError(null);
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        setView("stale");
        return;
      }
      setError(apiErrorText(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, agentId, name]);

  if (view === null) {
    return (
      <div className="mt-4 border-t border-line-muted pt-3">
        <p className="text-xs font-medium">{S.schedule.webhook.title}</p>
        <p className="mt-1 text-xs text-fg-muted">{S.common.loading}</p>
      </div>
    );
  }
  if (view === "stale") return null;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const created = await api.createScheduleWebhook(projectId, agentId, name, {
        provider,
        ...(secret.trim() === "" ? {} : { secret: secret.trim() }),
      });
      setRevealed(`${window.location.origin}${created.path}`);
      setSecret("");
      setView(created);
      setDeliveries([]);
      toastSuccess(S.schedule.webhook.toastCreated);
    });

  const copyUrl = async () => {
    if (revealed === null) return;
    if (await writeClipboard(revealed)) toastSuccess(S.schedule.webhook.copied);
    else toastError(S.schedule.webhook.copyFailed);
  };

  const toggle = (next: boolean) =>
    run(async () => {
      setView(await api.updateScheduleWebhook(projectId, agentId, name, { enabled: next }));
      toastSuccess(next ? S.schedule.webhook.toastEnabled : S.schedule.webhook.toastDisabled);
    });

  const changeProvider = (next: ScheduleWebhookProvider) =>
    run(async () => {
      setView(await api.updateScheduleWebhook(projectId, agentId, name, { provider: next }));
    });

  const saveSecret = () =>
    run(async () => {
      setView(await api.updateScheduleWebhook(projectId, agentId, name, { secret: secret.trim() }));
      setSecret("");
      setEditingSecret(false);
    });

  const clearSecret = () =>
    run(async () => {
      setView(await api.updateScheduleWebhook(projectId, agentId, name, { secret: null }));
    });

  const rotate = () =>
    run(async () => {
      const rotated = await api.rotateScheduleWebhook(projectId, agentId, name);
      setConfirming(null);
      setRevealed(`${window.location.origin}${rotated.path}`);
      setView(rotated);
      toastSuccess(S.schedule.webhook.toastRotated);
    });

  const remove = () =>
    run(async () => {
      await api.deleteScheduleWebhook(projectId, agentId, name);
      setConfirming(null);
      setRevealed(null);
      setView("missing");
      setDeliveries([]);
      toastSuccess(S.schedule.webhook.toastDeleted);
    });

  const replay = (deliveryId: string) =>
    run(async () => {
      const replayed = await api.replayScheduleWebhookDelivery(projectId, agentId, name, deliveryId);
      toastSuccess(S.schedule.webhook.toastReplayed(shortSession(replayed.run_id)));
      const d = await api.listScheduleWebhookDeliveries(projectId, agentId, name, 10);
      setDeliveries(d.deliveries);
    });

  return (
    <div className="mt-4 border-t border-line-muted pt-3">
      <p className="text-xs font-medium">{S.schedule.webhook.title}</p>
      <p className="mt-1 text-xs text-fg-muted">{S.schedule.webhook.info}</p>
      {error !== null && <p className="mt-2 text-xs text-tone-danger-fg">{error}</p>}

      {revealed !== null && (
        <div className="mt-3 rounded-md border border-line-emphasis bg-control-well p-3">
          <p className="text-xs font-medium">{S.schedule.webhook.createdTitle}</p>
          <p className="mt-1 text-xs text-fg-muted">{S.schedule.webhook.createdHint}</p>
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={revealed}
              aria-label={S.schedule.webhook.createdTitle}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-line-muted bg-control px-2 py-1 font-mono text-xs"
            />
            <Button size="sm" disabled={busy} onClick={() => void copyUrl()}>
              {S.schedule.webhook.copyUrl}
            </Button>
          </div>
        </div>
      )}

      {view === "missing" ? (
        canEdit ? (
          <div className="mt-3 flex flex-col gap-2">
            <Select
              size="sm"
              label={S.schedule.webhook.provider}
              aria-label={S.schedule.webhook.provider}
              value={provider}
              onChange={(e) => setProvider(e.target.value as ScheduleWebhookProvider)}
            >
              <option value="generic">{S.schedule.webhook.providerGeneric}</option>
              <option value="github">{S.schedule.webhook.providerGithub}</option>
            </Select>
            <label className="block text-xs">
              <span className="text-fg-muted">{S.schedule.webhook.secret}</span>
              <input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={S.schedule.webhook.secretPlaceholder}
                className="mt-1 block w-full rounded-md border border-line-muted bg-control px-2 py-1 text-xs"
              />
            </label>
            <div>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void create()}>
                {S.schedule.webhook.create}
              </Button>
            </div>
          </div>
        ) : null
      ) : (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={view.enabled ? "success" : "neutral"}>
              {view.enabled ? S.schedule.webhook.enabledState : S.schedule.webhook.disabledState}
            </Badge>
            <span className="font-mono text-xs text-fg-muted">{view.provider}</span>
            <span className="text-xs text-fg-muted">
              {view.hasSecret
                ? S.schedule.webhook.secretSet(view.secretHint ?? "")
                : S.schedule.webhook.secretUnset}
            </span>
            {view.lastFiredAt !== null && (
              <span className="text-xs text-fg-muted">
                {S.schedule.webhook.lastFired}: {formatDateTime(view.lastFiredAt)}
              </span>
            )}
          </div>

          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void toggle(!view.enabled)}>
                {view.enabled ? S.schedule.webhook.setDisabled : S.schedule.webhook.setEnabled}
              </Button>
              <Select
                size="sm"
                aria-label={S.schedule.webhook.provider}
                value={view.provider}
                disabled={busy}
                onChange={(e) => void changeProvider(e.target.value as ScheduleWebhookProvider)}
              >
                <option value="generic">{S.schedule.webhook.providerGeneric}</option>
                <option value="github">{S.schedule.webhook.providerGithub}</option>
              </Select>
              {editingSecret ? (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={S.schedule.webhook.secretPlaceholder}
                    className="min-w-0 flex-1 rounded-md border border-line-muted bg-control px-2 py-1 text-xs"
                  />
                  <Button size="sm" variant="primary" disabled={busy || secret.trim() === ""} onClick={() => void saveSecret()}>
                    {S.schedule.webhook.saveSecret}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditingSecret(false); setSecret(""); }}>
                    {S.common.cancel}
                  </Button>
                </span>
              ) : (
                <>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditingSecret(true)}>
                    {S.schedule.webhook.changeSecret}
                  </Button>
                  {view.hasSecret && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clearSecret()}>
                      {S.schedule.webhook.clearSecret}
                    </Button>
                  )}
                </>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming("rotate")}>
                {S.schedule.webhook.rotate}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming("delete")}>
                {S.common.delete}
              </Button>
            </div>
          )}

          <p className="mt-3 text-xs font-medium">{S.schedule.webhook.deliveries}</p>
          {deliveries === null ? (
            <p className="mt-1 text-xs text-fg-muted">{S.common.loading}</p>
          ) : deliveries.length === 0 ? (
            <p className="mt-1 text-xs text-fg-muted">{S.schedule.webhook.deliveriesEmpty}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {deliveries.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-xs">
                  <Badge {...(DELIVERY_BADGE[d.status] ?? { tone: "neutral" })}>
                    {S.schedule.webhook.statusNames[d.status] ?? d.status}
                  </Badge>
                  <span className="shrink-0 tabular-nums text-fg-muted">{formatDateTime(d.createdAt)}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-muted">
                    {S.schedule.webhook.signatureNames[d.signatureStatus] ?? d.signatureStatus}
                    {d.event !== "" ? ` · ${d.event}` : ""}
                    {d.attemptCount > 1 ? ` · ×${d.attemptCount}` : ""}
                  </span>
                  {canEdit && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void replay(d.id)}>
                      {S.schedule.webhook.replay}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirming === "rotate"}
        title={S.schedule.webhook.rotateTitle}
        confirmLabel={S.schedule.webhook.rotate}
        cancelLabel={S.common.cancel}
        busy={busy}
        onClose={() => setConfirming(null)}
        onConfirm={() => void rotate()}
      >
        {S.schedule.webhook.rotateConfirm}
      </ConfirmModal>
      <ConfirmModal
        open={confirming === "delete"}
        title={S.schedule.webhook.deleteTitle}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        busy={busy}
        onClose={() => setConfirming(null)}
        onConfirm={() => void remove()}
      >
        {S.schedule.webhook.deleteConfirm}
      </ConfirmModal>
    </div>
  );
}
