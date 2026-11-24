/** Preparing the plugin and choosing which Agents use it share a single market sheet. */
import { useEffect, useState, type ReactNode } from "react";

import {
  Button,
  CloseButton,
  GlyphIcon,
  ICON_SIZE,
  ICONS,
  Modal,
  ProgressBar,
} from "@prismshadow/penguin-ui";
import type { InstallStage } from "../../api/endpoints";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";

/** What the server step is for this plugin and this reader. */
export type ServerStep =
  /** On the server already (or, for a module, running for this Project). */
  | "done"
  /** Not on the server: an admin installs it. */
  | "install"
  /** A server module the build ships, not run by this Project yet: an admin enables it. */
  | "enable"
  /** Not on the server, with Agent content: a member asks an admin. */
  | "ask"
  /** Not on the server, server modules alone: a member cannot act. */
  | "held"
  /** Listed, but the selected machine has not reported a running module. */
  | "unavailable";

/**
 * The words a running server install shows: its download's percent, else the step it reached.
 * `short` is for a card's one-line control, which a long step's words would overflow; the flow
 * itself says them whole.
 */
export function installStepWords(
  progress: { received: number; total: number | null } | null | undefined,
  stage: InstallStage | null | undefined,
  short = false,
): string {
  const words = short ? S.plugins.installModel.stepShort : S.plugins.installModel;
  if (progress != null) {
    const total = progress.total;
    return S.plugins.downloading(
      total !== null && total > 0 ? Math.floor((progress.received / total) * 100) : null,
    );
  }
  if (stage?.stage === "checking") return words.checking;
  if (stage?.stage === "loading") return words.loading;
  if (stage?.stage === "installing" && stage.source === "offline") return words.fromOffline;
  return S.plugins.installModel.installing;
}

export interface InstallFlowProps {
  /** The plugin's display name. */
  title: string;
  icon: ReactNode;
  /** Two steps for a plugin with Agent content, one for server modules alone. */
  steps: 1 | 2;
  server: ServerStep;
  /** A shipped hybrid can install its Agent content under the existing module-request policy. */
  agentPackageAvailable?: boolean;
  moduleStatus?: string;
  /** The server step is running here. */
  busy: boolean;
  /** Another plugin's server change is running: one at a time. */
  blocked: boolean;
  progress?: { received: number; total: number | null } | null;
  stage?: InstallStage | null;
  /** The last server install of this plugin failed: why. */
  failure?: string | null;
  onDismissFailure?: () => void;
  onOpenSources?: () => void;
  onImportFile?: () => void;
  /** Installs (or, for `enable`, enables) it on the server. */
  onServer: () => void;
  /** Opens the existing administrator confirmation for this server. */
  onRemoveServer?: () => void;
  machineLabel?: string;
  /** Asks an admin to install it on the server (a member). */
  onAsk: () => Promise<void>;
  /** Step 2's body: the Agents. Null while the server's copy is not read yet. */
  agents: ReactNode | null;
  onClose: () => void;
}

