/**
 * Deploying from the PR graph: a node's menu — a right-click on the row, the keyboard's
 * context-menu chord, or the row's ellipsis — lists the organization's `deploy.*` Actions
 * for that PR, and picking one opens a dialog that runs it on the PR's head and shows the output
 * as it comes.
 *
 * A deploy Action is contributed by a company workflow of the organization (`penguin org
 * workflow put`); the server runs it. The page names the subject and the head it
 * showed (`expectedHead`), and the server refuses a head that moved, so what runs is the commit
 * the person right-clicked. Closing the dialog stops following the run, not the run.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ActionRunView, ActionView, ProposalGraphNode } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import {
  Button,
  Dropdown,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Menu,
  MenuItem,
  Modal,
  useRowContextMenu,
} from "@prismshadow/penguin-ui";
import { nodeRef } from "./pr-graph-model";

const POLL_MS = 1000;

/** The subject of a PR node of the delivery repository. */
export function prSubject(repo: string, number: number): string {
  return `pr:${repo}#${number}`;
}

/**
 * The subject a deploy from a node runs on: its PR, or — a branch node, which always has a
 * proposal — that proposal, whose head is its impl branch's tip. Null for neither.
 */
export function nodeSubject(
  repo: string,
  node: Pick<ProposalGraphNode, "number" | "proposal">,
): string | null {
  if (node.number !== null) return prSubject(repo, node.number);
  return node.proposal === null ? null : `proposal:${node.proposal.number}`;
}

/** What the menu calls a deploy Action: its key past `deploy.`. */
export function deployName(key: string): string {
  return key.startsWith("deploy.") ? key.slice("deploy.".length) : key;
}

/** The deploy Actions of a subject, as the guard answers for the caller. */
export function deployActions(actions: readonly ActionView[]): ActionView[] {
  return actions.filter((a) => a.key.startsWith("deploy."));
}

/** The exit code a process run reports in its result, when it has one. */
export function exitCodeOf(run: ActionRunView): number | null {
  const r = run.result as { exitCode?: unknown } | null;
  return r !== null && typeof r === "object" && typeof r.exitCode === "number" ? r.exitCode : null;
}

