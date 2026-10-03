/**
 * The deploys started from the PR graph, kept past their dialog: a dialog closed mid-deploy
 * leaves its run in a dock in the corner, which reads the run's status while the dialog is shut
 * and brings the dialog back on a click. The runs live on the server; what is kept here is only
 * which ones this tab started, in session storage per organization, so leaving the page and
 * coming back finds them again.
 */
import { useCallback, useEffect, useState } from "react";
import type {
  ActionRunOutcome,
  ActionRunView,
  ProposalGraphNode,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { CloseButton, Spinner } from "@prismshadow/penguin-ui";
import { deployName } from "./pr-graph-deploy";
import { nodeRef } from "./pr-graph-model";

/** One deploy started from the graph: what was deployed with which Action, and its run once it has one. */
export interface DeployJob {
  key: string;
  node: ProposalGraphNode;
  /** The node's subject (`pr:<owner>/<repo>#<n>`). */
  subject: string;
  /** The deploy Action's key. */
  action: string;
  runId: string | null;
  /** How the run ended; null while it runs (or before it started). */
  outcome: ActionRunOutcome | null;
}

const DOCK_POLL_MS = 3000;

const storageKey = (projectId: string, orgId: string) => `pr-graph-deploys:${projectId}/${orgId}`;

function readJobs(key: string): DeployJob[] {
  try {
    const raw = sessionStorage.getItem(key);
    const jobs = raw === null ? [] : (JSON.parse(raw) as DeployJob[]);
    // A job that never got a run cannot be followed after a reload.
    return Array.isArray(jobs) ? jobs.filter((j) => j.runId !== null) : [];
  } catch {
    return [];
  }
}

/** The jobs of one organization, the one whose dialog is open, and the ways to change both. */
export function useDeployJobs(projectId: string, orgId: string) {
  const key = storageKey(projectId, orgId);
  const [jobs, setJobs] = useState<DeployJob[]>(() => readJobs(key));
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setJobs(readJobs(key)), [key]);
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(jobs.filter((j) => j.runId !== null)));
    } catch {
      // Storage refused (private window): the dock still works for this page's life.
    }
  }, [key, jobs]);

  const start = useCallback((node: ProposalGraphNode, subject: string, action: string) => {
    const job: DeployJob = {
      key: `${node.key}:${action}:${Date.now()}`,
      node,
      subject,
      action,
      runId: null,
      outcome: null,
    };
    setJobs((js) => [...js, job]);
    setOpen(job.key);
  }, []);
  const update = useCallback((jobKey: string, run: ActionRunView) => {
    setJobs((js) =>
      js.map((j) => (j.key === jobKey ? { ...j, runId: run.id, outcome: run.outcome } : j)),
    );
  }, []);
  const close = useCallback(() => {
    // A dialog closed before anything started leaves nothing behind.
    setJobs((js) => js.filter((j) => j.key !== open || j.runId !== null));
    setOpen(null);
  }, [open]);
  const dismiss = useCallback((jobKey: string) => {
    setJobs((js) => js.filter((j) => j.key !== jobKey));
  }, []);
  return { jobs, open, setOpen, start, update, close, dismiss };
}

/** The corner dock: every job whose dialog is shut, newest last; running ones are read on a timer. */
export function DeployDock({
  projectId,
  orgId,
  jobs,
  open,
  onOpen,
  onStatus,
  onDismiss,
}: {
  projectId: string;
  orgId: string;
  jobs: readonly DeployJob[];
  open: string | null;
  onOpen: (jobKey: string) => void;
  onStatus: (jobKey: string, run: ActionRunView) => void;
  onDismiss: (jobKey: string) => void;
}) {
  const t = S.company.proposals.graph.deploy;
  const shown = jobs.filter((j) => j.key !== open && j.runId !== null);
  const running = shown.filter((j) => j.outcome === null);
  const runningIds = running.map((j) => `${j.key}=${j.runId}`).join(",");

  useEffect(() => {
    if (running.length === 0) return;
    let alive = true;
    const timer = setInterval(() => {
      for (const job of running) {
        // `from` past any output: only the status is wanted here.
        api.getOrgActionRun(projectId, orgId, job.runId!, Number.MAX_SAFE_INTEGER).then(
          (res) => alive && onStatus(job.key, res.run),
          () => undefined,
        );
      }
    }, DOCK_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // runningIds names the set; the array itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, orgId, runningIds, onStatus]);

  if (shown.length === 0) return null;
  return (
    <div
      role="region"
      aria-label={t.dockTitle}
      className="fixed right-4 bottom-4 z-40 flex max-w-sm flex-col gap-2"
    >
      {shown.map((job) => {
        const live = job.outcome === null;
        const tone = job.outcome === "succeeded" ? toneInk.success : live ? "" : toneInk.danger;
        const word = live
          ? t.running
          : job.outcome === "succeeded"
            ? t.succeeded
            : t.failed(null, null);
        return (
          <div
            key={job.key}
            className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
              aria-label={t.dockOpen(nodeRef(job.node), deployName(job.action))}
              onClick={() => onOpen(job.key)}
            >
              {live && <Spinner size="sm" label={t.running} />}
              <span className="min-w-0 truncate">
                <span className="font-mono">{nodeRef(job.node)}</span> → {deployName(job.action)}
              </span>
              <span className={`shrink-0 ${tone}`}>{word}</span>
            </button>
            {!live && <CloseButton label={t.dockDismiss} onClose={() => onDismiss(job.key)} />}
          </div>
        );
      })}
    </div>
  );
}
