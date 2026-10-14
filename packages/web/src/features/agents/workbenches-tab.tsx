import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { WorkbenchInfo, WorkbenchVersion } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  Modal,
  NoticeStrip,
  SkeletonList,
  toastError,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { WORKBENCH_UPDATED_EVENT, workbenchTabsOf } from "../../lib/workbench-tabs";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { localizedText } from "../chat/skill-use";

/** Agent-owned workbenches, including broken and handler-only packages. */
export function WorkbenchesTab({ agentId }: { agentId: string }) {
  const { currentProject, reloadAgents } = useProject();
  const projectId = currentProject?.projectId;
  const { locale } = useLocale();
  const navigate = useNavigate();
  const [items, setItems] = useState<WorkbenchInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{
    workbench: WorkbenchInfo;
    versions: WorkbenchVersion[];
  } | null>(null);
  const [confirm, setConfirm] = useState<{ workbench: WorkbenchInfo; revision?: string } | null>(
    null,
  );
  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setItems((await api.getWorkbenches(projectId, agentId)).workbenches);
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    }
  }, [projectId, agentId]);
  useEffect(() => {
    void load();
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; agentId: string }>).detail;
      if (detail.projectId === projectId && detail.agentId === agentId) void load();
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, changed);
    return () => window.removeEventListener(WORKBENCH_UPDATED_EVENT, changed);
  }, [load, projectId, agentId]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await load();
      void reloadAgents();
    } catch (err) {
      toastError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (!projectId) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{S.workbenches.title}</h2>
        <Button variant="secondary" size="sm" onClick={() => void navigate("/plugins")}>
          {S.workbenches.browsePlugins}
        </Button>
      </div>
      {error && (
        <NoticeStrip tone="danger">
          {error}
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {S.workbenches.retryHistory}
          </Button>
        </NoticeStrip>
      )}
      {items === null && !error ? (
        <SkeletonList />
      ) : items?.length === 0 ? (
        <p className="py-8 text-sm text-fg-muted">{S.workbenches.empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items?.map((workbench) => {
            const tabs = workbenchTabsOf([workbench]);
            const first = tabs[0];
            return (
              <li
                key={workbench.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-medium">
                    {first ? localizedText(locale, first.title, first.titleZh) : workbench.name}
                  </h3>
                  <p className="mt-1 text-xs text-fg-muted">
                    {workbench.id}
                    {workbench.version ? ` · v${workbench.version}` : ""}
                  </p>
                  {workbench.error && (
                    <p className="mt-2 text-sm text-fg-muted">{workbench.error}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {first && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void navigate("/chat/new", {
                          state: {
                            agentId,
                            workspace: "",
                            workbench: { projectId, agentId, tabId: first.tabId, machineId: null },
                          },
                        })
                      }
                    >
                      {S.workbenches.open}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void act(() => api.reloadWorkbench(projectId, agentId, workbench.id))
                    }
                  >
                    {S.workbenches.reload}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void act(async () =>
                        setHistory({
                          workbench,
                          versions: (
                            await api.getWorkbenchHistory(projectId, agentId, workbench.id)
                          ).versions,
                        }),
                      )
                    }
                  >
                    {S.workbenches.history}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirm({ workbench })}
                  >
                    {S.workbenches.remove}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Modal
        open={history !== null}
        title={S.workbenches.history}
        onClose={() => setHistory(null)}
        widthClass="sm:max-w-2xl"
      >
        {history?.versions.length === 0 && (
          <p className="text-sm text-fg-muted">{S.workbenches.noHistory}</p>
        )}
        <ul className="divide-y divide-line">
          {history?.versions.map((version) => (
            <li key={version.revision} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="font-mono">{version.revision}</span>
              <span className="text-fg-muted">{formatDateTime(version.savedAt)}</span>
              <span className="flex-1" />
              {version.revision === history.workbench.revision ? (
                <span>{S.workbenches.current}</span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({ workbench: history.workbench, revision: version.revision })
                  }
                >
                  {S.workbenches.restore}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Modal>
      <ConfirmModal
        open={confirm !== null}
        title={confirm?.revision ? S.workbenches.restoreTitle : S.workbenches.remove}
        confirmLabel={confirm?.revision ? S.workbenches.restore : S.workbenches.removeYes}
        cancelLabel={S.workbenches.removeNo}
        tone={confirm?.revision ? "primary" : "danger"}
        busy={busy}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        onConfirm={() =>
          void act(async () => {
            if (!confirm) return;
            if (confirm.revision)
              await api.rollbackWorkbench(
                projectId,
                agentId,
                confirm.workbench.id,
                confirm.revision,
              );
            else await api.removeWorkbench(projectId, agentId, confirm.workbench.id);
            setConfirm(null);
            setHistory(null);
          })
        }
      >
        {confirm?.revision
          ? S.workbenches.restoreConfirm(confirm.revision)
          : S.workbenches.removeConfirm}
      </ConfirmModal>
    </div>
  );
}
