/**
 * The workbenches of one Agent on its settings page's Plugins tab, Workbenches sub-page
 * (plugins-tab.tsx): the row each workbench shows — broken and handler-only packages included —
 * and the "Import workbench" dialog. The files are the truth, so the tab reads its lists again
 * after every action.
 *
 * A row offers Enable, Open, and the action to hide or unhide the app in the App Center. The title, and a click anywhere else on the row that
 * is not one of its controls, opens the workbench's own files read-only (part-files-dialog.tsx).
 * A workbench a plugin installed carries the puzzle mark after its title, naming the plugin and
 * pointing at its row on the Plugins sub-page, and its removal says which plugin installed it.
 *
 * - The Enable switch is the Project owner's and commits at once; while the Agent-wide "Enable
 *   workbenches" is off every row's switch is greyed at its own value, and a server older than
 *   the switches gets none. A workbench that does not run (its own switch or the Agent-wide one
 *   is off) has nothing to open or reload; its history, restore, export and removal stay.
 * - The visibility button writes `penguin.appCenter.show` in the manifest. A refused write
 *   restores the previous action. A machine's Agent has it as well, written
 *   on that machine: the App Center lists a machine's apps for an administrator, and its "Remove
 *   from App Center" is this same setting, so this row is where such an app comes back.
 * - The sidebar setting is the menu's checkable "Show in the sidebar", on every row whose server
 *   reports it (`showInSidebar`). It commits at once and writes the installation's
 *   `.hidden-from-sidebar` marker, never the package.json: no reload and no version, and a plugin
 *   update keeps it, where it resets the App Center's. Every member sees the same sidebar list.
 *   A refused write puts it back.
 * - "Open" opens the app's window over the main area, the one the App Center and the sidebar's
 *   list open (lib/running-apps.ts): the same live window when the app runs, and closing or
 *   minimizing it comes back here.
 * - A workbench without a page has no window to show what its load said, so its row does: the
 *   load error, else the first hint, with every hint in the row's hint.
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
import { locatedAppKey } from "../../lib/app-center-path";
import { useRestoreApp } from "../../lib/running-apps";
import { shortcutOfWorkbench } from "../../lib/workbench-shortcut";
import type { WorkbenchInfo, WorkbenchVersion } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  GlyphAction,
  ICONS,
  ListRow,
  Modal,
  Switch,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { formatDateTime } from "../../lib/format";
import { useInstantSetting } from "../../lib/instant-setting";
import { S } from "../../lib/strings";
import { workbenchTabsOf } from "../../lib/workbench-tabs";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { useAgentLocation } from "../../lib/agent-location";
import { localizedText } from "../../lib/skill-use";
import { toastApiError } from "../../lib/toast-api-error";
import { downloadArchive } from "./archive-download";
import { ChatOrZipImportDialog } from "./chat-or-zip-import-dialog";
import { buildWorkbenchImportPrompt } from "./workbench-import";
import { cardBodyClick } from "../../lib/card-open";
import type { PartRef, PartSource } from "./plugins-subpages";
import {
  LabelledSwitch,
  WorkbenchMark,
  WorkbenchRowMenu,
  type SettingControl,
} from "./workbench-row";

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
  /** The plugin that installed a workbench, by its id; undefined for the user's own. */
  sourceOf: (id: string) => PartSource | undefined;
  /** Opens a part's own files: the row's body, and its name for the keyboard. */
  onOpenFiles: (part: PartRef) => void;
  /** Shows the plugin a part came from on the Plugins sub-page: its row marked, no detail opened. */
  onShowPlugin: (plugin: string) => void;
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
 * One workbench's App Center setting: `penguin.appCenter.show` in its package.json, written at
 * once and adopted from the answer, rolled back with a toast when refused. The row draws it twice
 * — its switch and its More menu's row — so it hands the one setting to `children`, and both
 * controls share one write, one optimistic value and one rollback.
 */
function WorkbenchAppCenter({
  workbench,
  options,
  children,
}: {
  workbench: WorkbenchInfo;
  options: WorkbenchRowsOptions;
  children: (appCenter: SettingControl) => ReactNode;
}) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** The machine the Agent lives on, whose copy of the workbench is written; null for this server. */
  const machineId = useAgentLocation();
  const setting = useInstantSetting(workbench.appCenter?.show === true, async (show: boolean) => {
    if (!projectId) return;
    const res = await api.setWorkbenchAppCenter(
      projectId,
      options.agentId,
      workbench.id,
      show,
      machineId,
    );
    options.onSwitched(res.workbench);
  });
  return children({
    checked: setting.value,
    disabled: setting.busy,
    onChange: (show) => void setting.set(show),
  });
}

/**
 * One workbench's sidebar setting: its `.hidden-from-sidebar` marker, written at once on the
 * server the Agent lives on and adopted from the answer, rolled back with a toast when refused.
 * Absent (`children(undefined)`) when that server does not report the setting.
 */
function WorkbenchSidebar({
  workbench,
  options,
  children,
}: {
  workbench: WorkbenchInfo;
  options: WorkbenchRowsOptions;
  children: (sidebar: SettingControl | undefined) => ReactNode;
}) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** The machine the Agent lives on, whose copy of the workbench carries the marker. */
  const machineId = useAgentLocation();
  const setting = useInstantSetting(workbench.showInSidebar !== false, async (show: boolean) => {
    if (!projectId) return;
    const res = await api.setWorkbenchSidebar(
      projectId,
      options.agentId,
      workbench.id,
      show,
      machineId,
    );
    options.onSwitched(res.workbench);
  });
  if (workbench.showInSidebar === undefined) return children(undefined);
  return children({
    checked: setting.value,
    disabled: setting.busy,
    onChange: (show) => void setting.set(show),
  });
}

