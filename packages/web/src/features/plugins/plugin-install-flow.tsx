/**
 * Installing a plugin, as one dialog of up to two steps: the server first, then the Agents. A
 * plugin's Agent content (Skills, hooks, MCP servers, workbenches) comes from its package on the
 * server, so a plugin that is not there yet goes there first, and the dialog says where the
 * install stands: a bar across the top, 1/2 while the server installs it and 2/2 once the Agents
 * are picked, with the server step's own progress in words under it (checking the plugin source,
 * downloading N%, installing from the offline archive, loading the module).
 *
 * - Step 1, the server. Already there (an admin installed it, or the build ships it): done, and
 *   the dialog opens on step 2. Not there: an admin installs it, the dialog saying what that
 *   does (every Project shares it; the server reloads its plugins, runs in progress carry on);
 *   a member asks an admin to, and the dialog ends there. A server module the build ships but
 *   this Project does not run yet is enabled instead. A failure stays on the step with its next
 *   steps (Plugin Sources, Import from file).
 * - Step 2, the Agents: the caller's list, each Agent with its own Install / Installed / Update.
 *
 * A plugin of server modules alone has one step. The flow moves to step 2 by itself when the
 * server step completes: the card stays mounted while its market row becomes a library row, so
 * the dialog does too.
 */
import { useEffect, useState, type ReactNode } from "react";

import { Button, GlyphIcon, ICON_SIZE, ICONS, Modal, ProgressBar } from "@prismshadow/penguin-ui";
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
  | "held";

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
  /** Two steps for a plugin with Agent content, one for server modules alone. */
  steps: 1 | 2;
  server: ServerStep;
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
  /** Asks an admin to install it on the server (a member). */
  onAsk: () => Promise<void>;
  /** Step 2's body: the Agents. Null while the server's copy is not read yet. */
  agents: ReactNode | null;
  onClose: () => void;
}

export function InstallFlow(props: InstallFlowProps) {
  const words = S.plugins.installModel;
  const serverDone = props.server === "done";
  const [step, setStep] = useState<1 | 2>(serverDone && props.steps === 2 ? 2 : 1);
  const [asked, setAsked] = useState(false);
  const [asking, setAsking] = useState(false);
  // The server step completing moves the flow on by itself.
  useEffect(() => {
    if (serverDone && props.steps === 2) setStep(2);
  }, [serverDone, props.steps]);
  const stepLabels = [words.stepServer, words.stepAgents];
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
    <Modal open title={words.flowTitle(props.title)} onClose={props.onClose}>
      <div className="space-y-4">
        {/* Where the install stands, for a plugin with two steps: each step's name, and the bar
            across them filled to the step on show (1/2, then 2/2). */}
        {props.steps === 2 && (
          <div className="space-y-2" data-testid="install-flow-progress">
            <ol className="flex items-center gap-3 text-xs">
              {stepLabels.map((label, i) => {
                const n = i + 1;
                const done = n === 1 && (serverDone || asked);
                return (
                  <li
                    key={label}
                    aria-current={n === step ? "step" : undefined}
                    className={`flex min-w-0 items-center gap-1.5 ${
                      n === step ? "font-medium text-fg" : "text-fg-muted"
                    }`}
                  >
                    {done ? (
                      <GlyphIcon
                        d={ICONS.checkCircle}
                        size={ICON_SIZE.inlineGlyph}
                        className={`shrink-0 ${toneInk.success}`}
                        aria-label={words.stepDone}
                      />
                    ) : (
                      <span aria-hidden className="shrink-0 tabular-nums">
                        {n}.
                      </span>
                    )}
                    <span className="truncate">{label}</span>
                  </li>
                );
              })}
              <li className="ml-auto shrink-0 tabular-nums text-fg-muted" aria-hidden>
                {step}/{props.steps}
              </li>
            </ol>
            <ProgressBar
              size="xs"
              value={step}
              max={props.steps}
              label={words.stepOf(step, props.steps)}
            />
          </div>
        )}

        {step === 1 ? (
          <div className="space-y-3 text-sm">
            {props.server === "install" && (
              <>
                <p>{S.plugins.applyConfirmInstallBody(props.title)}</p>
                <p className="text-xs text-fg-muted">{S.plugins.applyConfirmWarning(true)}</p>
              </>
            )}
            {props.server === "enable" && (
              <>
                <p>{words.enableBody(props.title)}</p>
                <p className="text-xs text-fg-muted">{S.plugins.applyConfirmWarning(true)}</p>
              </>
            )}
            {props.server === "ask" && <p>{asked ? words.asked : words.askBody}</p>}
            {props.server === "held" && <p>{words.adminOnly}</p>}
            {serverDone && <p>{words.serverDone(props.title)}</p>}

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
              {(serverDone || asked || props.server === "held") && (
                <Button size="sm" onClick={props.onClose}>
                  {words.finish}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {props.agents ?? <p className="py-1.5 text-xs text-fg-muted">{S.common.loading}</p>}
          </div>
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
