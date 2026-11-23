import { useState } from "react";
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
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { downloadArchive } from "../../lib/archive-download";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";

interface WorkbenchScope {
  projectId: string | null;
  agentId: string;
  machineId: string | null;
}
/** The row of the newest version holding the workbench's current files; -1 when none does. */
function currentVersionAt(history: { workbench: WorkbenchInfo; versions: WorkbenchVersion[] }) {
  return history.versions.findIndex((version) => version.revision === history.workbench.revision);
}

/** The same source, version and removal operations for a settings row and its running page. */
export function useWorkbenchActions(
  { projectId, agentId, machineId }: WorkbenchScope,
  onChanged?: () => void | Promise<void>,
) {
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{
    workbench: WorkbenchInfo;
    versions: WorkbenchVersion[];
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    workbench: WorkbenchInfo;
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

  function menu(workbench: WorkbenchInfo, title: string, running: boolean, sourceTitle?: string) {
    if (projectId === null) return null;
    return (
      <WorkbenchRowMenu
        title={title}
        disabled={busy}
        onReload={
          running
            ? () =>
                void act(
                  () => api.reloadWorkbench(projectId, agentId, workbench.id, machineId),
                  true,
                )
            : undefined
        }
        onHistory={() =>
          void act(async () =>
            setHistory({
              workbench,
              versions: (await api.getWorkbenchHistory(projectId, agentId, workbench.id, machineId))
                .versions,
            }),
          )
        }
        onExport={() => void exportWorkbench(workbench)}
        onRemove={() => setConfirm({ workbench, sourceTitle })}
      />
    );
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

  return { menu, modals };
}

/** Running applications keep their controls in the host, outside the workbench document. */
export function RunningWorkbenchActions({
  projectId,
  agentId,
  machineId,
  workbench,
  title,
  running,
}: WorkbenchScope & { workbench: WorkbenchInfo; title: string; running: boolean }) {
  const { menu, modals } = useWorkbenchActions({ projectId, agentId, machineId });
  return (
    <>
      <div className="shrink-0">{menu(workbench, title, running)}</div>
      {modals}
    </>
  );
}

function WorkbenchRowMenu({
  title,
  disabled,
  onReload,
  onHistory,
  onExport,
  onRemove,
}: {
  /** The row's title, for the button's and the menu's accessible name. */
  title: string;
  disabled: boolean;
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
