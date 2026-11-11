/**
 * The workbenches of one Agent on its settings page's Plugins tab (plugins-tab.tsx): the row each
 * workbench shows in its plugin's group or among the user's own — broken and handler-only
 * packages included — and the "Import workbench" dialog. The files are the truth, so the tab
 * reads its lists again after every action.
 *
 * A row says what its controls do (workbench-row.tsx): its two switches carry their words
 * ("Enable", "App Center"), "Open" is a text button, and the rest — reload, version history,
 * export, remove — are the rows of its "More" menu.
 *
 * - The Enable switch is the Project owner's and commits at once; while the Agent-wide "Enable
 *   workbenches" is off every row's switch is greyed at its own value, and a server older than
 *   the switches gets none. A workbench that does not run (its own switch or the Agent-wide one
 *   is off) has nothing to open or reload; its history, restore, export and removal stay.
 * - The App Center switch, on a row of an Agent on this server (the App Center lists those
 *   only), commits at once too: it rewrites `penguin.appCenter.show` in the workbench's
 *   package.json, and the reload that follows (none while it does not run) records the edit as
 *   a version. A refused write puts the switch back where the file says.
 *
 * Everything but the Enable switch is member-level, matching the workbench routes, and goes to
 * the server the Agent lives on.
 *
 * "Import workbench" is the Skills import's dialog (chat-or-zip-import-dialog.tsx): a chat in
 * which this Agent reviews and installs a workbench from a pasted source (workbench-import.ts),
 * or an upload of a workbench's source as a zip, where a taken id (409 `workbench_exists`) asks
 * before overwriting and an overwrite keeps the workbench's data. Export downloads the source as
 * a zip that imports back unchanged.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import type { IconRef, WorkbenchInfo, WorkbenchVersion } from "@prismshadow/penguin-server/api";
import { Button, ConfirmModal, ListRow, Modal, Switch } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { formatDateTime } from "../../lib/format";
import { useInstantSetting } from "../../lib/instant-setting";
import { S } from "../../lib/strings";
import { workbenchTabsOf } from "../../lib/workbench-tabs";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { useAgentLocation } from "../../lib/agent-location";
import { localizedText } from "../../lib/skill-use";
import { toastApiError } from "../../lib/toast-api-error";
import { downloadArchive } from "./archive-download";
import { ChatOrZipImportDialog } from "./chat-or-zip-import-dialog";
import { buildWorkbenchImportPrompt } from "./workbench-import";
import { AppCenterToggle, LabelledSwitch, WorkbenchMark, WorkbenchRowMenu } from "./workbench-row";

/** The row of the newest version holding the workbench's current files; -1 when none does. */
function currentVersionAt(history: { workbench: WorkbenchInfo; versions: WorkbenchVersion[] }) {
  return history.versions.findIndex((version) => version.revision === history.workbench.revision);
}

/** What a workbench row needs of the tab around it. */
export interface WorkbenchRowsOptions {
  agentId: string;
  /** Reads the tab's lists again after an action. */
  onChanged: () => Promise<void>;
  /** Takes one workbench as a switch write answered it, without reading everything again. */
  onSwitched: (workbench: WorkbenchInfo) => void;
  /** The Agent-wide switch: false greys every row's switch; undefined on a server without it. */
  allEnabled: boolean | undefined;
  /** The switches are the Project owner's. */
  canSwitch: boolean;
}

/**
 * One workbench's own switch: written at once, alone, rolled back with a toast when refused.
 * Greyed at its own value while the Agent-wide switch is off, which the hint says.
 */
function WorkbenchSwitch({
  workbench,
  title,
  options,
}: {
  workbench: WorkbenchInfo & { enabled: boolean };
  title: string;
  options: WorkbenchRowsOptions;
}) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const machineId = useAgentLocation();
  const setting = useInstantSetting(workbench.enabled, async (enabled: boolean) => {
    if (!projectId) return;
    const res = await api.setWorkbenchEnabled(
      projectId,
      options.agentId,
      workbench.id,
      enabled,
      machineId,
    );
    options.onSwitched(res.workbench);
  });
  const allOff = options.allEnabled === false;
  const disabled = setting.busy || allOff || !options.canSwitch;
  return (
    <LabelledSwitch text={S.workbenches.enableLabel} disabled={disabled}>
      <Switch
        checked={setting.value}
        disabled={disabled}
        onChange={(next) => void setting.set(next)}
        aria-label={S.workbenches.enableOne(title)}
        {...(allOff ? { title: S.workbenches.offByAll, "data-tooltip-extra": true } : {})}
      />
    </LabelledSwitch>
  );
}

