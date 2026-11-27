/**
 * The market's install sheet: one surface from "what will be installed" to "it is ready", the way
 * a phone installs an app. The plugin's icon and name lead; once the install starts, one staged
 * bar (install-bar.tsx) stands under them with a sentence saying what is happening now, and the
 * sheet's body is whatever the person can do at that moment: start it, wait, try again, choose
 * the Agents that use it, or finish.
 *
 * The bar shows only an install this sheet is running or ran. Before it starts there is none,
 * and a plugin that was already on the server opens straight on its Agents with no bar either.
 * The plan (which stages this install has) is taken when the sheet opens and kept, so the stages
 * the server finished stay on the bar while the person chooses Agents.
 *
 * Closing the sheet never stops a server install: the request runs on, the card keeps the same
 * bar at its own size, and reopening the sheet shows where it stands. A server install cannot be
 * cancelled, which the running step says.
 */
import { useEffect, useState, type ReactNode } from "react";

import {
  Button,
  CloseButton,
  FailureText,
  GlyphIcon,
  ICON_SIZE,
  ICONS,
  InstallRing,
  Modal,
} from "@prismshadow/penguin-ui";
import type { Failure } from "@prismshadow/penguin-ui";
import type { InstallStage } from "@prismshadow/penguin-web/internal";
import { S, toneInk } from "@prismshadow/penguin-web/internal";
import { InstallProgress } from "./install-bar";
import {
  installAmount,
  installStepWords,
  type DownloadProgress,
  type InstallPhase,
  type InstallStep,
} from "./install-progress";

/** What the server step is for this plugin and this reader. */
export type ServerStep =
  /** On the server already (or, for a module, running for this Project). */
  | "done"
  /** Not on the server: an admin installs it. */
  | "install"
  /** A server module the build ships, not run by this Project yet: an admin enables it. */
  | "enable"
  /** Not on the server, with Agent content or unread contents: a member asks an admin. */
  | "ask"
  /** Not on the server, server modules alone: a member cannot act. */
  | "held"
  /** Listed, but the selected machine has not reported a running module. */
  | "unavailable";

/** A server install that failed: why, and where the server's reports stood when it did. */
export interface InstallFailure {
  /** The words and, for a failure rather than a refusal, the report they offer. */
  failure: Failure;
  stage: InstallStage | null;
  progress: DownloadProgress | null;
}

export interface InstallFlowProps {
  /** The plugin's display name. */
  title: string;
  icon: ReactNode;
  /** The icon's edge in px, for the ring it wears while the install runs. */
  iconSize: number;
  /** The plugin's one-line description, shown before the install starts. */
  description?: string | undefined;
  version?: string | undefined;
  /** Two steps for a plugin with Agent content, one for server modules alone. */
  steps: 1 | 2;
  /** The stages this install has, for this plugin and this reader (install-progress.ts). */
  plan: readonly InstallStep[];
  /** A published listing may omit the package contents until its archive is opened. */
  contentsKnown: boolean;
  server: ServerStep;
  /** A shipped hybrid can install its Agent content under the existing module-request policy. */
  agentPackageAvailable?: boolean;
  moduleStatus?: string;
  /** The server step is running here. */
  busy: boolean;
  /** Another plugin's server change is running: one at a time. */
  blocked: boolean;
  /** The install is written for another machine, which takes it from this server. */
  remote?: boolean;
  progress?: DownloadProgress | null;
  stage?: InstallStage | null;
  /** The last server install of this plugin failed. */
  failure?: InstallFailure | null;
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
  /** The Agents the plugin was added to while this sheet was open, by name. */
  added?: readonly string[];
  /** What to do with the plugin once it is ready: open its app, or start its example. */
  next?: { label: string; onClick: () => void } | null;
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
  // The stages as they were when the sheet opened: the server's stay on the bar once finished.
  const [plan] = useState(props.plan);
  /** This sheet runs, or ran, the server's part: the bar is its record. */
  const ranServer = plan.some((stage) => stage !== "agents");
  // Back on the Agents after a first one was added, to add another.
  const [addingMore, setAddingMore] = useState(false);
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

