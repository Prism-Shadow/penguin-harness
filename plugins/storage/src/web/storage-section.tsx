/**
 * Settings › Personal › Storage: what the data root holds, and the cleanup of what can be
 * regenerated. A member sees the Projects they can open; an admin (the answer carries `server`)
 * the whole data root. Ruled sections, top to bottom:
 *
 * - This server (My Projects for a member): the space used in large figures, beside it when it
 *   was measured (the exact time on hover) — or, while a measurement runs, a spinner and
 *   "Measuring…" with the numbers before it left in place — and Refresh; under them the usage bar
 *   by category with its legend of sizes. Why the last measurement failed, when it did, is one
 *   muted line.
 * - By Project and By folder (storage-breakdown.tsx).
 * - Clean up: one row per action, its title, one line of what it does and its button — Clean up
 *   temporary files (the review dialog, storage-cleanup-dialog.tsx), Clean up old chats and
 *   Manage chats (the chats dialog, storage-sessions-dialog.tsx, opened archived, idle for a month
 *   and all chosen, or with no filter and nothing chosen), and Archived chats, which switches the
 *   Settings dialog to that page (`openPage`, which the dialog hands its contributed pages).
 *
 * The usage and its polling live in storage-state.ts; this renders it.
 */
import { useEffect, useState } from "react";
import { Button, SettingRow, SettingsGroup, Spinner, UsageBar } from "@prismshadow/penguin-ui";
import {
  formatDateTime,
  formatRelativeLong,
  toastApiError,
  type SettingsPageProps,
} from "@prismshadow/penguin-web-plugin";
import { useStore } from "zustand/react";
import type { StorageUsage } from "../types";
import { FolderBreakdown, ProjectBreakdown } from "./storage-breakdown";
import { StorageCleanupDialog } from "./storage-cleanup-dialog";
import { categorySegments, formatSize } from "./storage-format";
import { StorageSessionsDialog } from "./storage-sessions-dialog";
import { createStorageStore, type StorageStore } from "./storage-state";
import { S } from "./strings";

/** The dialog the page has open: the cleanup review, or the chats list in one of its two presets. */
type StorageDialog = "temp" | "old" | "all";

export function StorageSection({ openPage }: SettingsPageProps) {
  const [store] = useState<StorageStore>(() =>
    createStorageStore((reason, err) =>
      toastApiError(err, { text: S.storage.actionFailed(reason) }),
    ),
  );
  const state = useStore(store);
  const [dialog, setDialog] = useState<StorageDialog | null>(null);

  useEffect(() => {
    void store.getState().load();
    return () => store.getState().dispose();
  }, [store]);

  const usage = state.usage;
  const load = () => void store.getState().load();
  const refresh = () => void store.getState().refresh();
  if (usage === null) {
    return (
      <FirstMeasurement
        error={state.loadError && S.storage.loadFailed(state.loadError)}
        onRetry={load}
      />
    );
  }

  return (
    <div className="space-y-6">
      {usage.measuredAt === null ? (
        <FirstMeasurement
          error={
            state.loadError
              ? S.storage.loadFailed(state.loadError)
              : usage.measuring || state.refreshing
                ? null
                : usage.error
                  ? S.storage.measureFailed(usage.error)
                  : S.storage.unavailable
          }
          onRetry={usage.measuring ? load : refresh}
        />
      ) : (
        <>
          <UsageOverview usage={usage} refreshing={state.refreshing} onRefresh={refresh} />
          <ProjectBreakdown usage={usage} />
          <FolderBreakdown
            usage={usage}
            canReveal={usage.reveal}
            onReveal={(body) => void store.getState().reveal(body)}
          />
        </>
      )}
      <SettingsGroup title={S.storage.cleanup}>
        <SettingRow title={S.storage.cleanTemp} description={S.storage.cleanTempHint}>
          <Button size="sm" onClick={() => setDialog("temp")}>
            {S.storage.review}
          </Button>
        </SettingRow>
        <SettingRow title={S.storage.cleanOld} description={S.storage.cleanOldHint}>
          <Button size="sm" onClick={() => setDialog("old")}>
            {S.storage.review}
          </Button>
        </SettingRow>
        <SettingRow title={S.storage.manageSessions} description={S.storage.manageSessionsHint}>
          <Button size="sm" onClick={() => setDialog("all")}>
            {S.storage.review}
          </Button>
        </SettingRow>
        <SettingRow title={S.storage.archived} description={S.storage.archivedHint}>
          <Button size="sm" onClick={() => openPage("archived")}>
            {S.storage.open}
          </Button>
        </SettingRow>
      </SettingsGroup>

      {dialog === "temp" && (
        <StorageCleanupDialog
          onClose={() => setDialog(null)}
          // The server measures again what the cleanup touched: read it, and follow the measuring.
          onDone={() => void store.getState().load()}
        />
      )}
      {(dialog === "old" || dialog === "all") && (
        <StorageSessionsDialog
          preset={dialog}
          usage={usage}
          onClose={() => setDialog(null)}
          // Deleting a chat does not move the measurement by itself: ask for a new one.
          onDeleted={() => void store.getState().refresh()}
        />
      )}
    </div>
  );
}

/** Keep unmeasured totals, folders and charts out of both the screen and its accessibility tree. */
function FirstMeasurement({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-md border border-line bg-surface px-4 py-8 text-center">
      {error === null ? (
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <Spinner size="sm" label={S.storage.firstMeasurement} />
          <span aria-hidden>{S.storage.firstMeasurement}</span>
        </div>
      ) : (
        <>
          <p role="alert" className="text-sm text-fg-muted">
            {error}
          </p>
          <Button size="sm" onClick={onRetry}>
            {S.storage.refresh}
          </Button>
        </>
      )}
    </div>
  );
}

/** The first section: the space used, when it was measured, Refresh, and the bar by category. */
function UsageOverview({
  usage,
  refreshing,
  onRefresh,
}: {
  usage: StorageUsage;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const server = usage.server;
  const bytes = server?.bytes ?? usage.bytes;
  const categories = server?.categories ?? usage.categories;
  return (
    <SettingsGroup title={server !== undefined ? S.storage.thisServer : S.storage.myProjects}>
      <div className="space-y-3 pb-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-0 flex-1 text-lg font-semibold tabular-nums">
            {S.storage.used(formatSize(bytes))}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <MeasureStatus usage={usage} />
            <Button size="sm" disabled={refreshing || usage.measuring} onClick={onRefresh}>
              {S.storage.refresh}
            </Button>
          </div>
        </div>
        <UsageBar segments={categorySegments(categories)} legend label={S.storage.usageLabel} />
        {usage.error !== undefined && (
          <p className="text-xs text-fg-muted">{S.storage.measureFailed(usage.error)}</p>
        )}
      </div>
    </SettingsGroup>
  );
}

/** When the numbers were measured, or that a measurement is running. */
function MeasureStatus({ usage }: { usage: StorageUsage }) {
  if (usage.measuring) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
        <Spinner size="xs" label={S.storage.measuring} />
        <span aria-hidden>{S.storage.measuring}</span>
      </span>
    );
  }
  if (usage.measuredAt === null) return null;
  return (
    <span
      className="text-xs text-fg-muted"
      data-tooltip={formatDateTime(usage.measuredAt)}
      data-tooltip-extra
    >
      {S.storage.measuredAt(formatRelativeLong(usage.measuredAt))}
    </span>
  );
}
