/**
 * The question the Sandbox card asks when its switch is turned on and the machine has no
 * sandbox backend for its OS: uses the unified PluginBatchInstallModal so the user sees how many
 * backend plugins are needed, why they are needed, a single unified SSE progress bar during
 * download, and both manual + Agent-assisted source configuration if any download fails.
 */
import type { InstallStage } from "../../api/endpoints";
import { S } from "../../lib/strings";
import {
  PluginBatchInstallModal,
  type BatchPluginItem,
} from "../plugins/plugin-batch-install";
import type { FailedPluginDownload } from "../plugins/plugin-source-assist";

export function SandboxBackendPrompt({
  pkgs,
  machineName,
  runInstall,
  onOpenSources,
  onConfigureWithAi,
  onComplete,
  onClose,
}: {
  /** The packages to offer, installed together; null keeps the dialog closed. */
  pkgs: readonly string[] | null;
  /** The machine the card is editing, as the picker names it. */
  machineName: string;
  runInstall: (
    pkg: string,
    callbacks: {
      onProgress: (received: number, total: number | null) => void;
      onStage: (stage: InstallStage) => void;
    },
  ) => Promise<{ loadError?: string | undefined }>;
  onOpenSources?: (() => void) | undefined;
  onConfigureWithAi?: ((failed: readonly FailedPluginDownload[]) => void) | undefined;
  onComplete?: (result: { installed: string[]; failed: FailedPluginDownload[] }) => void;
  onClose: (dontAskAgain: boolean) => void;
}) {
  if (pkgs === null) return null;
  const P = S.settings.sandboxBackendPrompt;
  const B = S.plugins.installModel.batch;
  const items: BatchPluginItem[] = pkgs.map((pkg) => ({
    specifier: pkg,
    title: pkg,
    reason: B.sandboxItemReason,
  }));
  return (
    <PluginBatchInstallModal
      open
      title={P.title}
      summaryReason={B.sandboxSummaryReason(machineName, items.length)}
      machineLabel={machineName}
      impactNote={P.cost}
      dontAskLabel={P.dontAsk}
      items={items}
      runInstall={(item, callbacks) => runInstall(item.specifier, callbacks)}
      onOpenSources={onOpenSources}
      onConfigureWithAi={onConfigureWithAi}
      onComplete={onComplete}
      onClose={(opts) => onClose(opts?.dontAskAgain === true)}
    />
  );
}
