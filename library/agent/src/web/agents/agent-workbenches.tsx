/**
 * The workbenches of one Agent on its settings page's Plugins tab, Workbenches sub-page
 * (plugins-tab.tsx): the row each workbench shows — broken and handler-only packages included —
 * and the "Import workbench" dialog. The files are the truth, so the tab reads its lists again
 * after every action.
 *
 * A row offers Enable and Open. The title, and a click anywhere else on the row that
 * is not one of its controls, opens the workbench's own files read-only (part-files-dialog.tsx).
 * A workbench a plugin installed shows the puzzle mark in its file details, naming the plugin and
 * pointing at its row on the Plugins sub-page, and its removal says which plugin installed it.
 *
 * - The Enable switch is the Project owner's and commits at once; while the Agent-wide "Enable
 *   workbenches" is off every row's switch is greyed at its own value, and a server older than
 *   the switches gets none. A workbench that does not run (its own switch or the Agent-wide one
 *   is off) has nothing to open or reload; its history, restore, export and removal stay.
 * - "Open" opens the app's window over the main area, the one the App Center and the sidebar's
 *   list open (lib/running-apps.ts): the same live window when the app runs, and closing or
 *   minimizing it comes back here.
 * - A workbench without a page has no window to show what its load said, so its row does: the
 *   load error, else the first hint, with every hint in the row's hint. While its files do not
 *   load, the More menu also offers "Fix with AI" (features/ai-create/workbench-repair.tsx) and the
 *   error's report.
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
import type { ReactNode } from "react";
import { locatedAppKey } from "@prismshadow/penguin-web/internal";
import { useRestoreApp } from "@prismshadow/penguin-web/internal";
import { shortcutOfWorkbench } from "@prismshadow/penguin-web/internal";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import {
  Button,
  GlyphAction,
  ICONS,
  ListRow,
  Switch,
  openReport,
  toldReport,
} from "@prismshadow/penguin-ui";
import * as api from "@prismshadow/penguin-web/internal";
import { useInstantSetting } from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import { workbenchTabsOf } from "@prismshadow/penguin-web/internal";
import { useLocale } from "@prismshadow/penguin-web/internal";
import { agentDisplayName, useProject } from "@prismshadow/penguin-web/internal";
import { useAgentLocation } from "@prismshadow/penguin-web/internal";
import { localizedText } from "@prismshadow/penguin-web/internal";
import { useWorkbenchRepair } from "@prismshadow/penguin-web/internal";
import { useWorkbenchActions, workbenchLoadFailure } from "@prismshadow/penguin-web/internal";
import type { LoadFailedActions } from "@prismshadow/penguin-web/internal";
import { ChatOrZipImportDialog } from "./chat-or-zip-import-dialog";
import { buildWorkbenchImportPrompt } from "./workbench-import";
import { cardBodyClick } from "@prismshadow/penguin-web/internal";
import type { PartRef, PartSource } from "./plugins-subpages";
import { LabelledSwitch, WorkbenchMark } from "./workbench-row";

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
  detailActions: (workbench: WorkbenchInfo, title: string) => ReactNode;
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
  const { menu, modals: actionModals } = useWorkbenchActions(
    { projectId, agentId, machineId },
    onChanged,
  );
  const { repair, modal: repairModal } = useWorkbenchRepair();
  const modals = (
    <>
      {actionModals}
      {repairModal}
    </>
  );
  /**
   * The More menu's two extra rows while the files do not load. The report is made when it is
   * asked for: the row shows the error long after the load that wrote it.
   */
  const failedActions = (
    workbench: WorkbenchInfo,
    title: string,
  ): LoadFailedActions | undefined => {
    const error = workbench.error;
    if (error === null) return undefined;
    const failure = { workbenchId: workbench.id, machineId, error };
    return {
      onRepair: () => repair({ ...failure, name: title, agentId }),
      onReport: () => openReport(toldReport(workbenchLoadFailure(failure))()),
    };
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
    const controls = (
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
        {menu(workbench, title, running, source?.title, failedActions(workbench, title))}
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
        description={loadNotice(workbench)}
        meta={workbench.version ? `v${workbench.version}` : undefined}
        trailing={controls}
      />
    );
  };

  const detailActions = (workbench: WorkbenchInfo, title: string) => {
    const source = sourceOf(workbench.id);
    const running = options.allEnabled !== false && workbench.enabled !== false;
    return (
      <>
        {source && (
          <GlyphAction
            glyph={ICONS.puzzle}
            label={S.agentPlugins.partSource(source.title)}
            onClick={() => onShowPlugin(source.name)}
          />
        )}
        {menu(workbench, title, running, source?.title, failedActions(workbench, title))}
      </>
    );
  };

  return { row, detailActions, modals };
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