  const added = props.added ?? [];
  const failed = props.failure != null && !props.busy;
  /** The install this sheet ran is complete: the server's part, and an Agent where it has one. */
  const finished =
    ranServer &&
    serverDone &&
    !props.busy &&
    (props.steps === 1 || (added.length > 0 && !addingMore));
  const phase: InstallPhase = props.busy
    ? "running"
    : failed
      ? "failed"
      : finished
        ? "done"
        : serverDone && props.steps === 2
          ? "agents"
          : "before";
  const showBar = ranServer && phase !== "before";
  const sentence = installStepWords(props.progress, props.stage, false, props.remote === true);
  const amount = installAmount(props.progress);
  const mark = failed && ranServer ? "failed" : finished ? "done" : props.busy ? "running" : null;

  const close = (
    <Button size="sm" variant="primary" onClick={props.onClose}>
      {words.finish}
    </Button>
  );

  return (
    <Modal open headerless title={words.flowTitle(props.title)} onClose={props.onClose}>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <InstallIcon icon={props.icon} size={props.iconSize} mark={mark} />
          <div className="min-w-0 flex-1 self-center">
            <h2 className="break-words text-base font-semibold text-fg">{props.title}</h2>
            <p className="flex flex-wrap gap-x-2 break-words text-xs text-fg-muted">
              {props.version !== undefined && <span className="font-mono">v{props.version}</span>}
              <span>
                {props.machineLabel ? S.chat.machineTag(props.machineLabel) : words.thisServer}
              </span>
            </p>
          </div>
          <CloseButton onClose={props.onClose} />
        </div>

        {showBar && (
          <div className="space-y-2" role="status">
            <InstallProgress
              plan={plan}
              phase={phase}
              stage={props.failure?.stage ?? props.stage}
              progress={props.failure?.progress ?? props.progress}
              label={words.progressLabel(props.title)}
              valueText={props.busy ? sentence : undefined}
            />
            {props.busy && (
              <p className="flex items-baseline justify-between gap-3 text-sm text-fg">
                <span className="min-w-0 break-words">{sentence}</span>
                {amount !== null && (
                  <span className="shrink-0 tabular-nums text-fg-muted">{amount}</span>
                )}
              </p>
            )}
          </div>
        )}

        {finished ? (
          <section className="space-y-3 text-sm">
            <div className="space-y-1">
              <h3 className="font-semibold text-fg">{words.doneTitle(props.title)}</h3>
              <p className="break-words text-fg-muted">
                {props.steps === 2
                  ? words.doneAgents(added.join(S.todo.listSeparator))
                  : props.server === "done" && plan.includes("check")
                    ? words.doneService
                    : words.projectReady}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {props.steps === 2 && (
                <Button
                  size="sm"
                  variant="link"
                  className="mr-auto"
                  onClick={() => setAddingMore(true)}
                >
                  {words.addAnother}
                </Button>
              )}
              {props.next != null ? (
                <>
                  <Button size="sm" variant="ghost" onClick={props.onClose}>
                    {words.finish}
                  </Button>
                  <Button size="sm" variant="primary" onClick={props.next.onClick}>
                    {props.next.label}
                  </Button>
                </>
              ) : (
                close
              )}
            </div>
          </section>
        ) : step === 1 ? (
          <section className="space-y-3 text-sm">
            {props.busy ? (
              <p className="text-xs text-fg-muted">{words.noCancel}</p>
            ) : failed ? (
              <div className="space-y-1.5" data-testid="install-failure">
                <h3 className="break-words font-semibold text-fg">
                  {words.failedTitle(props.title)}
                </h3>
                <p className="break-words text-fg-muted">
                  <FailureText failure={props.failure!.failure} />
                </p>
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-fg-muted">
                  <span>{words.failedHelp}</span>
                  {props.onOpenSources !== undefined && (
                    <Button variant="link" size="sm" onClick={props.onOpenSources}>
                      {words.sourcesSettings}
                    </Button>
                  )}
                  {props.onImportFile !== undefined && (
                    <Button variant="link" size="sm" onClick={props.onImportFile}>
                      {words.importFromFile}
                    </Button>
                  )}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {(serverDone || props.server === "ask") && (
                  <h3 className="font-semibold text-fg">
                    {serverDone ? words.ready : asked ? words.askedTitle : words.askTitle}
                  </h3>
                )}
                {(props.server === "install" || props.server === "enable") && props.description && (
                  <p className="break-words text-fg">{props.description}</p>
                )}
                <p className="break-words text-fg-muted">
                  {props.server === "install" &&
                    (props.steps === 2
                      ? words.prepareForAgents
                      : props.contentsKnown
                        ? words.prepareService
                        : words.preparePackage)}
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
            )}

            {(props.server === "install" || props.server === "enable") &&
              !props.busy &&
              !failed && (
                <details className="text-xs text-fg-muted">
                  <summary tabIndex={0} className="cursor-pointer">
                    {words.installDetails}
                  </summary>
                  <p className="mt-1">{S.plugins.applyConfirmWarning(true)}</p>
                </details>
              )}

            <div className="flex flex-wrap justify-end gap-2">
              {props.busy && (
                <Button size="sm" variant="secondary" onClick={props.onClose}>
                  {words.background}
                </Button>
              )}
              {failed && props.onDismissFailure !== undefined && (
                <Button size="sm" variant="ghost" onClick={props.onDismissFailure}>
                  {words.dismiss}
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
              {canInstallAgents && !props.busy && (
                <Button
                  size="sm"
                  variant={serverDone ? "primary" : "ghost"}
                  onClick={() => setStep(2)}
                >
                  {words.toAgents}
                </Button>
              )}
              {(props.server === "install" || props.server === "enable") && !props.busy && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={props.blocked}
                  onClick={props.onServer}
                >
                  {failed
                    ? S.common.retry
                    : props.server === "enable"
                      ? words.enableNow
                      : S.skills.install}
                </Button>
              )}
              {props.server === "ask" && !asked && (
                <Button size="sm" variant="primary" loading={asking} onClick={() => void ask()}>
                  {words.askAdmin}
                </Button>
              )}
              {((serverDone && props.steps === 1) ||
                asked ||
                (!canInstallAgents &&
                  (props.server === "held" || props.server === "unavailable"))) &&
                close}
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <div className="space-y-1 text-sm">
              <h3 className="font-semibold text-fg">{words.chooseAgent}</h3>
              <p className="text-fg-muted">
                {ranServer && added.length === 0 ? words.chooseAfterInstall : words.chooseAgentHelp}
              </p>
            </div>
            {!serverDone && props.moduleStatus && (
              <p className="text-xs text-fg-muted">{props.moduleStatus}</p>
            )}
            {props.agents ?? <p className="py-1.5 text-xs text-fg-muted">{S.common.loading}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="link" onClick={() => setStep(1)}>
                {words.backToServer}
              </Button>
              {ranServer &&
                (added.length === 0 ? (
                  <Button size="sm" variant="ghost" onClick={props.onClose}>
                    {words.chooseLater}
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => setAddingMore(false)}>
                    {words.finish}
                  </Button>
                ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}

/** The ring stands this far outside the icon, as the App Center's does around a tile. */
const RING_GAP_PX = 6;

/**
 * The plugin's icon as the App Center draws an app being installed: dimmed under a turning ring
 * while the install runs, the attention mark on its corner when it failed, a check when it is
 * ready. The marks overhang the icon, so the row's layout is the same in every state.
 */
function InstallIcon({
  icon,
  size,
  mark,
}: {
  icon: ReactNode;
  size: number;
  mark: "running" | "failed" | "done" | null;
}) {
  return (
    <span className="relative flex shrink-0" style={{ width: size, height: size }}>
      <span className={`flex ${mark === "running" ? "opacity-50" : ""}`}>{icon}</span>
      {mark === "running" && (
        <InstallRing
          size={size + 2 * RING_GAP_PX}
          className="pointer-events-none absolute -left-1.5 -top-1.5 text-accent"
        />
      )}
      {(mark === "failed" || mark === "done") && (
        <span
          aria-hidden
          className={`absolute -left-1.5 -top-1.5 rounded-full bg-canvas ${
            mark === "failed" ? toneInk.attention : toneInk.success
          }`}
        >
          <GlyphIcon
            d={mark === "failed" ? ICONS.triangleAlert : ICONS.checkCircle}
            size={ICON_SIZE.rowLead}
          />
        </span>
      )}
    </span>
  );
}

/**
 * Why a server install failed, as a note under the plugin's row card, with what to do next
 * instead of a dead end: another registry or mirror in Plugin Sources, or a zip import (an
 * admin's). Attention ink with its mark, never red text; it stays until dismissed or the next
 * attempt.
 */
export function InstallFailureNote({
  failure,
  onOpenSources,
  onImportFile,
  onDismiss,
}: {
  failure: Failure;
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
        <span className="min-w-0 break-words">
          <FailureText failure={{ ...failure, text: words.failedNote(failure.text) }} />
        </span>
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
