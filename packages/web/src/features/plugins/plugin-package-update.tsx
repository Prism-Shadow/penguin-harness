import { useRef, useState } from "react";
import { ConfirmModal, ICONS, toastSuccess } from "@prismshadow/penguin-ui";
import type { PluginIndexEntry } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { notifyPluginsChanged } from "../../lib/project-change-events";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toastApiError } from "../../lib/toast-api-error";
import { InstallProgress } from "./install-bar";
import { installAmount, installPlan, installStepWords } from "./install-progress";
import {
  INDEX_KEY,
  LIBRARY_KEY,
  installedPlugins,
  installedPluginsKey,
  pluginIndex,
  pluginLibrary,
} from "./plugin-reads";

/** The registry selected this release and checked that it can update this installed package. */
export function packageUpdate(entry: PluginIndexEntry | undefined) {
  const installed = entry?.localInstall;
  if (!entry || !installed?.updateAvailable) return null;
  return {
    specifier: entry.name,
    from: installed.version,
    to: entry.version,
    libraryOnly: installed.libraryOnly,
  };
}

export type PackageUpdate = NonNullable<ReturnType<typeof packageUpdate>>;

/** Updates the downloaded package on this server; Agent copies have their own overwrite confirmation. */
export function PackageUpdateDialog({
  projectId,
  title,
  release,
  onClose,
  onUpdated,
}: {
  projectId: string;
  title: string;
  release: PackageUpdate;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ received: number; total: number | null } | null>(null);
  const [stage, setStage] = useState<api.InstallStage | null>(null);
  const update = async () => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setProgress(null);
    setStage(null);
    try {
      // An unscoped install would change the Project's deployment on its other machines.
      const { machineId } = await api.getInstalledPlugins(projectId, null);
      const result = await api.installPluginStream(
        projectId,
        `${release.specifier}@${release.to}`,
        machineId,
        (received, total) => setProgress({ received, total }),
        (next) => {
          setProgress(null);
          setStage(next);
        },
      );
      installedPlugins.accept(installedPluginsKey(projectId, null), result);
      pluginLibrary.invalidate(LIBRARY_KEY);
      pluginIndex.invalidate(INDEX_KEY);
      notifyPluginsChanged(projectId);
      const row = result.plugins.find((plugin) => plugin.specifier === release.specifier);
      const reason = row?.error ?? row?.unsatisfied?.reason;
      if (reason) {
        toastApiError(new Error(reason), {
          what: "an updated plugin could not load",
          text: S.plugins.deploymentFailedToast(title, reason),
        });
        onUpdated?.();
        onClose();
        return;
      }
      if (result.loading) toastSuccess(S.plugins.installModel.loadingToast(title));
      else toastSuccess(S.plugins.packageUpdated(title, release.to));
      onUpdated?.();
      onClose();
    } catch (error) {
      toastApiError(error, {
        what: "a plugin package could not be updated",
        text: S.plugins.packageUpdateFailed(title, apiErrorText(error)),
      });
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  // An update is the same server install: the same stages, with no Agents to choose after it.
  const plan = installPlan({
    server: "install",
    modules: release.libraryOnly ? false : null,
    agents: false,
  });
  return (
    <ConfirmModal
      open
      title={S.plugins.updatePackageTo(release.to)}
      tone="primary"
      glyph={ICONS.rotateCw}
      confirmLabel={S.skills.updateAction}
      cancelLabel={S.common.cancel}
      busy={busy}
      onConfirm={() => void update()}
      onClose={() => {
        if (!writing.current) onClose();
      }}
    >
      <p>{S.plugins.packageUpdateBody(title, release.from, release.to)}</p>
      {!release.libraryOnly && <p>{S.plugins.applyConfirmWarning(true)}</p>}
      {busy && (
        <div className="space-y-2" role="status">
          <InstallProgress
            plan={plan}
            phase="running"
            stage={stage}
            progress={progress}
            label={S.plugins.installModel.progressLabel(title)}
            valueText={installStepWords(progress, stage)}
          />
          <p className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words">{installStepWords(progress, stage)}</span>
            {installAmount(progress) !== null && (
              <span className="shrink-0 tabular-nums text-fg-muted">{installAmount(progress)}</span>
            )}
          </p>
        </div>
      )}
    </ConfirmModal>
  );
}
