import { useState } from "react";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import { Button, Modal, NoticeStrip } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { appKeyOf, type LocatedShortcut } from "./arrangement";
import { useAppCenter } from "./use-app-center";

export function HiddenWorkbenchesDialog({
  projectId,
  agentIds,
  titleOf,
  onRestored,
  onClose,
}: {
  projectId: string;
  agentIds: string;
  titleOf: (shortcut: AppCenterShortcut) => string;
  onRestored: (machineId?: string) => void;
  onClose: () => void;
}) {
  const { shortcuts, error, reload, refreshMachine, unavailableMachines, retryFailures } =
    useAppCenter(projectId, agentIds, true);
  const [saving, setSaving] = useState<string | null>(null);
  async function restore(app: LocatedShortcut) {
    setSaving(appKeyOf(app));
    try {
      await api.setWorkbenchAppCenter(
        projectId,
        app.agentId,
        app.workbenchId,
        true,
        app.machineId ?? null,
      );
      refreshMachine(app.machineId);
      onRestored(app.machineId);
    } catch (error) {
      toastApiError(error);
    } finally {
      setSaving(null);
    }
  }
  return (
    <Modal open title={S.appCenter.hiddenWorkbenches} onClose={onClose}>
      {error && (
        <NoticeStrip tone="danger">
          {error}
          <Button size="sm" onClick={reload}>
            {S.workbenches.retryHistory}
          </Button>
        </NoticeStrip>
      )}
      {unavailableMachines.length > 0 && (
        <NoticeStrip tone="attention">
          {S.appCenter.machinesOffline(unavailableMachines.join(", "))}
          {retryFailures && (
            <Button size="sm" onClick={retryFailures}>
              {S.workbenches.retryHistory}
            </Button>
          )}
        </NoticeStrip>
      )}
      {shortcuts === null ? (
        !error && <p role="status">{S.appCenter.loading}</p>
      ) : shortcuts.length === 0 ? (
        <p>{S.appCenter.noHiddenWorkbenches}</p>
      ) : (
        <ul className="divide-y divide-line-muted">
          {shortcuts.map((app) => (
            <li key={appKeyOf(app)} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="break-words">{titleOf(app)}</p>
                <p className="break-words text-xs text-fg-muted">
                  {[app.agentName, app.machineLabel].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button
                size="sm"
                disabled={app.unavailable || saving !== null}
                onClick={() => void restore(app)}
              >
                {S.appCenter.restoreWorkbench}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