/** A graph row with the deploy menu: the gestures on the row, the ellipsis at its end. */
export function DeployableRow({
  projectId,
  orgId,
  node,
  subject,
  onPick,
  children,
}: {
  projectId: string;
  orgId: string;
  node: ProposalGraphNode;
  subject: string;
  onPick: (action: ActionView) => void;
  children: ReactNode;
}) {
  const t = S.company.proposals.graph.deploy;
  const ctx = useRowContextMenu();
  const [actions, setActions] = useState<ActionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read when the menu opens: which there are, and whether the guard lets the caller run it now.
  useEffect(() => {
    if (!ctx.open) return;
    let alive = true;
    setActions(null);
    setError(null);
    api.listOrgActions(projectId, orgId, subject).then(
      (res) => alive && setActions(deployActions(res.actions)),
      (e: unknown) => {
        if (!alive) return;
        setActions([]);
        setError(apiErrorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [ctx.open, projectId, orgId, subject]);
  const close = () => {
    ctx.returnFocus()?.focus();
    ctx.close();
  };
  return (
    <div
      ref={ctx.rowRef}
      onContextMenu={ctx.rowProps.onContextMenu}
      onKeyDown={ctx.rowProps.onKeyDown}
      className="group flex min-w-0 flex-1 items-center"
    >
      {children}
      <Dropdown
        open={ctx.open}
        setOpen={ctx.setOpen}
        portal={{ direction: "down", align: "right" }}
        anchorRect={ctx.anchor}
        anchorOwner={ctx.anchorOwner}
        returnFocus={ctx.returnFocus}
        menuClass="w-64"
        button={
          <button
            type="button"
            data-tooltip={t.menuTitle}
            aria-label={`${nodeRef(node)} · ${t.menuTitle}`}
            aria-haspopup="menu"
            aria-expanded={ctx.open}
            onClick={(e) => {
              if (ctx.open) {
                ctx.close();
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              ctx.openAt({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
            }}
            className={`ml-2 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-gray-400 transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-700 focus-visible:opacity-100 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200 ${
              ctx.open ? "opacity-100" : "opacity-40"
            }`}
          >
            <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.groupHeaderAction} filled />
          </button>
        }
      >
        {/* One "Deploy to …" per deploy Action; one the guard refuses is shown disabled with its reason. */}
        <Menu label={t.menuTitle} density="sm">
          {actions === null ? (
            <MenuItem label="…" disabled />
          ) : error !== null ? (
            <MenuItem label={`${t.loadFailed}: ${error}`} disabled />
          ) : actions.length === 0 ? (
            <MenuItem label={t.none} disabled />
          ) : (
            actions.map((a) => (
              <MenuItem
                key={a.contribution}
                label={t.to(deployName(a.key))}
                disabled={a.allowed === false}
                data-tooltip={a.allowed === false ? (a.refusal?.message ?? "") : a.description}
                onSelect={() => {
                  close();
                  onPick(a);
                }}
              />
            ))
          )}
        </Menu>
      </Dropdown>
    </div>
  );
}

/** Start, then follow one deploy of a node's head with a deploy Action. */
export function DeployDialog({
  projectId,
  orgId,
  node,
  subject,
  actionKey,
  runId: knownRunId,
  onRun,
  onClose,
}: {
  projectId: string;
  orgId: string;
  node: ProposalGraphNode;
  subject: string;
  actionKey: string;
  /** A run already started (reopened from the corner dock): follow it instead of starting one. */
  runId: string | null;
  /** The run this dialog started, and every state it reads, for the dock. */
  onRun: (run: ActionRunView) => void;
  onClose: () => void;
}) {
  const t = S.company.proposals.graph.deploy;
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<ActionRunView | null>(null);
  const [followId, setFollowId] = useState<string | null>(knownRunId);
  // The parent's callback changes every render; the effects below must not restart for it.
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const [output, setOutput] = useState("");
  const outRef = useRef<HTMLPreElement | null>(null);

  // A plain deploy starts as the dialog opens — once, and never for a run reopened from the dock.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (knownRunId !== null || autoStarted.current) return;
    autoStarted.current = true;
    api.runOrgAction(projectId, orgId, actionKey, subject, { expectedHead: node.head }).then(
      (res) => {
        setRun(res.run);
        setFollowId(res.run.id);
        onRunRef.current(res.run);
      },
      (e: unknown) => setError(apiErrorText(e)),
    );
  }, [knownRunId, projectId, orgId, actionKey, subject, node.head]);

  // Follow the run until it ends; a closed dialog stops asking (the dock takes over).
  useEffect(() => {
    if (followId === null) return;
    let alive = true;
    let from = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await api.getOrgActionRun(projectId, orgId, followId, from);
        if (!alive) return;
        from = res.next;
        if (res.output !== "") setOutput((o) => o + res.output);
        setRun(res.run);
        onRunRef.current(res.run);
        if (res.run.outcome === null) timer = setTimeout(() => void tick(), POLL_MS);
      } catch (e) {
        if (alive) setError(apiErrorText(e));
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [projectId, orgId, followId]);

  useEffect(() => {
    const el = outRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [output]);

  const head = node.head.slice(0, 12);
  const status =
    run === null || run.outcome === null ? (
      <span className="text-gray-500 dark:text-gray-400">{t.running}</span>
    ) : run.outcome === "succeeded" ? (
      <span className={toneInk.success}>{t.succeeded}</span>
    ) : run.outcome === "refused" ? (
      <span className={toneInk.danger}>{t.refused(run.message ?? run.code ?? "")}</span>
    ) : (
      <span className={toneInk.danger}>{t.failed(exitCodeOf(run), run.message)}</span>
    );

  return (
    <Modal
      open
      title={t.title(deployName(actionKey))}
      onClose={onClose}
      widthClass="sm:max-w-2xl"
      footer={
        <Button size="sm" variant="secondary" onClick={onClose}>
          {t.close}
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <p>{t.what(nodeRef(node), head)}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t.action}: <code className="font-mono break-all">{actionKey}</code>
        </p>
        <p className="text-xs font-medium">{status}</p>
        <pre
          ref={outRef}
          className="max-h-80 overflow-auto rounded-md bg-gray-50 p-2 font-mono text-xs whitespace-pre-wrap text-gray-700 dark:bg-gray-900 dark:text-gray-300"
        >
          {output === "" ? t.noOutput : output}
        </pre>
        {(run === null || run.outcome === null) && error === null && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{t.keepsRunning}</p>
        )}
        {error !== null && <p className={`text-xs ${toneInk.danger}`}>{error}</p>}
      </div>
    </Modal>
  );
}