/**
 * What a row says under its title: the load error when its files do not load; for a workbench
 * without a page, which has no window to say it in, the first thing its load noticed (every one
 * in the hint); else its id.
 */
function loadNotice(workbench: WorkbenchInfo): ReactNode {
  // Strings stay strings: the row caps a long line it is given as text.
  if (workbench.error !== null) return workbench.error;
  const hints = workbench.tabs.length === 0 ? (workbench.hints ?? []) : [];
  if (hints.length === 0) return workbench.id;
  return (
    <span
      data-tooltip={hints.join("\n")}
      data-tooltip-content="text"
      data-tooltip-extra={hints.length > 1}
    >
      {hints[0]}
    </span>
  );
}

/**
 * The rows of an Agent's workbenches, and the history dialog and the confirmation (restore,
 * remove) they share. A row shows the icon of the plugin it came from when the workbench declares
 * no App Center icon of its own; the anvil without either.
 */
export function useWorkbenchRows(options: WorkbenchRowsOptions): {
  row: (workbench: WorkbenchInfo) => ReactNode;
  modals: ReactNode;
} {
  const { agentId, onChanged, sourceOf, onOpenFiles, onShowPlugin } = options;
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** The machine the Agent lives on, where its workbenches are; null for this server. */
  const machineId = useAgentLocation();
  const { locale } = useLocale();
  const restore = useRestoreApp();
  const local = agents.find((agent) => agent.agentId === agentId);
  const agentName = machineId === null && local ? agentDisplayName(local) : agentId;
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

  const row = (workbench: WorkbenchInfo) => {
    const first = workbenchTabsOf([workbench])[0];
    const title = first ? localizedText(locale, first.title, first.titleZh) : workbench.name;
    /** A switched-off workbench loads nothing: there is no page to open and nothing to reload. */
    const running = options.allEnabled !== false && workbench.enabled !== false;
    const { enabled } = workbench;
    const source = sourceOf(workbench.id);
    // The body opens the workbench's files; "Open" stays the way into the app.
    const open = () => onOpenFiles({ kind: "workbench", name: workbench.id, title });
    /** The row's controls, the App Center setting among them, and the sidebar's when it has one. */
    const controls = (appCenter: SettingControl, sidebar: SettingControl | undefined) => (
      <>
        {enabled !== undefined && (
          <WorkbenchSwitch workbench={{ ...workbench, enabled }} title={title} options={options} />
        )}
        {first && running && projectId && (
          <Button
            size="sm"
            aria-label={`${S.workbenches.open} ${title}`}
            onClick={() =>
              restore(
                locatedAppKey(agentId, workbench.id, machineId),
                shortcutOfWorkbench(projectId, { agentId, agentName }, workbench, machineId),
              )
            }
          >
            {S.workbenches.openAction}
          </Button>
        )}
        <Button
          size="sm"
          disabled={appCenter.disabled}
          aria-label={`${S.workbenches.appCenterVisibility(appCenter.checked)} ${title}`}
          data-tooltip={S.workbenches.appCenterVisibilityHint}
          data-tooltip-extra
          onClick={() => appCenter.onChange(!appCenter.checked)}
        >
          {S.workbenches.appCenterVisibility(appCenter.checked)}
        </Button>
        <WorkbenchRowMenu
          title={title}
          disabled={busy}
          sidebar={sidebar}
          onReload={
            running
              ? () =>
                  void act(() => api.reloadWorkbench(projectId!, agentId, workbench.id, machineId))
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
    );
    return (
      <ListRow
        key={`workbench:${workbench.id}`}
        as="li"
        leading={<WorkbenchMark workbench={workbench} pluginIcon={source?.icon} />}
        title={title}
        onClick={open}
        onBodyClick={cardBodyClick(open)}
        titleTrail={
          source !== undefined && (
            <GlyphAction
              glyph={ICONS.puzzle}
              label={S.agentPlugins.partSource(source.title)}
              onClick={() => onShowPlugin(source.name)}
            />
          )
        }
        description={loadNotice(workbench)}
        meta={workbench.version ? `v${workbench.version}` : undefined}
        trailing={
          <WorkbenchSidebar workbench={workbench} options={options}>
            {(sidebar) => (
              <WorkbenchAppCenter workbench={workbench} options={options}>
                {(appCenter) => controls(appCenter, sidebar)}
              </WorkbenchAppCenter>
            )}
          </WorkbenchSidebar>
        }
      />
    );
  };

  /** The plugin the workbench being removed came from: the confirmation says where to get it back. */
  const removingSource =
    confirm !== null && confirm.revision === undefined ? sourceOf(confirm.workbench.id) : undefined;
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
        {confirm?.revision ? (
          S.workbenches.restoreConfirm(confirm.revision)
        ) : (
          <div className="space-y-2">
            <p>{S.workbenches.removeConfirm}</p>
            {removingSource !== undefined && (
              <p>{S.agentPlugins.partFromPluginNote(removingSource.title)}</p>
            )}
          </div>
        )}
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
  /** A zip landed, as its load left the workbench: the sub-page closes the dialog and reads the lists again. */
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
