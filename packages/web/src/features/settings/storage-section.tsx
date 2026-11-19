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
 *   Settings dialog to that page.
 *
 * The usage and its polling live in storage-state.ts; this renders it.
 */
import { useEffect, useState } from "react";
import {
  Button,
  SettingRow,
  SettingsEmpty,
  SettingsGroup,
  SkeletonList,
  Spinner,
  UsageBar,
} from "@prismshadow/penguin-ui";
import type { StorageUsage } from "@prismshadow/penguin-server/api";
import { useStore } from "zustand/react";
import { formatDateTime, formatRelativeLong } from "../../lib/format";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { FolderBreakdown, ProjectBreakdown } from "./storage-breakdown";
import { StorageCleanupDialog } from "./storage-cleanup-dialog";
import { categorySegments, formatSize } from "./storage-format";
import { StorageSessionsDialog } from "./storage-sessions-dialog";
import { createStorageStore, type StorageStore } from "./storage-state";

/** The dialog the page has open: the cleanup review, or the chats list in one of its two presets. */
type StorageDialog = "temp" | "old" | "all";

export function StorageSection({ onOpenArchived }: { onOpenArchived: () => void }) {
  const { desktopMode, sessionVia } = useAuth();
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
  if (usage === null) {
    return state.loadError !== null ? (
      <SettingsEmpty>{S.storage.loadFailed(state.loadError)}</SettingsEmpty>
    ) : (
      <SkeletonList rows={4} />
    );
  }

  return (
    <div className="space-y-6">
      <UsageOverview
        usage={usage}
        refreshing={state.refreshing}
        onRefresh={() => void store.getState().refresh()}
      />
      <ProjectBreakdown usage={usage} />
      <FolderBreakdown
        usage={usage}
        // The file manager opens on the machine the window is on: the desktop shell's own window.
        canReveal={desktopMode && sessionVia === "desktop"}
        onReveal={(body) => void store.getState().reveal(body)}
      />
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
          <Button size="sm" onClick={onOpenArchived}>
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
  // Nothing measured yet: a zero would read as an empty disk.
  const unknown = usage.measuredAt === null && bytes === 0;
  return (
    <SettingsGroup title={server !== undefined ? S.storage.thisServer : S.storage.myProjects}>
      <div className="space-y-3 pb-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-0 flex-1 text-lg font-semibold tabular-nums">
            {S.storage.used(unknown ? S.storage.notMeasured : formatSize(bytes))}
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
  const { locale } = useLocale();
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
      {S.storage.measuredAt(formatRelativeLong(usage.measuredAt, locale))}
    </span>
  );
}
