import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { Button, Checkbox, ConfirmModal, Input } from "@prismshadow/penguin-ui";
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
type Row = { session: SessionInfo; machineId: string | null; host: string; count: number | null };
const idOf = (row: Row) => JSON.stringify([row.machineId, row.session.sessionId]);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SessionWorkbenchPage() {
  const { kind } = useParams();
  const { currentProject } = useProject();
  const definition = useSessionWorkbenchPanels().find((p) => p.id === kind);
  const location = useLocation();
  if (!kind || !isSessionWorkbenchKind(kind) || !definition || !currentProject) {
    return (
      <p role="status" className="p-4">
        {S.dock.toolUnavailable}
      </p>
    );
  }
  const address = parseSessionWorkbenchPage({ path: location.pathname + location.search })?.address;
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
  const resource = kind === "terminal" || kind === "builtin-browser" ? kind : null;
  useEffect(() => {
    let current = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        const positions = new Map<string | null, string>([[null, S.dock.here]]);
        for (const s of sources)
          if (s.on) positions.set(s.on.machine.machineId, s.on.machine.label);
        const output = new Map<string, Row>();
        const problems: string[] = [];
        let hasMore = false;
        async function loadHost(machineId: string | null, host: string) {
          let counts: Record<string, number> | null = null;
          if (resource)
            try {
              counts = await listSessionResourceCounts(resource, project, machineId);
            } catch (e) {
              problems.push(host + ": " + messageOf(e));
            }
          if (!current) return;
          const localAgents = sources.filter(
            (s) => (s.on?.machine.machineId ?? null) === machineId,
          );
          const visibleAgents = new Set(localAgents.map((s) => s.agent.agentId));
          function add(session: SessionInfo) {
            if (session.projectId !== project || !visibleAgents.has(session.agentId)) return;
            const row = {
              session,
              machineId,
              host,
              count: counts === null ? null : (counts[session.sessionId] ?? 0),
            };
            output.set(idOf(row), row);
          }
          await Promise.all(
            localAgents.map(async ({ agent }) => {
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
                  page.forEach(add);
                  const last = page.at(-1);
                  if (!last || sessions.length <= PAGE_SIZE) break;
                  before = { lastActiveAt: last.lastActiveAt, sessionId: last.sessionId };
                  if (index === pages - 1) hasMore = true;
                }
              } catch (e) {
                problems.push(host + " (" + agent.agentId + "): " + messageOf(e));
              }
            }),
          );
          if (!current || !counts) return;
          // The resource index covers the whole authorized Project, including archived children
          // below the ordinary Session page. Resolve the leading active IDs in bounded batches.
          const leaders = Object.entries(counts)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
          const limit = pages * PAGE_SIZE;
          if (leaders.length > limit) hasMore = true;
          const absent = leaders
            .slice(0, limit)
            .filter(([sid]) => !output.has(JSON.stringify([machineId, sid])));
          for (let start = 0; current && start < absent.length; start += 6) {
            await Promise.all(
              absent.slice(start, start + 6).map(async ([sid]) => {
                try {
                  const { session } = await getSession(sid, machineId);
                  const query = needle.toLowerCase();
                  if (
                    !query ||
                    [session.title, session.sessionId, session.workspace, session.agentId].some(
                      (value) => value?.toLowerCase().includes(query),
                    )
                  )
                    add(session);
                } catch (e) {
                  problems.push(host + ": " + messageOf(e));
                }
              }),
            );
          }
        }
        void Promise.all([...positions].map(([id, host]) => loadHost(id, host))).then(() => {
          if (!current) return;
          setRows(
            [...output.values()].sort(
              (a, b) =>
                (b.count ?? 0) - (a.count ?? 0) ||
                b.session.lastActiveAt.localeCompare(a.session.lastActiveAt) ||
                idOf(a).localeCompare(idOf(b)),
            ),
          );
          setErrors(problems);
          setMore(hasMore);
          setLoading(false);
        });
      },
      needle ? 150 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [sources, resource, project, needle, pages, refresh]);
  const countLabel = kind === "terminal" ? S.dock.openTerminals : S.dock.openBrowserPages;
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
    setRefresh((i) => i + 1);
  }
  return (
    <section
      aria-label={title}
      className="mx-auto flex h-full w-full max-w-3xl flex-col gap-3 overflow-y-auto p-4"
    >
      <h1 className="text-lg font-semibold">{title}</h1>
      <label className="flex flex-col gap-1">
        {S.dock.chooseSession}
        <Input
          value={query}
          placeholder={S.dock.searchSessions}
          aria-label={S.dock.searchSessions}
          onChange={(e) => {
            setQuery(e.target.value);
            setRows([]);
            setPages(1);
            setSelected([]);
            setResult([]);
            setClosed(null);
          }}
        />
      </label>
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
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const { session, count } = row;
          const name = session.title || session.sessionId;
          return (
            <li key={idOf(row)} className="flex min-w-0 items-center gap-3 py-2">
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
                className="min-w-0 flex-1 cursor-pointer break-words text-left"
                onClick={() => open(row)}
              >
                <span className="block font-medium">{name}</span>
                <span className="flex flex-wrap gap-x-2 text-sm text-fg-muted">
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
                {resource && (
                  <span className="text-sm">
                    {count === null ? S.dock.unavailableMachine : countLabel(count)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {loading && <p role="status">{S.common.loading}</p>}
      {!loading && !rows.length && !errors.length && <p>{S.dock.emptySessions}</p>}
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
