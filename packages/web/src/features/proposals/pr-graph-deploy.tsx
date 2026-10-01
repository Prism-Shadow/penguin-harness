/**
 * Deploying from the PR graph: a node's menu — a right-click on the row, the keyboard's
 * context-menu chord, or the row's ellipsis — lists the organization's deploy scripts, and
 * picking one opens a dialog that runs it on that PR's head and shows the output as it comes.
 *
 * The script is the organization's own (`penguin org proposal deploy-script add`), run by the
 * server that holds the organization; the page only names the PR, the head it showed and the
 * extra arguments. A head that moved since the graph was read is refused by the server, so
 * what runs is the commit the person right-clicked. Closing the dialog stops following the
 * run, not the run.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  ProposalDeployRun,
  ProposalDeployScript,
  ProposalGraphNode,
} from "@prismshadow/penguin-server/api";
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
  Input,
  Menu,
  MenuItem,
  MenuLabel,
  Modal,
  useRowContextMenu,
} from "@prismshadow/penguin-ui";
import { splitArgs } from "./pr-graph-model";

const POLL_MS = 1000;

/** The organization's deploy scripts, read once per page: null while reading. */
export function useDeployScripts(
  projectId: string,
  orgId: string,
): { scripts: ProposalDeployScript[] | null; error: string | null } {
  const [scripts, setScripts] = useState<ProposalDeployScript[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setScripts(null);
    setError(null);
    api.getOrgDeployScripts(projectId, orgId).then(
      (res) => alive && setScripts(res.scripts),
      (e: unknown) => {
        if (!alive) return;
        setScripts([]);
        setError(apiErrorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId, orgId]);
  return { scripts, error };
}

/** A graph row with the deploy menu: the gestures on the row, the ellipsis at its end. */
export function DeployableRow({
  node,
  scripts,
  scriptsError,
  onPick,
  children,
}: {
  node: ProposalGraphNode;
  scripts: ProposalDeployScript[] | null;
  scriptsError: string | null;
  onPick: (script: ProposalDeployScript, withArgs: boolean) => void;
  children: ReactNode;
}) {
  const t = S.company.proposals.graph.deploy;
  const ctx = useRowContextMenu();
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
            aria-label={`#${node.number} · ${t.menuTitle}`}
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
        <Menu label={t.menuTitle} density="sm">
          <MenuLabel>
            {t.menu} · <span className="font-mono">{node.head.slice(0, 9)}</span>
          </MenuLabel>
          {scripts === null ? (
            <MenuItem label="…" disabled />
          ) : scripts.length === 0 ? (
            <MenuItem
              label={scriptsError !== null ? `${t.loadFailed}: ${scriptsError}` : t.none}
              disabled
            />
          ) : (
            scripts.flatMap((s) => [
              <MenuItem
                key={s.id}
                label={t.to(s.id)}
                description={s.description !== "" ? s.description : undefined}
                data-tooltip={s.description || s.command.join(" ")}
                onSelect={() => {
                  close();
                  onPick(s, false);
                }}
              />,
              <MenuItem
                key={`${s.id}+args`}
                label={t.toWithArgs(s.id)}
                onSelect={() => {
                  close();
                  onPick(s, true);
                }}
              />,
            ])
          )}
        </Menu>
      </Dropdown>
    </div>
  );
}

/** Confirm, start, then follow one deploy of a node's head to a script. */
export function DeployDialog({
  projectId,
  orgId,
  node,
  script,
  withArgs,
  runId: knownRunId,
  onRun,
  onClose,
}: {
  projectId: string;
  orgId: string;
  node: ProposalGraphNode;
  script: ProposalDeployScript;
  /** Ask for extra arguments first; otherwise the deploy starts as the dialog opens. */
  withArgs: boolean;
  /** A run already started (reopened from the corner dock): follow it instead of starting one. */
  runId: string | null;
  /** The run this dialog started, and every status it reads, for the dock. */
  onRun: (run: ProposalDeployRun) => void;
  onClose: () => void;
}) {
  const t = S.company.proposals.graph.deploy;
  const [args, setArgs] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<ProposalDeployRun | null>(null);
  const [followId, setFollowId] = useState<string | null>(knownRunId);
  // The parent's callback changes every render; the effects below must not restart for it.
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const [output, setOutput] = useState("");
  const outRef = useRef<HTMLPreElement | null>(null);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await api.startOrgDeploy(projectId, orgId, {
        script: script.id,
        pr: node.number,
        head: node.head,
        args: splitArgs(args),
      });
      if ("run" in res) {
        setRun(res.run);
        setFollowId(res.run.id);
        onRunRef.current(res.run);
      }
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setStarting(false);
    }
  }, [projectId, orgId, script.id, node.number, node.head, args]);

  // A plain deploy starts as the dialog opens — once, and never for a run reopened from the dock.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (withArgs || knownRunId !== null || autoStarted.current) return;
    autoStarted.current = true;
    void start();
  }, [withArgs, knownRunId, start]);

  // Follow the run while it is running; a closed dialog stops asking (the dock takes over).
  const runId = followId;
  useEffect(() => {
    if (runId === null) return;
    let alive = true;
    let from = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await api.getOrgDeployRun(projectId, orgId, runId, from);
        if (!alive) return;
        from = res.next;
        if (res.output !== "") setOutput((o) => o + res.output);
        setRun(res.run);
        onRunRef.current(res.run);
        if (res.run.status === "running") timer = setTimeout(() => void tick(), POLL_MS);
      } catch (e) {
        if (alive) setError(apiErrorText(e));
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [projectId, orgId, runId]);

  useEffect(() => {
    const el = outRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [output]);

  const ref = `#${node.number}`;
  const head = node.head.slice(0, 12);
  const status =
    run === null || run.status === "running" ? (
      <span className="text-gray-500 dark:text-gray-400">{t.running}</span>
    ) : run.status === "succeeded" ? (
      <span className={toneInk.success}>{t.succeeded}</span>
    ) : (
      <span className={toneInk.danger}>
        {run.status === "timed_out" ? t.timedOut : t.failed(run.exitCode, run.error)}
      </span>
    );

  return (
    <Modal
      open
      title={t.title(script.id)}
      onClose={onClose}
      widthClass="sm:max-w-2xl"
      footer={
        run === null && withArgs && knownRunId === null ? (
          <>
            <Button size="sm" variant="secondary" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button size="sm" variant="primary" disabled={starting} onClick={() => void start()}>
              {t.start}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={onClose}>
            {t.close}
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <p>{t.what(ref, head)}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t.command}:{" "}
          <code className="font-mono break-all">
            {[...script.command, ...splitArgs(args)].join(" ")}
          </code>
        </p>
        {run === null && withArgs && knownRunId === null ? (
          <Input
            size="sm"
            label={t.args}
            hint={t.argsHint}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            className="font-mono"
          />
        ) : (
          <>
            <p className="text-xs font-medium">{status}</p>
            <pre
              ref={outRef}
              className="max-h-80 overflow-auto rounded-md bg-gray-50 p-2 font-mono text-xs whitespace-pre-wrap text-gray-700 dark:bg-gray-900 dark:text-gray-300"
            >
              {output === "" ? t.noOutput : output}
            </pre>
            {(run === null || run.status === "running") && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{t.keepsRunning}</p>
            )}
          </>
        )}
        {error !== null && <p className={`text-xs ${toneInk.danger}`}>{error}</p>}
      </div>
    </Modal>
  );
}
