import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmModal,
  EmptyState,
  SearchInput,
} from "@prismshadow/penguin-ui";
import { getSession, listSessions } from "../../api/endpoints";
import { mixAgents, useMachineAgents } from "../../lib/machine-agent-lists";
import { usePageWorkspace } from "../../lib/page-workspace";
import {
  closeSessionResources,
  listSessionResourceCounts,
} from "../../lib/session-resource-counts";
import {
  isSessionWorkbenchKind,
  parseSessionWorkbenchPage,
  sessionWorkbenchEntries,
  sessionWorkbenchPage,
  type SessionWorkbenchKind,
} from "../../lib/session-workbenches";
import { S } from "../../lib/strings";
import { useProject } from "../../state/project";
import { useSessionWorkbenchPanels } from "./panel-registry";

const PAGE_SIZE = 32;
const RESOURCE_REFRESH_MS = 5_000;
type Row = { session: SessionInfo; machineId: string | null; host: string; count: number | null };
const idOf = (row: Row) => JSON.stringify([row.machineId, row.session.sessionId]);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SessionWorkbenchPage() {
  const { kind } = useParams();
  const { currentProject } = useProject();
  const location = useLocation();
  const address = parseSessionWorkbenchPage({ path: location.pathname + location.search })?.address;
  const definition = useSessionWorkbenchPanels(address?.machineId === null).find(
    (p) => p.id === kind,
  );
  if (!kind || !isSessionWorkbenchKind(kind) || !definition || !currentProject) {
    return (
      <p role="status" className="p-4">
        {S.dock.toolUnavailable}
      </p>
    );
  }
  if (address)
    return (
      <BoundSession
        key={location.key}
        kind={kind}
        title={definition.label()}
        address={address}
        project={currentProject.projectId}
      />
    );
  if (location.search || !sessionWorkbenchEntries[kind])
    return (
      <p role="status" className="p-4">
        {S.dock.toolUnavailable}
      </p>
    );
  return (
    <SessionPicker
      key={JSON.stringify([kind, currentProject.projectId])}
      kind={kind}
      title={definition.label()}
      project={currentProject.projectId}
    />
  );
}

function BoundSession({
  kind,
  title,
  address,
  project,
}: {
  kind: SessionWorkbenchKind;
  title: string;
  address: { sessionId: string; machineId: string | null; projectId: string };
  project: string;
}) {
  const workspace = usePageWorkspace();
  const open = useRef(workspace?.openBesideSession);
  open.current = workspace?.openBesideSession;
  const [error, setError] = useState("");
  const { sessionId, machineId, projectId } = address;
  useEffect(() => {
    let active = true;
    if (projectId !== project || !open.current) {
      setError(S.dock.toolUnavailable);
      return;
    }
    void getSession(sessionId, machineId).then(
      ({ session }) => {
        if (!active) return;
        if (session.projectId !== projectId || session.sessionId !== sessionId) {
          setError(S.dock.toolUnavailable);
          return;
        }
        open.current?.(
          sessionId,
          sessionWorkbenchPage(kind, { projectId, machineId, sessionId }, title),
          { projectId, machineId, session },
        );
      },
      (e) => {
        if (active) setError(messageOf(e));
      },
    );
    return () => {
      active = false;
    };
  }, [project, projectId, sessionId, machineId, kind, title]);
  return (
    <p className="p-4" role="status">
      {error || S.common.loading}
    </p>
  );
}

