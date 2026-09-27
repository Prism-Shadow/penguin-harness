/**
 * Deploy: whether a deploy of this activity could start now, and what is still missing, each
 * in words, then the module release and the QA deploy. The owner can make the missing clones (Prepare clones),
 * ask the remote whether the branches are there (Check remote), and release the module; each
 * is an explicit press, and the release asks before it pushes anything.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DeployContext,
  DeployContextResponse,
  DeployRun,
  DeployStateResponse,
} from "@prismshadow/penguin-server/api";
import { ApiError, apiFetch } from "../../api/client";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneDot, toneInk } from "../../lib/tone";
import {
  clonesMissing,
  needsSettings,
  problemText,
  readinessLine,
  readinessRows,
  repoName,
} from "./deploy-model";
import { DeployRelease } from "./deploy-release";
import type { Announcement } from "./run-toasts";

const HEAD =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
const TH = "whitespace-nowrap px-3 py-2 font-medium";
const TD = "px-3 py-2 align-top";

/** Why a Prepare clones press failed, in words: the server sends the facts, not a sentence. */
function prepareError(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "deploy_clone_failed" && cause.detail?.repo) {
    const repo = cause.detail.repo;
    const name =
      repo === "module" || repo === "activityData" || repo === "media" ? repoName(repo) : repo;
    return cause.detail.reason === "timed_out"
      ? S.activities.deploy.cloneTimedOut(name)
      : S.activities.deploy.cloneFailed(name, cause.detail.output ?? "");
  }
  return apiErrorText(cause);
}

export function DeployPanel({
  endpoint,
  productCode,
  editable,
  onAnnounce,
}: {
  /** The activity's API path. */
  endpoint: string;
  /** The activity's product code, which the QA deploy's confirmation names. */
  productCode: string;
  /** Whether the viewer owns the project: only the owner prepares clones or asks the remote. */
  editable: boolean;
  onAnnounce: (announcement: Announcement) => void;
}) {
  const words = S.activities.deploy;
  const [state, setState] = useState<DeployStateResponse | null>(null);
  const context = state?.context ?? null;
  const setContext = useCallback(
    (value: DeployContext) =>
      setState((current) => (current ? { ...current, context: value } : current)),
    [],
  );
  const setRun = useCallback(
    (run: DeployRun) => setState((current) => (current ? { ...current, run } : current)),
    [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"prepare" | "remote" | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const load = useCallback(
    async (checkRemote = false) => {
      const value = await apiFetch<DeployContextResponse>(
        `${endpoint}/deploy/context${checkRemote ? "?checkRemote=1" : ""}`,
      );
      return value.context;
    },
    [endpoint],
  );
  const loadState = useCallback(
    () => apiFetch<DeployStateResponse>(`${endpoint}/deploy`),
    [endpoint],
  );
  const reload = useCallback(() => {
    loadState()
      .then((value) => {
        if (alive.current) setState(value);
      })
      .catch((cause) => {
        if (alive.current) setActionError(apiErrorText(cause));
      });
  }, [loadState]);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setLoadError(null);
    loadState()
      .then((value) => {
        if (!cancelled) setState(value);
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(apiErrorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [loadState]);

  async function prepare() {
    setBusy("prepare");
    setActionError(null);
    try {
      const value = await apiFetch<DeployContextResponse>(`${endpoint}/deploy/clones`, {
        method: "POST",
      });
      if (!alive.current) return;
      setContext(value.context);
      // The stages' blockers follow the clones.
      reload();
      onAnnounce({ kind: "success", text: words.prepared });
    } catch (cause) {
      if (alive.current) setActionError(prepareError(cause));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function checkRemote() {
    setBusy("remote");
    setActionError(null);
    try {
      const value = await load(true);
      if (!alive.current) return;
      setContext(value);
      onAnnounce({ kind: "info", text: words.remoteChecked });
    } catch (cause) {
      if (alive.current) setActionError(apiErrorText(cause));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  const line = context ? readinessLine(context) : null;
  const rows = context ? readinessRows(context) : [];
  return (
    <section className="space-y-4" aria-labelledby="activity-deploy-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="activity-deploy-title" className="flex items-center gap-2 text-sm font-semibold">
          {words.title}
          <InfoPopover label={words.title}>
            <p>{words.about}</p>
          </InfoPopover>
        </h3>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={context === null || busy !== null || !clonesMissing(context)}
              aria-busy={busy === "prepare"}
              onClick={() => void prepare()}
            >
              {busy === "prepare" ? words.preparing : words.prepareClones}
            </Button>
            <Button
              size="sm"
              disabled={context === null || busy !== null}
              aria-busy={busy === "remote"}
              onClick={() => void checkRemote()}
            >
              {busy === "remote" ? words.checkingRemote : words.checkRemote}
            </Button>
          </div>
        )}
      </div>
      {loadError && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {words.loadFailed(loadError)}
        </p>
      )}
      {!loadError && !context && <p className="text-xs text-gray-500">{words.loading}</p>}
      {actionError && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {actionError}
        </p>
      )}
      {context && line && (
        <>
          <p
            role="status"
            className={`text-sm font-medium ${toneInk[line.tone]}`}
            data-testid="deploy-readiness"
          >
            {line.text}
          </p>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm" aria-label={words.checksLabel}>
              <thead>
                <tr className={HEAD}>
                  <th className={TH}>{words.columns.check}</th>
                  <th className={TH}>{words.columns.state}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className={`${TD} whitespace-nowrap font-medium`}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={`size-1.5 shrink-0 rounded-full ${toneDot[row.tone]}`}
                        />
                        {row.label}
                      </span>
                    </td>
                    <td className={`${TD} break-words text-xs`}>{row.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {context.problems.length > 0 && (
            <section aria-labelledby="activity-deploy-problems" className="space-y-1">
              <h4 id="activity-deploy-problems" className="text-xs font-semibold">
                {words.problemsTitle}
              </h4>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {context.problems.map((problem, index) => (
                  <li key={`${problem.code}:${index}`}>{problemText(problem)}</li>
                ))}
              </ul>
              {needsSettings(context) && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{words.settingsHint}</p>
              )}
            </section>
          )}
          {state && context.branches.deploy && (
            <DeployRelease
              endpoint={endpoint}
              editable={editable}
              run={state.run}
              stages={state.stages}
              branch={context.branches.deploy}
              activityDataBranch={context.branches.activityData}
              productCode={productCode}
              onRun={setRun}
              onSettled={reload}
              onAnnounce={onAnnounce}
            />
          )}
        </>
      )}
    </section>
  );
}
