/**
 * Messaging page (/messaging): every messaging binding of the current Project in one
 * list — the management counterpart of the session-row "Bind to Feishu…" dialog. Each row
 * names its Session (clickable, opens the chat), agent, channel and live runtime status,
 * and offers edit (the same binding dialog, not a fork of it) and unbind (confirmed).
 * Bindings are CREATED from the session row's menu — the empty state says so — so this
 * page stays a pure list + edit/unbind surface.
 *
 * The list is re-polled at a slow cadence while the page is open, so status flips (a
 * reconnect, an expiring credential) show up without a reload — the binding dialog's
 * status-line convention at page scale.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type {
  MessagingBindingSummary,
  MessagingRuntimeStatus,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneInk, type Tone } from "../../lib/tone";
import { agentDisplayName, useProject } from "../../state/project";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { FEISHU_ICON } from "../../components/ui/session-row-menu";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError } from "../../components/ui/toast";
import { FeishuBindingModal } from "../chat/feishu-binding-modal";
import { ICON_SIZE } from "../../lib/icon-scale";

/** Same status-refresh cadence idea as the binding dialog, at page scale (one light GET). */
const LIST_POLL_MS = 5000;

const STATUS_TONE: Record<MessagingRuntimeStatus["state"], Tone> = {
  disconnected: "muted",
  connecting: "busy",
  connected: "success",
  error: "danger",
};

/** Channel cell: the channel's glyph + display name (Feishu is the only channel today). */
function ChannelCell({ channel }: { channel: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="shrink-0 text-gray-400 dark:text-gray-500">
        <GlyphIcon d={FEISHU_ICON} size={ICON_SIZE.rowLead} />
      </span>
      {S.messaging.channelNames[channel] ?? channel}
    </span>
  );
}

export function MessagingPage() {
  useDocumentTitle(S.messaging.title);
  const navigate = useNavigate();
  const { currentProject, agents, setCurrentAgentId } = useProject();
  const projectId = currentProject?.projectId ?? null;

  // null = first load still in flight (skeleton); afterwards always an array.
  const [bindings, setBindings] = useState<MessagingBindingSummary[] | null>(null);
  const [editing, setEditing] = useState<MessagingBindingSummary | null>(null);
  const [removing, setRemoving] = useState<MessagingBindingSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (initial: boolean) => {
      if (!projectId) return;
      try {
        const res = await api.listProjectMessaging(projectId);
        setBindings(res.bindings);
      } catch (e) {
        // The poll fails silently (a blip must not toast every 5s); the first load reports.
        if (initial) toastError(apiErrorText(e));
      }
    },
    [projectId],
  );

  useEffect(() => {
    setBindings(null);
    void refresh(true);
    const timer = setInterval(() => void refresh(false), LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  /** Mirrors the sidebar's openSession: the current Agent follows the opened Session's Agent. */
  const openSession = (b: MessagingBindingSummary) => {
    setCurrentAgentId(b.agentId);
    navigate(`/chat/${b.sessionId}`);
  };

  const confirmUnbind = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.deleteFeishuBinding(removing.sessionId);
      setRemoving(null);
      await refresh(false);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{S.messaging.title}</h1>
        </div>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{S.messaging.description}</p>

        {bindings === null ? (
          <SkeletonList rows={3} />
        ) : bindings.length === 0 ? (
          <EmptyState title={S.messaging.emptyTitle} description={S.messaging.empty} />
        ) : (
          <div className="overflow-x-auto overflow-y-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                  <th className="px-3 py-2.5">{S.messaging.colSession}</th>
                  <th className="px-3 py-2.5">{S.messaging.colAgent}</th>
                  <th className="px-3 py-2.5">{S.messaging.colChannel}</th>
                  <th className="px-3 py-2.5">{S.messaging.colStatus}</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {bindings.map((b) => {
                  const agent = agents.find((a) => a.agentId === b.agentId);
                  const agentName = agent ? agentDisplayName(agent) : b.agentId;
                  return (
                    <tr
                      key={b.sessionId}
                      className="border-b border-gray-100 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
                    >
                      <td className="max-w-[280px] px-3 py-2">
                        <button
                          type="button"
                          title={S.messaging.openSession}
                          onClick={() => openSession(b)}
                          className="max-w-full truncate text-left underline-offset-2 hover:underline"
                        >
                          {b.sessionTitle ?? S.chat.defaultSessionTitle}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-600 dark:text-gray-300">
                          <AgentAvatar
                            id={b.agentId}
                            name={agentName}
                            size={ICON_SIZE.rowLead}
                            className="rounded"
                          />
                          <span className="max-w-[160px] truncate">{agentName}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                        <ChannelCell channel={b.channel} />
                      </td>
                      <td className="px-3 py-2">
                        <span
                          {...(b.status.lastError !== undefined
                            ? { title: b.status.lastError }
                            : {})}
                          className={`text-xs font-medium whitespace-nowrap ${toneInk[STATUS_TONE[b.status.state]]}`}
                        >
                          {S.feishu.status[b.status.state]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>
                          {S.common.edit}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(b)}>
                          {S.feishu.unbind}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Edit reuses the binding dialog itself (opened with an explicit session id). */}
        {editing && (
          <FeishuBindingModal
            sessionId={editing.sessionId}
            onClose={() => {
              setEditing(null);
              void refresh(false);
            }}
            onChanged={() => void refresh(false)}
          />
        )}

        <ConfirmModal
          open={removing !== null}
          title={S.feishu.unbindConfirmTitle}
          busy={busy}
          onClose={() => (busy ? undefined : setRemoving(null))}
          onConfirm={() => void confirmUnbind()}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">{S.feishu.unbindConfirmBody}</p>
        </ConfirmModal>
      </div>
    </div>
  );
}
