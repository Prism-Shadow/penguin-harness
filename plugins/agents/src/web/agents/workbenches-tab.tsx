/**
 * Agent settings page "Workbenches" tab: the Agent's own workbenches, broken and handler-only
 * packages included. Each row opens, reloads, shows the history of, exports or removes one; the
 * files are the truth, so the list is read again after every action. "Import zip" uploads a
 * workbench's source the way the Hooks tab's upload takes a hook package back: a taken id
 * (409 `workbench_exists`) asks before overwriting, and an overwrite keeps the workbench's data.
 * Export downloads the source as a zip that imports back unchanged. Every action is
 * member-level, matching the workbench routes, and goes to the server the Agent lives on.
 */
import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router";
import type { WorkbenchInfo, WorkbenchVersion } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  DownloadIcon,
  GlyphIcon,
  HelpFold,
  HiddenFileInput,
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
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { WORKBENCH_UPDATED_EVENT, workbenchTabsOf } from "../../lib/workbench-tabs";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { useAgentLocation } from "../../lib/agent-location";
import { localizedText } from "../../lib/skill-use";
import { SkillTile } from "../skills/skill-icon-view";
import { toastApiError } from "../../lib/toast-api-error";
import { downloadArchive } from "./archive-download";
import { UPLOAD_LABEL_CLASS } from "./skills-tab";

/** A zip waiting on the overwrite confirm: the payload to resend with `overwrite`, and the id it would replace. */
interface PendingOverwrite {
  dataBase64: string;
  workbenchId: string;
}

/** The row of the newest version holding the workbench's current files; -1 when none does. */
function currentVersionAt(history: { workbench: WorkbenchInfo; versions: WorkbenchVersion[] }) {
  return history.versions.findIndex((version) => version.revision === history.workbench.revision);
}

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
  // The import dialog; what it holds (the upload, its refusal) lives in it, while it is open.
  const [importOpen, setImportOpen] = useState(false);
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
      toastApiError(err);
    } finally {
      setBusy(false);
    }
  };
  /** The shared archive download (archive-download.ts); a failure surfaces as a toast. */
  const exportWorkbench = async (workbench: WorkbenchInfo) => {
    if (!projectId) return;
    try {
      await downloadArchive(
        api.workbenchArchiveUrl(projectId, agentId, workbench.id, machineId),
        workbench.id,
      );
    } catch (err) {
      toastApiError(err);
    }
  };
  /**
   * An upload landed: the dialog closes and the list is read again from disk. Its files are
   * written either way; a load that failed says so instead of a success.
   */
  const imported = async (workbench: WorkbenchInfo) => {
    setImportOpen(false);
    if (workbench.error === null) toastSuccess(S.workbenches.importDoneToast);
    else toastError(S.workbenches.importLoadFailedToast(workbench.error));
    await load();
    // The agent card's workbench count changed; refresh the list provider too.
    if (machineId === null) void reloadAgents();
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
      {/* The Hooks tab's slot: right-aligned at the head of the list, in every list state, so the
          action never shifts. */}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          disabled={items === null}
          onClick={() => setImportOpen(true)}
        >
          {S.workbenches.importAction}
        </Button>
      </div>
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
                        label={`${S.workbenches.exportWorkbench} ${title}`}
                        title={S.workbenches.exportWorkbench}
                        disabled={busy}
                        onClick={() => void exportWorkbench(workbench)}
                      >
                        <DownloadIcon size={ICON_SIZE.iconButton} />
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
          {history?.versions.map((version, index) => (
            <li key={version.commit} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="font-mono">{version.revision}</span>
              <span className="text-fg-muted">{formatDateTime(version.savedAt)}</span>
              <span className="flex-1" />
              {/* A restore records an old revision again: only its newest entry is the current one. */}
              {index === currentVersionAt(history) ? (
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
      {importOpen && (
        <WorkbenchImportDialog
          projectId={projectId}
          agentId={agentId}
          machineId={machineId}
          onClose={() => setImportOpen(false)}
          onImported={(workbench) => void imported(workbench)}
        />
      )}
    </div>
  );
}

/**
 * The "Import workbench" dialog: one zip upload. Nothing is typed in it, so closing asks nothing,
 * but no way of closing works while an upload is in flight. A 409 `workbench_exists` opens the
 * overwrite confirm over the dialog, for the id the answer's `details.workbenchId` names (the
 * picked file's stem covers an answer without it); cancelling returns to the dialog.
 */
function WorkbenchImportDialog({
  projectId,
  agentId,
  machineId,
  onClose,
  onImported,
}: {
  projectId: string;
  agentId: string;
  machineId: string | null;
  onClose: () => void;
  /** A zip landed, as its load left the workbench: the tab closes the dialog and reads the list again. */
  onImported: (workbench: WorkbenchInfo) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [overwriting, setOverwriting] = useState<PendingOverwrite | null>(null);

  const upload = async (dataBase64: string, fallbackId: string, overwrite: boolean) => {
    setUploading(true);
    setUploadError(null);
    try {
      const { workbench } = await api.installWorkbenchArchive(
        projectId,
        agentId,
        { dataBase64, ...(overwrite ? { overwrite: true } : {}) },
        machineId,
      );
      setOverwriting(null);
      onImported(workbench);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === "workbench_exists") {
        setOverwriting({ dataBase64, workbenchId: err.details?.workbenchId ?? fallbackId });
      } else {
        setOverwriting(null);
        setUploadError(apiErrorText(err));
      }
    } finally {
      setUploading(false);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    const fallbackId = file.name.replace(/\.zip$/i, "");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip the data:…;base64, prefix.
      void upload(dataUrl.slice(dataUrl.indexOf(",") + 1), fallbackId, false);
    };
    reader.onerror = () => setUploadError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  return (
    <>
      <Modal
        open
        title={S.workbenches.importTitle}
        onClose={() => {
          if (!uploading) onClose();
        }}
        widthClass="sm:max-w-lg"
      >
        <p className="text-xs text-fg-muted">{S.workbenches.importUploadDesc}</p>
        <label
          className={`${UPLOAD_LABEL_CLASS} mt-2.5 ${uploading ? "pointer-events-none opacity-60" : ""}`}
        >
          <HiddenFileInput accept=".zip" disabled={uploading} onChange={onPickFile} />
          {uploading ? S.workbenches.importUploading : S.workbenches.importUploadAction}
        </label>
        {uploadError !== null && (
          <p className={`mt-1.5 text-xs ${toneInk.danger}`}>{uploadError}</p>
        )}
      </Modal>
      <ConfirmModal
        open={overwriting !== null}
        title={S.workbenches.importOverwriteTitle}
        tone="primary"
        confirmLabel={S.workbenches.importOverwriteAction}
        cancelLabel={S.common.cancel}
        busy={uploading}
        onClose={() => setOverwriting(null)}
        onConfirm={() => {
          if (overwriting !== null)
            void upload(overwriting.dataBase64, overwriting.workbenchId, true);
        }}
      >
        <p className="text-sm text-fg-muted">
          {overwriting !== null ? S.workbenches.importOverwriteBody(overwriting.workbenchId) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