export function InstallFlow(props: InstallFlowProps) {
  const words = S.plugins.installModel;
  const serverDone = props.server === "done";
  const canInstallAgents = props.steps === 2 && (serverDone || props.agentPackageAvailable);
  const [selected, setStep] = useState<1 | 2>(
    canInstallAgents && (serverDone || props.server === "held") ? 2 : 1,
  );
  const step = canInstallAgents ? selected : 1;
  const [asked, setAsked] = useState(false);
  const [asking, setAsking] = useState(false);
  // The server step completing moves the flow on by itself.
  useEffect(() => {
    if (serverDone && props.steps === 2) setStep(2);
  }, [serverDone, props.steps]);

  const ask = async () => {
    setAsking(true);
    try {
      await props.onAsk();
      setAsked(true);
    } catch {
      // The caller has said why (a toast); the step stays as it was, to try again.
    } finally {
      setAsking(false);
    }
  };
  const running = installStepWords(props.progress, props.stage);
  const percent =
    props.progress != null && props.progress.total !== null && props.progress.total > 0
      ? (props.progress.received / props.progress.total) * 100
      : undefined;
  return (
    <Modal open headerless title={words.flowTitle(props.title)} onClose={props.onClose}>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {props.icon}
          <div className="min-w-0 flex-1 self-center">
            <h2 className="break-words text-base font-semibold text-fg">{props.title}</h2>
            {props.machineLabel && (
              <p className="break-words text-xs text-fg-muted">
                {S.chat.machineTag(props.machineLabel)}
              </p>
            )}
          </div>
          <CloseButton onClose={props.onClose} />
        </div>
        {step === 1 ? (
          <section className="space-y-3 text-sm">
            <div className="space-y-1">
              <h3 className="font-semibold text-fg">
                {serverDone
                  ? words.ready
                  : props.server === "enable"
                    ? words.projectService
                    : words.prepare}
              </h3>
              <p className="text-fg-muted">
                {props.server === "install" &&
                  (props.steps === 2 ? words.prepareForAgents : words.prepareService)}
                {props.server === "enable" && words.projectServiceHelp}
                {props.server === "ask" && (asked ? words.asked : words.askBody)}
                {props.server === "held" && words.adminOnly}
                {props.server === "unavailable" && props.moduleStatus}
                {serverDone &&
                  (props.agentPackageAvailable
                    ? words.projectReady
                    : words.serverDone(props.title))}
              </p>
            </div>

            {(props.server === "install" || props.server === "enable") && (
              <details className="text-xs text-fg-muted">
                <summary className="cursor-pointer">{words.installDetails}</summary>
                <p className="mt-1">{S.plugins.applyConfirmWarning(true)}</p>
              </details>
            )}
            {props.busy && (
              <div className="space-y-1.5" role="status">
                <p className="text-xs text-fg-muted">{running}</p>
                <ProgressBar
                  size="xs"
                  {...(percent !== undefined ? { value: percent } : { indeterminate: true })}
                  label={running}
                />
              </div>
            )}
            {props.failure != null && !props.busy && (
              <InstallFailureNote
                reason={props.failure}
                onOpenSources={props.onOpenSources}
                onImportFile={props.onImportFile}
                onDismiss={props.onDismissFailure}
              />
            )}

            <div className="flex flex-wrap justify-end gap-2">
              {(props.server === "install" || props.server === "enable") && (
                <Button
                  size="sm"
                  variant="primary"
                  loading={props.busy}
                  disabled={props.blocked}
                  onClick={props.onServer}
                >
                  {props.server === "enable" ? words.enableModule : words.installServer}
                </Button>
              )}
              {props.server === "ask" && !asked && (
                <Button size="sm" variant="primary" loading={asking} onClick={() => void ask()}>
                  {words.askAdmin}
                </Button>
              )}
              {serverDone && props.onRemoveServer && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.busy || props.blocked}
                  onClick={props.onRemoveServer}
                >
                  {words.uninstallServer}
                </Button>
              )}
              {canInstallAgents && (
                <Button
                  size="sm"
                  variant={serverDone ? "primary" : "ghost"}
                  onClick={() => setStep(2)}
                >
                  {words.toAgents}
                </Button>
              )}
              {((serverDone && props.steps === 1) ||
                asked ||
                (!canInstallAgents && props.server === "held")) && (
                <Button size="sm" variant="primary" onClick={props.onClose}>
                  {words.finish}
                </Button>
              )}
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <div className="space-y-1 text-sm">
              <h3 className="font-semibold text-fg">{words.chooseAgent}</h3>
              <p className="text-fg-muted">{words.chooseAgentHelp}</p>
            </div>
            {!serverDone && props.moduleStatus && (
              <p className="text-xs text-fg-muted">{props.moduleStatus}</p>
            )}
            {props.agents ?? <p className="py-1.5 text-xs text-fg-muted">{S.common.loading}</p>}
            <Button size="sm" variant="link" onClick={() => setStep(1)}>
              {words.backToServer}
            </Button>
          </section>
        )}
      </div>
    </Modal>
  );
}

/**
 * Why a server install failed, on the step that ran it, with what to do next instead of a dead
 * end: another registry or mirror in Plugin Sources, or a zip import (an admin's). Attention ink
 * with its mark, never red text; it stays until dismissed or the next attempt.
 */
export function InstallFailureNote({
  reason,
  onOpenSources,
  onImportFile,
  onDismiss,
}: {
  reason: string;
  onOpenSources?: (() => void) | undefined;
  onImportFile?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
}) {
  const words = S.plugins.installModel;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-testid="install-failure">
      <span className={`inline-flex min-w-0 items-baseline gap-1 ${toneInk.attention}`}>
        <GlyphIcon
          d={ICONS.triangleAlert}
          size={ICON_SIZE.inlineGlyph}
          className="shrink-0 self-center"
        />
        <span className="min-w-0 break-words">{words.failedNote(reason)}</span>
      </span>
      {onOpenSources !== undefined && (
        <Button variant="link" size="sm" onClick={onOpenSources}>
          {words.sourcesSettings}
        </Button>
      )}
      {onImportFile !== undefined && (
        <Button variant="link" size="sm" onClick={onImportFile}>
          {words.importFromFile}
        </Button>
      )}
      {onDismiss !== undefined && (
        <Button variant="link" size="sm" onClick={onDismiss}>
          {words.dismiss}
        </Button>
      )}
    </span>
  );
}
