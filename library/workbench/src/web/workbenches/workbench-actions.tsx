import { useMemo, useRef, useState } from "react";
import type { WorkbenchInfo, WorkbenchVersion } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  Dropdown,
  GlyphIcon,
  IconButton,
  ICONS,
  ICON_SIZE,
  Menu,
  MenuItem,
  MenuSeparator,
  Modal,
  type PaletteAction,
  type RowActionItem,
} from "@prismshadow/penguin-ui";
import {
  api,
  downloadArchive,
  formatDateTime,
  usePaletteActions,
  S,
  toastApiError,
} from "@prismshadow/penguin-web/internal";

interface WorkbenchScope {
  projectId: string | null;
  agentId: string;
  machineId: string | null;
}
/** What an action needs of its workbench: a settings row has the whole record, a running app's row only the id. */
type WorkbenchRef = Pick<WorkbenchInfo, "id"> & {
  revision?: WorkbenchInfo["revision"] | undefined;
};
interface History {
  workbench: WorkbenchRef;
  versions: WorkbenchVersion[];
}
/** The row of the newest version holding the workbench's current files; -1 when none does. */
function currentVersionAt(history: History) {
  return history.versions.findIndex((version) => version.revision === history.workbench.revision);
}

/**
 * The same source, version and removal operations wherever a workbench is managed: `menu` is the
 * settings row's More button, `actions` the same operations as rows for a menu that already
 * exists (a running app's row in the sidebar), and `modals` the dialogs both open.
 */
export function useWorkbenchActions(
  { projectId, agentId, machineId }: WorkbenchScope,
  onChanged?: () => void | Promise<void>,
) {
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [confirm, setConfirm] = useState<{
    workbench: WorkbenchRef;
    revision?: string;
    sourceTitle?: string | undefined;
  } | null>(null);
  const act = async (action: () => Promise<unknown>, changed = false) => {
    setBusy(true);
    try {
      await action();
      if (changed) await onChanged?.();
    } catch (err) {
      toastApiError(err);
    } finally {
      setBusy(false);
    }
  };
  /** The shared archive download (archive-download.ts); a failure surfaces as a toast. */
  const exportWorkbench = async (workbench: WorkbenchRef) => {
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

  const reload = (workbench: WorkbenchRef) => {
    if (!projectId) return;
    void act(() => api.reloadWorkbench(projectId, agentId, workbench.id, machineId), true);
  };
  /** A caller that knows only the id has the current revision read with the versions. */
  const showHistory = (workbench: WorkbenchRef) => {
    if (!projectId) return;
    void act(async () => {
      const [{ versions }, revision] = await Promise.all([
        api.getWorkbenchHistory(projectId, agentId, workbench.id, machineId),
        workbench.revision !== undefined
          ? workbench.revision
          : api
              .getWorkbench(projectId, agentId, workbench.id, machineId)
              .then((res) => res.workbenches.find((w) => w.id === workbench.id)?.revision),
      ]);
      setHistory({ workbench: { id: workbench.id, revision }, versions });
    });
  };

  function menu(
    workbench: WorkbenchInfo,
    title: string,
    running: boolean,
    sourceTitle?: string,
    failed?: LoadFailedActions,
  ) {
    if (projectId === null) return null;
    return (
      <WorkbenchRowMenu
        title={title}
        disabled={busy}
        failed={failed}
        onReload={running ? () => reload(workbench) : undefined}
        onHistory={() => showHistory(workbench)}
        onExport={() => void exportWorkbench(workbench)}
        onRemove={() => setConfirm({ workbench, sourceTitle })}
      />
    );
  }

  /** Reload is absent while the workbench does not run: there is nothing to reload. */
  function actions(workbench: WorkbenchRef, running: boolean): RowActionItem[] {
    if (projectId === null) return [];
    return [
      ...(running
        ? [
            {
              id: "reload",
              label: S.workbenches.reload,
              glyph: ICONS.refresh,
              onSelect: () => reload(workbench),
            },
          ]
        : []),
      {
        id: "history",
        label: S.workbenches.historyAction,
        glyph: ICONS.history,
        onSelect: () => showHistory(workbench),
      },
      {
        id: "export",
        label: S.workbenches.exportWorkbench,
        glyph: ICONS.download,
        onSelect: () => void exportWorkbench(workbench),
      },
      {
        id: "remove",
        label: S.workbenches.removeWorkbench,
        glyph: ICONS.trash,
        danger: true,
        onSelect: () => setConfirm({ workbench }),
      },
    ];
  }

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
          }, true)
        }
      >
        {confirm?.revision ? (
          S.workbenches.restoreConfirm(confirm.revision)
        ) : (
          <div className="space-y-2">
            <p>{S.workbenches.removeConfirm}</p>
            <p className="break-words font-mono">
              {agentId} / {confirm?.workbench.id}
            </p>
            {confirm?.sourceTitle !== undefined && (
              <p>{S.agentPlugins.partFromPluginNote(confirm.sourceTitle)}</p>
            )}
          </div>
        )}
      </ConfirmModal>
    </>
  );

  return { menu, actions, reload, busy, modals };
}

