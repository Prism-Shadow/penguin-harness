import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { WorkbenchInfo, WorkbenchVersion } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  GlyphIcon,
  HelpFold,
  IconButton,
  ICONS,
  ICON_SIZE,
  ListRow,
  SettingsList,
  SettingsEmpty,
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
import { useAgentLocation } from "../../lib/agent-location";
import { localizedText } from "../../lib/skill-use";
import { SkillTile } from "../skills";

/** Agent-owned workbenches, including broken and handler-only packages. */
export function WorkbenchesTab({ agentId }: { agentId: string }) {
  const { currentProject, reloadAgents } = useProject();
  const projectId = currentProject?.projectId;
  /** The machine the Agent lives on, where its workbenches are; null for this server. */
  const machineId = useAgentLocation();
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
      setItems((await api.getWorkbenches(projectId, agentId, machineId)).workbenches);
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    }
  }, [projectId, agentId, machineId]);
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
      if (machineId === null) void reloadAgents();
    } catch (err) {
      toastError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (!projectId) return null;
  return (
    <div className="space-y-4">
      <HelpFold label={S.agent.tabWorkbenches}>{S.workbenches.agentTabDesc}</HelpFold>
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
        <SettingsEmpty>{S.workbenches.empty}</SettingsEmpty>
      ) : (
        items && (
          <SettingsList label={S.agent.tabWorkbenches}>
            {items.map((workbench) => {
              const first = workbenchTabsOf([workbench])[0];
              const title = first
                ? localizedText(locale, first.title, first.titleZh)
                : workbench.name;
              return (
                <ListRow
                  key={workbench.id}
                  as="li"
                  leading={<SkillTile name={workbench.id} fallback={ICONS.anvil} />}
                  title={title}
                  description={workbench.error ?? workbench.id}
                  meta={workbench.version ? `v${workbench.version}` : undefined}
                  trailing={
                    <>
                      {first && (
                        <IconButton
                          label={`${S.workbenches.open} ${title}`}
                          title={S.workbenches.open}
                          onClick={() =>
                            void navigate("/chat/new", {
                              state: {
                                agentId,
                                workspace: "",
                                // A machine's Agent runs there: its temporary Workspace on it.
                                ...(machineId !== null ? { machineId } : {}),
                                workbench: {
                                  projectId,
                                  agentId,
                                  tabId: first.tabId,
                                  machineId,
                                },
                              },
                            })
                          }
                        >
                          <GlyphIcon d={ICONS.externalLink} size={ICON_SIZE.iconButton} />
                        </IconButton>
                      )}
                      <IconButton
                        label={`${S.workbenches.reload} ${title}`}
                        title={S.workbenches.reload}
                        disabled={busy}
                        onClick={() =>
                          void act(() =>
                            api.reloadWorkbench(projectId, agentId, workbench.id, machineId),
                          )
                        }
                      >
                        <GlyphIcon d={ICONS.refresh} size={ICON_SIZE.iconButton} />
                      </IconButton>
                      <IconButton
                        label={`${S.workbenches.history} ${title}`}
                        title={S.workbenches.history}
                        disabled={busy}
                        onClick={() =>
                          void act(async () =>
                            setHistory({
                              workbench,
                              versions: (
                                await api.getWorkbenchHistory(
                                  projectId,
                                  agentId,
                                  workbench.id,
                                  machineId,
                                )
                              ).versions,
                            }),
                          )
                        }
                      >
                        <GlyphIcon d={ICONS.history} size={ICON_SIZE.iconButton} />
                      </IconButton>
                      <IconButton
                        label={`${S.workbenches.remove} ${title}`}
                        title={S.workbenches.remove}
                        variant="danger"
                        disabled={busy}
                        onClick={() => setConfirm({ workbench })}
                      >
                        <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
                      </IconButton>
                    </>
                  }
                />
              );
            })}
          </SettingsList>
        )
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
                machineId,
              );
            else await api.removeWorkbench(projectId, agentId, confirm.workbench.id, machineId);
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
