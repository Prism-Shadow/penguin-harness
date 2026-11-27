/**
 * A plugin's install steps: the decisions an install needs, one page each, in one dialog — the
 * way a phone's package installer pages through what it must ask before an app is ready. The
 * install itself happens on the plugin's button (its card's and its page's): the steps are where
 * that button goes when there is something to decide, and only then.
 *
 * The pages a plugin has, in order, are only those its install will take:
 *
 * - **On this server** — while the plugin is not on the server, or a server change of it runs or
 *   failed, or it is a plugin of server modules alone, or an admin's install it is (who may
 *   uninstall it from the server there): an admin installs it for the whole server
 *   (or enables a module the build ships), with what that does said before the press; a member
 *   asks an admin. While the install runs the page shows its staged bar and the step in words,
 *   and closing the dialog leaves it running on the button; when it fails the page says why,
 *   with Retry and the next places to look. Once the server has it, the page says so (and an
 *   admin can uninstall it from the server from here).
 * - **Choose agents** — for a plugin with something for Agents: who uses it, one Agent at a time,
 *   nothing added without a press (the owner's ask-first rule).
 * - **Ready** — once it was added to an Agent, or a server install finished: who has it, and the
 *   thing to do next (open its app, or its quick start).
 *
 * The step indicator over the pages shows where the reader is once there are two pages or more;
 * Back and Next move between them, and the server step completing moves a dialog left open on to
 * the next page by itself. A member asking an admin, and a plugin the server already holds whose
 * steps were opened to manage it, have one page and no indicator.
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
  StepIndicator,
} from "@prismshadow/penguin-ui";
import type { Failure } from "@prismshadow/penguin-ui";
import type { InstallStage } from "../../api/endpoints";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
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

/** One page of the steps. */
export type InstallPage = "server" | "agents" | "done";

/**
 * The pages an install of this plugin takes for this reader, in order (see the module comment):
 * the server's while it has something to do or say, the Agents' for a plugin with something for
 * them, and Ready wherever the steps end in something ready.
 */
export function installPages(input: {
  server: ServerStep;
  /** Two for a plugin with Agent content, one for server modules alone. */
  steps: 1 | 2;
  /** A server change of the plugin is running, or its last install failed. */
  serverRun: boolean;
  /** The plugin's Agent part can be added before its Project module runs (a shipped hybrid). */
  agentPackageAvailable?: boolean;
  /** An admin may uninstall the plugin from the server, on its server page. */
  removable?: boolean;
}): InstallPage[] {
  const { server, steps } = input;
  // A member asking an admin has nothing past the server's page, unless the plugin's Agent part
  // can be added before its module runs.
  const asking = (server === "ask" || server === "held") && input.agentPackageAvailable !== true;
  const pages: InstallPage[] = [];
  if (server !== "done" || input.serverRun || steps === 1 || input.removable === true) {
    pages.push("server");
  }
  if (steps === 2 && !asking && (server !== "unavailable" || input.agentPackageAvailable)) {
    pages.push("agents");
  }
  if (
    pages.includes("agents") ||
    (steps === 1 && server !== "done" && !asking && server !== "unavailable")
  ) {
    pages.push("done");
  }
  return pages;
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
  /** The server step is running. */
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
  /** Opens the administrator's confirmation of an uninstall from the server. */
  onRemoveServer?: () => void;
  machineLabel?: string;
  /** Asks an admin to install it on the server (a member). */
  onAsk: () => Promise<void>;
  /** The Agents page's body. Null while the server's copy is not read yet. */
  agents: ReactNode | null;
  /** The Agents the plugin was added to while these steps were open, by name. */
  added?: readonly string[];
  /** What to do with the plugin once it is ready: open its app, or start its example. */
  next?: { label: string; onClick: () => void } | null;
  onClose: () => void;
}

