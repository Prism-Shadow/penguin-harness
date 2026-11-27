import { useState } from "react";
import { ConfirmModal, ICONS } from "@prismshadow/penguin-ui";
import type { PluginIndexEntry } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toastApiError } from "../../lib/toast-api-error";
import { runServerChange } from "./server-installs";

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

/**
 * Updates the downloaded package on this server; Agent copies have their own overwrite
 * confirmation. The confirmation says what changes; once confirmed, the update is a server change
 * like an install (server-installs.ts): it runs on the plugin's button, wherever the plugin is
 * shown — its card, its page, an Agent's Plugins tab — and closing anything never stops it.
 */
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
  const [busy, setBusy] = useState(false);
  const update = async () => {
    setBusy(true);
    try {
      // An unscoped install would change the Project's deployment on its other machines.
      const { machineId } = await api.getInstalledPlugins(projectId, null);
      void runServerChange(
        {
          projectId,
          machineId,
          specifier: release.specifier,
          install: true,
          version: release.to,
          title,
          update: true,
        },
        {
          selfId: machineId,
          reloadAgents: async () => {
            onUpdated?.();
          },
        },
      );
      onClose();
    } catch (error) {
      toastApiError(error, {
        what: "a plugin package could not be updated",
        text: S.plugins.packageUpdateFailed(title, apiErrorText(error)),
      });
      setBusy(false);
    }
  };
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
        if (!busy) onClose();
      }}
    >
      <p>{S.plugins.packageUpdateBody(title, release.from, release.to)}</p>
      {!release.libraryOnly && <p>{S.plugins.applyConfirmWarning(true)}</p>}
    </ConfirmModal>
  );
}
