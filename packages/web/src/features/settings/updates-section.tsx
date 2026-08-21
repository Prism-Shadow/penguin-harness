/**
 * Updates page of System settings: the running server version, one check-for-updates
 * action, and — once a newer release is known — the entry into UpdateDialog, which carries
 * the release-notes link and the admin-only self-update. Moved here from the sidebar user
 * menu's single update row; the row semantics are unchanged: check until a release is
 * known, then offer it. Never mounted in desktop mode (the section registry drops the
 * page), where updating is the desktop shell's job.
 *
 * Version + update state share useVersionInfo's module cache with the sidebar's reminder
 * dot, so the two surfaces never disagree about what is known.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { Button } from "../../components/ui/button";
import { UpdateDialog } from "../../components/account/update-dialog";
import { forceUpdateCheck, updateCheckOutcome, useVersionInfo } from "../../lib/use-version-info";
import { apiErrorText } from "../../lib/api-error";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { formatMonthDay } from "../../lib/format";
import { useAuth } from "../../state/auth";
import { PrefRow } from "./setting-row";

export function UpdatesSection({ active }: { active: boolean }) {
  const { user } = useAuth();
  const { locale } = useLocale();
  const { version, update } = useVersionInfo(active);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);

  const updateAvailable = update?.updateAvailable === true;
  /** The newer release's version string, or null while none is known. */
  const newVersion = updateAvailable ? (update?.latestVersion ?? null) : null;
  const versionDate = version?.buildDate ?? null;

  /**
   * Manual update check: forces a lookup past the server's TTL cache and pushes the result
   * into the shared version-info store, so the sidebar's reminder dot appears immediately
   * when a newer release is found. Every outcome toasts — the check is fail-soft (failure
   * arrives as the `error` field, not an exception; the catch handles our own server being
   * unreachable).
   */
  const runUpdateCheck = async () => {
    if (updateChecking) return;
    setUpdateChecking(true);
    try {
      const outcome = updateCheckOutcome(await forceUpdateCheck());
      if (outcome.kind === "disabled") toastInfo(S.update.checkDisabled);
      else if (outcome.kind === "failed") toastError(S.update.checkFailed);
      else if (outcome.kind === "found") toastSuccess(S.update.foundNew(outcome.latestVersion));
      else toastSuccess(S.update.upToDate);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setUpdateChecking(false);
    }
  };

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
      <PrefRow
        label={newVersion !== null ? S.update.newVersion(newVersion) : S.update.checkNow}
        hint={
          versionDate !== null
            ? S.update.lastUpdated(formatMonthDay(versionDate, locale))
            : undefined
        }
      >
        <span className="flex items-center gap-3">
          {version !== null && (
            <span className="text-xs text-gray-400 dark:text-gray-500">{`v${version.version}`}</span>
          )}
          {newVersion !== null ? (
            <Button variant="primary" onClick={() => setUpdateDialogOpen(true)}>
              {S.update.newVersionBadge}
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={updateChecking}
              onClick={() => void runUpdateCheck()}
            >
              {updateChecking ? S.update.checking : S.update.checkNow}
            </Button>
          )}
        </span>
      </PrefRow>
      <UpdateDialog
        open={updateDialogOpen}
        onClose={() => setUpdateDialogOpen(false)}
        latestVersion={newVersion}
        releaseUrl={update?.releaseUrl ?? null}
        canUpdate={user?.isAdmin === true}
        /* A finished self-update makes the known release stale — re-check silently so the
           row stops offering the version that is now running (see the old menu row). */
        onRunFinished={() => void forceUpdateCheck().catch(() => undefined)}
      />
    </div>
  );
}