function SessionPicker({
  kind,
  title,
  project,
}: {
  kind: SessionWorkbenchKind;
  title: string;
  project: string;
}) {
  const { agents } = useProject();
  const { lists } = useMachineAgents(project);
  const workspace = usePageWorkspace();
  const sources = useMemo(() => mixAgents(agents, lists, { liveOnly: true }), [agents, lists]);
  const [query, setQuery] = useState("");
  const needle = query.trim();
  const [pages, setPages] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<string[]>([]);
  const [closed, setClosed] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const directory = useRef<HTMLElement>(null);
  const refreshResources = useRef<() => void>(() => {});
  const resource = kind === "terminal" || kind === "builtin-browser" ? kind : null;
  useEffect(() => {
    let current = true;
    let reading = false;
    let requested = false;
    let timer: ReturnType<typeof setTimeout>;
    let hasLaterSessions = false;
    const listErrors: string[] = [];
    const hosts = new Map<string | null, string>([[null, S.dock.here]]);
    for (const source of sources)
      if (source.on) hosts.set(source.on.machine.machineId, source.on.machine.label);
    const directories = [...hosts].map(([machineId, host]) => ({
      machineId,
      host,
      agents: sources.filter((source) => (source.on?.machine.machineId ?? null) === machineId),
      listed: new Map<string, SessionInfo>(),
      active: new Map<string, SessionInfo>(),
    }));
    const visible = () =>
      document.visibilityState !== "hidden" && !directory.current?.closest("[inert]");
    // Page through the Session directory once per search, page or machine change.
    // Polling a resource count never scans this history again.
    async function listHistory() {
      await Promise.all(
        directories.flatMap(({ machineId, host, agents, listed }) =>
          agents.map(async ({ agent }) => {
            try {
              let before: { lastActiveAt: string; sessionId: string } | undefined;
              for (let index = 0; current && index < pages; index++) {
                const { sessions } = await listSessions(
                  project,
                  agent.agentId,
                  {
                    order: "activity",
                    limit: PAGE_SIZE + 1,
                    ...(needle ? { search: needle } : {}),
                    ...(before ? { before } : {}),
                  },
                  machineId,
                );
                const page = sessions.slice(0, PAGE_SIZE);
                for (const session of page)
                  if (session.projectId === project && session.agentId === agent.agentId)
                    listed.set(session.sessionId, session);
                const last = page.at(-1);
                if (!last || sessions.length <= PAGE_SIZE) break;
                before = { lastActiveAt: last.lastActiveAt, sessionId: last.sessionId };
                if (index === pages - 1) hasLaterSessions = true;
              }
            } catch (error) {
              listErrors.push(host + " (" + agent.agentId + "): " + messageOf(error));
            }
          }),
        ),
      );
    }
    async function readCounts() {
      if (!current) return;
      if (reading) {
        requested = true;
        return;
      }
      clearTimeout(timer);
      reading = true;
      const output: Row[] = [];
      const problems = [...listErrors];
      let hasMore = hasLaterSessions;
      await Promise.all(
        directories.map(async ({ machineId, host, agents, listed, active }) => {
          let counts: Record<string, number> | null = null;
          if (resource)
            try {
              counts = await listSessionResourceCounts(resource, project, machineId);
            } catch (error) {
              active.clear();
              problems.push(host + ": " + messageOf(error));
            }
          if (!current) return;
          // Off-page owners (including historical subagents) come from the complete
          // authorized resource index. Only newly active IDs need a metadata lookup.
          if (counts !== null) {
            const leaders = Object.entries(counts)
              .filter(([, count]) => count > 0)
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
            // Search all resource owners, including those beyond the current page.
            const limit = needle ? leaders.length : pages * PAGE_SIZE;
            if (leaders.length > limit) hasMore = true;
            const relevant = new Set(leaders.slice(0, limit).map(([id]) => id));
            for (const id of active.keys()) if (!relevant.has(id)) active.delete(id);
            const missing = [...relevant].filter((id) => !listed.has(id) && !active.has(id));
            for (let start = 0; current && start < missing.length; start += 6) {
              await Promise.all(
                missing.slice(start, start + 6).map(async (id) => {
                  try {
                    const { session } = await getSession(id, machineId);
                    if (
                      session.sessionId === id &&
                      session.projectId === project &&
                      agents.some(({ agent }) => agent.agentId === session.agentId)
                    )
                      active.set(id, session);
                  } catch (error) {
                    problems.push(host + ": " + messageOf(error));
                  }
                }),
              );
            }
          }
          for (const [id, session] of new Map([...listed, ...active])) {
            const count = counts === null ? null : (counts[id] ?? 0);
            if (resource && !count) continue;
            if (
              !listed.has(id) &&
              needle &&
              ![session.title, session.sessionId, session.workspace, session.agentId, host].some(
                (value) => value?.toLowerCase().includes(needle.toLowerCase()),
              )
            )
              continue;
            output.push({
              session,
              host,
              machineId,
              count,
            });
          }
        }),
      );
      reading = false;
      if (!current) return;
      setRows(
        output.sort(
          (a, b) =>
            (b.count ?? 0) - (a.count ?? 0) ||
            b.session.lastActiveAt.localeCompare(a.session.lastActiveAt) ||
            idOf(a).localeCompare(idOf(b)),
        ),
      );
      setErrors(problems);
      setMore(hasMore);
      setLoading(false);
      if (requested) {
        requested = false;
        void readCounts();
      } else if (resource) {
        timer = setTimeout(poll, RESOURCE_REFRESH_MS);
      }
    }
    function poll() {
      if (visible()) void readCounts();
      else if (current) timer = setTimeout(poll, RESOURCE_REFRESH_MS);
    }
    function onFocus() {
      if (visible()) refreshResources.current();
    }
    timer = setTimeout(
      async () => {
        setLoading(true);
        if (!resource) await listHistory();
        if (!current) return;
        refreshResources.current = () => {
          void readCounts();
        };
        if (resource) {
          document.addEventListener("visibilitychange", onFocus);
          window.addEventListener("focus", onFocus);
        }
        await readCounts();
      },
      needle ? 150 : 0,
    );
    return () => {
      current = false;
      refreshResources.current = () => {};
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [sources, resource, project, needle, pages, refresh]);
  const countLabel = kind === "terminal" ? S.dock.openTerminals : S.dock.openBrowserPages;
  const resourceLabels = {
    terminal: {
      search: S.dock.searchActiveSessions,
      empty: S.dock.noOpenTerminals,
      start: S.dock.startSessionTerminal,
    },
    "builtin-browser": {
      search: S.dock.searchBrowserSessions,
      empty: S.dock.noOpenBrowserPages,
      start: S.dock.startSessionBrowser,
    },
  };
  const labels = resource ? resourceLabels[resource] : undefined;
  const searchLabel = labels?.search ?? S.dock.searchSessions;
  const chosen = rows.filter((row) => selected.includes(idOf(row)) && (row.count ?? 0) > 0);
  function open(row: Row) {
    workspace?.openBesideSession(
      row.session.sessionId,
      sessionWorkbenchPage(
        kind,
        { projectId: project, machineId: row.machineId, sessionId: row.session.sessionId },
        title,
      ),
      { projectId: project, machineId: row.machineId, session: row.session },
    );
  }
  async function close() {
    if (!resource || !confirm || busy) return;
    setBusy(true);
    const failures: string[] = [];
    let closedCount = 0;
    const unresolved: string[] = [];
    const groups = Map.groupBy(confirm, (r) => r.machineId);
    await Promise.all(
      [...groups].map(async ([machine, batch]) => {
        try {
          const { results } = await closeSessionResources(
            resource,
            project,
            machine,
            batch.map((r) => r.session.sessionId),
          );
          for (const row of batch) {
            const outcome = results.find((r) => r.sessionId === row.session.sessionId);
            closedCount += outcome?.closed ?? 0;
            if (!outcome || outcome.error) {
              unresolved.push(idOf(row));
              failures.push(
                row.host +
                  " (" +
                  row.session.sessionId +
                  "): " +
                  (outcome?.error ?? S.dock.toolUnavailable),
              );
            }
          }
        } catch (e) {
          for (const row of batch) unresolved.push(idOf(row));
          failures.push(batch[0]!.host + ": " + messageOf(e));
        }
      }),
    );
    setClosed(closedCount);
    setResult(failures);
    setSelected(unresolved);
    setConfirm(null);
    setBusy(false);
    refreshResources.current();
  }
  return (
    <section
      ref={directory}
      aria-label={title}
      className="@container mx-auto flex h-full w-full min-w-0 max-w-3xl flex-col gap-3 overflow-y-auto p-3 @sm:p-4"
    >
      <h1 className="text-lg font-semibold">{title}</h1>
      <SearchInput
        icon
        value={query}
        placeholder={searchLabel}
        aria-label={searchLabel}
        onChange={(value) => {
          setQuery(value);
          if (value.trim() === needle) return;
          setLoading(true);
          setRows([]);
          setPages(1);
          setSelected([]);
          setResult([]);
          setClosed(null);
        }}
      />
      {resource && chosen.length > 0 && (
        <Button variant="danger" onClick={() => setConfirm(chosen)}>
          {S.dock.closeSelected} ({chosen.length})
        </Button>
      )}
      {lists
        .filter((l) => !l.live)
        .map((l) => (
          <p key={l.machine.machineId} role="status">
            {l.machine.label} ({S.dock.unavailableMachine})
          </p>
        ))}
      {closed !== null && <p role="status">{S.dock.closedResources(closed)}</p>}
      {[...errors, ...result].map((msg, index) => (
        <p role="alert" key={index}>
          {msg}
        </p>
      ))}
      {errors.length > 0 && (
        <Button onClick={() => setRefresh((n) => n + 1)}>{S.common.retry}</Button>
      )}
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const { session, count } = row;
          const name = session.title || session.sessionId;
          return (
            <li key={idOf(row)} className="flex min-w-0 items-center gap-2">
              {resource && (
                <Checkbox
                  aria-label={S.dock.selectSession(name, row.host)}
                  disabled={!count || busy}
                  checked={selected.includes(idOf(row))}
                  onChange={(checked) =>
                    setSelected((previous) =>
                      checked
                        ? [...previous, idOf(row)]
                        : previous.filter((id) => id !== idOf(row)),
                    )
                  }
                />
              )}
              <button
                type="button"
                className="flex min-h-12 min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 rounded-md px-2 py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus @sm:flex-row @sm:items-center @sm:gap-4"
                onClick={() => open(row)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium wrap-anywhere">{name}</span>
                  <span className="flex flex-wrap gap-x-2 text-xs text-fg-muted wrap-anywhere">
                    {[
                      row.host,
                      session.agentId,
                      session.archived ? S.dock.archivedSession : null,
                      session.source === "subagent" ? S.dock.childSession : null,
                      session.source === "subagent" && session.title ? session.sessionId : null,
                    ]
                      .filter((label): label is string => Boolean(label))
                      .map((label, index) => (
                        <span key={index}>{label}</span>
                      ))}
                  </span>
                  {kind === "workspace" && session.workspace && (
                    <span
                      dir="auto"
                      className="block font-mono text-xs text-fg-muted wrap-anywhere"
                    >
                      {session.workspace}
                    </span>
                  )}
                </span>
                {resource && (
                  <Badge tone={count ? "info" : "neutral"} size="sm">
                    {count === null ? S.dock.unavailableMachine : countLabel(count)}
                  </Badge>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {loading && <p role="status">{S.common.loading}</p>}
      {!loading && !rows.length && !errors.length && (
        <EmptyState
          dashed
          title={!needle && labels ? labels.empty : S.dock.emptySessions}
          description={needle ? undefined : labels?.start}
        />
      )}
      {more && (
        <Button disabled={loading} onClick={() => setPages((n) => n + 1)}>
          {S.dock.moreSessions}
        </Button>
      )}
      <ConfirmModal
        open={confirm !== null}
        title={S.dock.closeSelected}
        confirmLabel={S.common.close}
        cancelLabel={S.common.cancel}
        tone="danger"
        busy={busy}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        onConfirm={() => void close()}
      >
        <p>{kind === "terminal" ? S.dock.terminalImpact : S.dock.browserImpact}</p>
        <ul>
          {confirm?.map((r) => (
            <li key={idOf(r)}>
              {r.session.title || r.session.sessionId} ({r.host}) {countLabel(r.count ?? 0)}
            </li>
          ))}
        </ul>
      </ConfirmModal>
    </section>
  );
}