export function InstallFlow(props: InstallFlowProps) {
  const words = S.plugins.installModel;
  const failed = props.failure != null && !props.busy;
  const serverDone = props.server === "done";
  // The pages are taken when the steps open and kept, so the server's page stays in the run
  // (Back reaches it) after the install it ran is done.
  const [pages] = useState(() =>
    installPages({
      server: props.server,
      steps: props.steps,
      serverRun: props.busy || failed,
      ...(props.agentPackageAvailable ? { agentPackageAvailable: true } : {}),
      ...(props.onRemoveServer !== undefined ? { removable: true } : {}),
    }),
  );
  const [page, setPage] = useState<InstallPage>(() => {
    if (pages[0] === "server" && (props.busy || failed)) return "server";
    const toAgents =
      pages.includes("agents") &&
      (serverDone || (props.server === "held" && props.agentPackageAvailable));
    return toAgents ? "agents" : pages[0]!;
  });
  /** The server install ran while these steps were open, or was running when they opened. */
  const [ran, setRan] = useState(props.busy);
  useEffect(() => {
    if (props.busy) setRan(true);
  }, [props.busy]);
  // The server step completing moves the steps on by themselves.
  useEffect(() => {
    if (!ran || !serverDone || props.busy || page !== "server") return;
    if (pages.includes("agents")) setPage("agents");
    else if (pages.includes("done")) setPage("done");
  }, [ran, serverDone, props.busy, page, pages]);

  const [asked, setAsked] = useState(false);
  const [asking, setAsking] = useState(false);
  const ask = async () => {
    setAsking(true);
    try {
      await props.onAsk();
      setAsked(true);
    } catch {
      // The caller has said why (a toast); the page stays as it was, to try again.
    } finally {
      setAsking(false);
    }
  };

  const added = props.added ?? [];
  const index = pages.indexOf(page);
  const stepNames: Record<InstallPage, string> = {
    server: props.server === "ask" ? words.stepAsk : words.stepServer,
    agents: words.stepAgents,
    done: words.stepReady,
  };
  const phase: InstallPhase = props.busy ? "running" : failed ? "failed" : "before";
  const sentence = installStepWords(props.progress, props.stage, false, props.remote === true);
  const amount = installAmount(props.progress);
  const mark = failed ? "failed" : page === "done" ? "done" : props.busy ? "running" : null;
  const back = (to: InstallPage, label: string = words.back) => (
    <Button size="sm" variant="ghost" onClick={() => setPage(to)}>
      <GlyphIcon d={ICONS.arrowLeft} size={ICON_SIZE.rowLead} />
      {label}
    </Button>
  );
  const done = (
    <Button size="sm" variant="primary" onClick={props.onClose}>
      {words.finish}
    </Button>
  );

  let body: ReactNode;
  let foot: { start?: ReactNode; end?: ReactNode };
  if (page === "server") {
    const installing = props.server === "install" || props.server === "enable";
    if (props.busy || failed) {
      body = (
        <div className="space-y-3 text-sm">
          <div className="space-y-2" role="status">
            <InstallProgress
              plan={props.plan}
              phase={phase}
              stage={props.failure?.stage ?? props.stage}
              progress={props.failure?.progress ?? props.progress}
              label={words.progressLabel(props.title)}
              valueText={props.busy ? sentence : undefined}
            />
            {props.busy && (
              <p className="flex items-baseline justify-between gap-3 text-fg">
                <span className="min-w-0 break-words">{sentence}</span>
                {amount !== null && (
                  <span className="shrink-0 tabular-nums text-fg-muted">{amount}</span>
                )}
              </p>
            )}
          </div>
          {props.busy ? (
            <p className="text-xs text-fg-muted">{words.noCancel}</p>
          ) : (
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
          )}
        </div>
      );
      foot = props.busy
        ? {
            end: (
              <Button size="sm" variant="secondary" onClick={props.onClose}>
                {words.background}
              </Button>
            ),
          }
        : {
            end: (
              <>
                {props.onDismissFailure !== undefined && (
                  <Button size="sm" variant="ghost" onClick={props.onDismissFailure}>
                    {words.dismiss}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="primary"
                  disabled={props.blocked}
                  onClick={props.onServer}
                >
                  {S.common.retry}
                </Button>
              </>
            ),
          };
    } else {
      body = (
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            {(serverDone || props.server === "ask") && (
              <h3 className="font-semibold text-fg">
                {serverDone ? words.ready : asked ? words.askedTitle : words.askTitle}
              </h3>
            )}
            {installing && props.description && (
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
                (props.agentPackageAvailable ? words.projectReady : words.serverDone(props.title))}
            </p>
          </div>
          {installing && (
            <details className="text-xs text-fg-muted">
              <summary tabIndex={0} className="cursor-pointer">
                {words.installDetails}
              </summary>
              <p className="mt-1">{S.plugins.applyConfirmWarning(true)}</p>
            </details>
          )}
        </div>
      );
      const next = pages.includes("agents") && (serverDone || props.agentPackageAvailable);
      foot = {
        start:
          serverDone && props.onRemoveServer ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={props.blocked}
              onClick={props.onRemoveServer}
            >
              {words.uninstallServer}
            </Button>
          ) : undefined,
        end: installing ? (
          <Button size="sm" variant="primary" disabled={props.blocked} onClick={props.onServer}>
            {props.server === "enable" ? words.enableNow : S.skills.install}
          </Button>
        ) : props.server === "ask" && !asked ? (
          <Button size="sm" variant="primary" loading={asking} onClick={() => void ask()}>
            {words.askAdmin}
          </Button>
        ) : next ? (
          <Button size="sm" variant="primary" onClick={() => setPage("agents")}>
            {words.next}
          </Button>
        ) : (
          done
        ),
      };
    }
  } else if (page === "agents") {
    body = (
      <div className="space-y-3">
        <div className="space-y-1 text-sm">
          <h3 className="font-semibold text-fg">{words.chooseAgent}</h3>
          <p className="text-fg-muted">
            {ran && added.length === 0 ? words.chooseAfterInstall : words.chooseAgentHelp}
          </p>
        </div>
        {!serverDone && props.moduleStatus && (
          <p className="text-xs text-fg-muted">{props.moduleStatus}</p>
        )}
        {props.agents ?? <p className="py-1.5 text-xs text-fg-muted">{S.common.loading}</p>}
      </div>
    );
    foot = {
      start: pages.includes("server") ? back("server") : undefined,
      end:
        added.length > 0 ? (
          <Button size="sm" variant="primary" onClick={() => setPage("done")}>
            {words.next}
          </Button>
        ) : ran ? (
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            {words.chooseLater}
          </Button>
        ) : undefined,
    };
  } else {
    body = (
      <section className="space-y-1 text-sm">
        <h3 className="font-semibold text-fg">{words.doneTitle(props.title)}</h3>
        <p className="break-words text-fg-muted">
          {props.steps === 2 && added.length > 0
            ? words.doneAgents(added.join(S.todo.listSeparator))
            : props.steps === 2
              ? words.chooseAgentHelp
              : props.plan.includes("check")
                ? words.doneService
                : words.projectReady}
        </p>
      </section>
    );
    foot = {
      start: pages.includes("agents") ? back("agents", words.addAnother) : undefined,
      end:
        props.next != null ? (
          <>
            <Button size="sm" variant="ghost" onClick={props.onClose}>
              {words.finish}
            </Button>
            <Button size="sm" variant="primary" onClick={props.next.onClick}>
              {props.next.label}
            </Button>
          </>
        ) : (
          done
        ),
    };
  }

  return (
    <Modal open headerless title={words.flowTitle(props.title)} onClose={props.onClose}>
      <div className="space-y-4" data-install-page={page}>
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
        {pages.length > 1 && (
          <StepIndicator
            steps={pages.map((key) => ({ key, label: stepNames[key] }))}
            current={index}
            label={words.stepsLabel}
            doneText={words.stepDone}
          />
        )}
        {body}
        {(foot.start !== undefined || foot.end !== undefined) && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">{foot.start}</div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{foot.end}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** The ring stands this far outside the icon, as the App Center's does around a tile. */
const RING_GAP_PX = 6;

/**
 * A plugin's icon as the App Center draws an app being installed: dimmed under a turning ring
 * while the install runs, the attention mark on its corner when it failed, a check when it is
 * ready. The marks overhang the icon, so the layout around it is the same in every state. The
 * steps' head, the market's card and the plugin's page draw it alike.
 */
export function InstallIcon({
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
 * Why a server install failed, as a note under the plugin's head on its page, with what to do
 * next instead of a dead end: another registry or mirror in Plugin Sources, or a zip import (an
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