/**
 * A full page has no sidebar row to carry the app's menu, so the command palette offers reload,
 * version history and the download while the page is shown. Returns the dialogs they open.
 */
export function useWorkbenchPaletteActions(
  scope: WorkbenchScope,
  workbench: WorkbenchInfo | null,
  title: string,
  running: boolean,
) {
  const { actions, modals } = useWorkbenchActions(scope);
  // Removal stays with the app's row and the Agent's settings: the palette lists no destructive command.
  const rows = (workbench === null ? [] : actions(workbench, running)).filter(
    (action) => action.danger !== true,
  );
  /** The handlers close over this render's state, so the palette runs the newest ones. */
  const latest = useRef(rows);
  latest.current = rows;
  const listed = rows.map((row) => `${row.id}\n${row.label}`).join("\n");
  const palette = useMemo<PaletteAction[]>(
    () =>
      latest.current.map(({ id, label }) => ({
        id: `workbench-${id}`,
        label: S.workbenches.paletteAction(title, label),
        keywords: ["app", "workbench", id],
        run: () => latest.current.find((row) => row.id === id)?.onSelect(),
      })),
    [listed, title],
  );
  usePaletteActions(palette);
  return modals;
}

/**
 * What a row offers while the workbench's files do not load, beside Reload: "Fix with AI" hands
 * the error to the default Agent, and the report entry opens the error's report — the row's line
 * is too short to carry 「[报告问题]」 after the error, so the menu does.
 */
export interface LoadFailedActions {
  onRepair: () => void;
  onReport: () => void;
}

function WorkbenchRowMenu({
  title,
  disabled,
  failed,
  onReload,
  onHistory,
  onExport,
  onRemove,
}: {
  /** The row's title, for the button's and the menu's accessible name. */
  title: string;
  disabled: boolean;
  /** Present while the workbench's files do not load. */
  failed?: LoadFailedActions | undefined;
  /** Absent while the workbench does not run: there is nothing to reload. */
  onReload?: (() => void) | undefined;
  onHistory: () => void;
  onExport: () => void;
  /** Asks first: the tab's remove confirmation. */
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label = `${S.workbenches.more} ${title}`;
  /** A row closes the menu, handing focus back to its button, then acts. */
  const pick = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="w-56"
      portal={{ direction: "down", align: "right" }}
      button={
        <IconButton
          size="sm"
          label={label}
          // No tooltip while the menu is open: it would sit on top of the panel.
          title={open ? "" : S.workbenches.more}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.iconButton} filled />
        </IconButton>
      }
    >
      <Menu label={label} density="sm" className="py-1">
        {onReload !== undefined && (
          <MenuItem glyph={ICONS.refresh} label={S.workbenches.reload} onSelect={pick(onReload)} />
        )}
        {failed !== undefined && (
          <>
            <MenuItem
              glyph={ICONS.sparkles}
              label={S.plugins.repair}
              onSelect={pick(failed.onRepair)}
            />
            <MenuItem
              glyph={ICONS.alertCircle}
              label={S.report.action}
              onSelect={pick(failed.onReport)}
            />
          </>
        )}
        <MenuItem
          glyph={ICONS.history}
          label={S.workbenches.historyAction}
          onSelect={pick(onHistory)}
        />
        <MenuItem
          glyph={ICONS.download}
          label={S.workbenches.exportWorkbench}
          onSelect={pick(onExport)}
        />
        <MenuSeparator />
        <MenuItem
          glyph={ICONS.trash}
          label={S.workbenches.remove}
          danger
          onSelect={pick(onRemove)}
        />
      </Menu>
    </Dropdown>
  );
}