/**
 * One workbench's App Center switch: `penguin.appCenter.show` in its package.json, written at once
 * and adopted from the answer, rolled back with a toast when refused.
 */
function WorkbenchAppCenterSwitch({
  workbench,
  title,
  options,
}: {
  workbench: WorkbenchInfo;
  title: string;
  options: WorkbenchRowsOptions;
}) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const setting = useInstantSetting(workbench.appCenter?.show === true, async (show: boolean) => {
    if (!projectId) return;
    const res = await api.setWorkbenchAppCenter(
      projectId,
      options.agentId,
      workbench.id,
      show,
      null,
    );
    options.onSwitched(res.workbench);
  });
  return (
    <AppCenterToggle
      title={title}
      checked={setting.value}
      disabled={setting.busy}
      onChange={(show) => void setting.set(show)}
    />
  );
}

/**
 * The rows of an Agent's workbenches, and the history dialog and the confirmation (restore,
 * remove) they share. `icon` on a row is its plugin's icon, shown when the workbench declares no
 * App Center icon of its own; the anvil without either.
 */
export function useWorkbenchRows(options: WorkbenchRowsOptions): {
  row: (workbench: WorkbenchInfo, icon?: IconRef) => ReactNode;
  modals: ReactNode;
} {
  const { agentId, onChanged } = options;
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** The machine the Agent lives on, where its workbenches are; null for this server. */
  const machineId = useAgentLocation();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{
    workbench: WorkbenchInfo;
    versions: WorkbenchVersion[];
  } | null>(null);
  const [confirm, setConfirm] = useState<{ workbench: WorkbenchInfo; revision?: string } | null>(
    null,
  );
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
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

  const row = (workbench: WorkbenchInfo, icon?: IconRef) => {
    const first = workbenchTabsOf([workbench])[0];
    const title = first ? localizedText(locale, first.title, first.titleZh) : workbench.name;
    /** A switched-off workbench loads nothing: there is no page to open and nothing to reload. */
    const running = options.allEnabled !== false && workbench.enabled !== false;
    const { enabled } = workbench;
    return (
      <ListRow
        key={`workbench:${workbench.id}`}
        as="li"
        leading={<WorkbenchMark workbench={workbench} pluginIcon={icon} />}
        title={title}
        description={workbench.error ?? workbench.id}
        meta={workbench.version ? `v${workbench.version}` : undefined}
        trailing={
          <>
            {enabled !== undefined && (
              <WorkbenchSwitch
                workbench={{ ...workbench, enabled }}
                title={title}
                options={options}
              />
            )}
            {machineId === null && (
              <WorkbenchAppCenterSwitch workbench={workbench} title={title} options={options} />
            )}
            {first && running && projectId && (
              <Button
                size="sm"
                aria-label={`${S.workbenches.open} ${title}`}
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
                {S.workbenches.openAction}
              </Button>
            )}
            <WorkbenchRowMenu
              title={title}
              disabled={busy}
              onReload={
                running
                  ? () =>
                      void act(() =>
                        api.reloadWorkbench(projectId!, agentId, workbench.id, machineId),
                      )
                  : undefined
              }
              onHistory={() =>
                void act(async () =>
                  setHistory({
                    workbench,
                    versions: (
                      await api.getWorkbenchHistory(projectId!, agentId, workbench.id, machineId)
                    ).versions,
                  }),
                )
              }
              onExport={() => void exportWorkbench(workbench)}
              onRemove={() => setConfirm({ workbench })}
            />
          </>
        }
      />
    );
  };

  const modals = projectId !== null && (
    <>
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
    </>
  );

  return { row, modals };
}

/**
 * The "Import workbench" dialog: the shared chat-or-zip import, whose chat prompt leads with a
 * sentence for the kind of source and ends with the review, layout and install steps
 * (workbench-import.ts), and whose zip goes to the workbench archive endpoint. A 409
 * `workbench_exists` asks before overwriting, for the id the answer's `details.workbenchId`
 * names (the picked file's stem covers an answer without it).
 */
export function WorkbenchImportDialog({
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
  /** A zip landed, as its load left the workbench: the tab closes the dialog and reads the lists again. */
  onImported: (workbench: WorkbenchInfo) => void;
}) {
  return (
    <ChatOrZipImportDialog
      title={S.workbenches.importTitle}
      strings={S.workbenches}
      buildPrompt={(source) => buildWorkbenchImportPrompt(source, projectId, agentId)}
      agentId={agentId}
      accept=".zip"
      upload={async (body) =>
        (await api.installWorkbenchArchive(projectId, agentId, body, machineId)).workbench
      }
      conflictCode="workbench_exists"
      conflictName={(err) => err.details?.workbenchId}
      onClose={onClose}
      onImported={onImported}
    />
  );
}
