import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRecord,
  ActivityRun,
  ActivityRunSummary,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneSurface, toneStrip, type Tone } from "../../lib/tone";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";

const basePath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/activities`;
const pretty = (spec: ActivityDraft["spec"]) => (spec ? JSON.stringify(spec, null, 2) : "");
const runTone: Record<ActivityRun["status"], Tone> = {
  running: "busy",
  succeeded: "success",
  failed: "danger",
  conflict: "attention",
  cancelled: "muted",
  interrupted: "attention",
};

export function ActivitiesPage() {
  useLocale();
  useDocumentTitle(S.activities.title);
  const { currentProject } = useProject();
  if (!currentProject) return <p className="p-6 text-sm text-gray-500">{S.activities.noProject}</p>;
  return (
    <ActivityWorkspace
      key={currentProject.projectId}
      projectId={currentProject.projectId}
      editable={currentProject.role === "owner"}
    />
  );
}

function ActivityWorkspace({ projectId, editable }: { projectId: string; editable: boolean }) {
  const { registerProjectChangeGuard } = useProject();
  const { activityId } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<ActivityRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [productCode, setProductCode] = useState("");
  const [refNum, setRefNum] = useState("");
  const [title, setTitle] = useState("");
  const [activityType, setActivityType] = useState("standard");
  const dirty = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    try {
      const result = await apiFetch<{ activities: ActivityRecord[] }>(basePath(projectId));
      if (mounted.current) {
        setItems(result.activities);
        setError("");
      }
    } catch (e) {
      if (mounted.current) setError(apiErrorText(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const canLeave = useCallback(() => !dirty.current || window.confirm(S.activities.discard), []);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && !canLeave(),
  );
  useEffect(() => {
    if (blocker.state === "blocked") blocker.reset();
  }, [blocker]);
  useLayoutEffect(
    () => registerProjectChangeGuard(canLeave),
    [registerProjectChangeGuard, canLeave],
  );
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!canLeave()) return;
    setCreating(true);
    setError("");
    try {
      const result = await apiFetch<ActivityDetail>(basePath(projectId), {
        method: "POST",
        body: { productCode, refNum: Number(refNum), title, activityType },
      });
      if (!mounted.current) return;
      setProductCode("");
      setRefNum("");
      setTitle("");
      await reload();
      dirty.current = false;
      navigate(`/activities/${result.id}`);
    } catch (e) {
      if (mounted.current) setError(apiErrorText(e));
    } finally {
      if (mounted.current) setCreating(false);
    }
  }
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{S.activities.title}</h1>
          <Button size="sm" onClick={() => void reload()}>
            {S.activities.refresh}
          </Button>
        </header>
        {!editable && (
          <p className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {S.activities.readOnly}
          </p>
        )}
        {error && (
          <p role="alert" className={`text-sm ${toneInk.danger}`}>
            {error}
          </p>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="space-y-5">
            {editable && (
              <form
                onSubmit={(event) => void create(event)}
                className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
              >
                <h2 className="text-sm font-semibold">{S.activities.create}</h2>
                <Input
                  size="sm"
                  label={S.activities.productCode}
                  value={productCode}
                  onChange={(e) => setProductCode(e.target.value)}
                  required
                  maxLength={100}
                  disabled={creating}
                />
                <Input
                  size="sm"
                  label={S.activities.refNum}
                  type="number"
                  min={0}
                  step={1}
                  value={refNum}
                  onChange={(e) => setRefNum(e.target.value)}
                  required
                  disabled={creating}
                />
                <Input
                  size="sm"
                  label={S.activities.name}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={200}
                  disabled={creating}
                />
                <Select
                  size="sm"
                  label={S.activities.type}
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value)}
                  disabled={creating}
                >
                  <option value="standard">{S.activities.standard}</option>
                  <option value="book">{S.activities.book}</option>
                </Select>
                <Button type="submit" size="sm" variant="primary" disabled={creating}>
                  {creating ? S.activities.busy : S.activities.create}
                </Button>
              </form>
            )}
            <nav aria-label={S.activities.title} className="space-y-1">
              {loading ? (
                <p role="status" className="text-xs text-gray-500">
                  {S.activities.loading}
                </p>
              ) : items.length === 0 ? (
                <p className="text-xs text-gray-500">{S.activities.empty}</p>
              ) : (
                items.map((item) => (
                  <Link
                    key={item.id}
                    to={`/activities/${item.id}`}
                    aria-current={item.id === activityId ? "page" : undefined}
                    className={`block rounded-md border p-3 text-sm ${item.id === activityId ? "border-gray-400 bg-gray-100 dark:border-gray-600 dark:bg-gray-800" : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-900"}`}
                  >
                    <span className="block break-words font-medium">
                      {item.productCode} / {item.refNum}
                    </span>
                    <span className="block break-words text-xs text-gray-500">{item.title}</span>
                  </Link>
                ))
              )}
            </nav>
          </aside>
          {activityId ? (
            <ActivityEditor
              key={activityId}
              projectId={projectId}
              activityId={activityId}
              editable={editable}
              onDirty={(value) => {
                dirty.current = value;
              }}
              onSaved={reload}
            />
          ) : (
            <p className="py-8 text-sm text-gray-500">{S.activities.select}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityEditor({
  projectId,
  activityId,
  editable,
  onDirty,
  onSaved,
}: {
  projectId: string;
  activityId: string;
  editable: boolean;
  onDirty: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const { agents, currentAgent } = useProject();
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [description, setDescription] = useState("");
  const [spec, setSpec] = useState("");
  const [runs, setRuns] = useState<ActivityRunSummary[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [agentId, setAgentId] = useState("");
  const state = useRef({ dirty: false, busy: false, revision: "" });
  const alive = useRef(true);
  const endpoint = `${basePath(projectId)}/${encodeURIComponent(activityId)}`;
  const dirty =
    detail !== null &&
    (description !== detail.draft.description || spec !== pretty(detail.draft.spec));
  state.current = { dirty, busy, revision: detail?.draft.contentRevision ?? "" };
  useLayoutEffect(() => {
    onDirty(dirty);
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onDirty(false);
    };
  }, []); // The editor is keyed by activity and the workspace by project.
  function accept(value: ActivityDetail) {
    setDetail(value);
    setDescription(value.draft.description);
    setSpec(pretty(value.draft.spec));
    setChanged(false);
  }
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const revisionAtStart = state.current.revision;
      let active = false;
      try {
        const [value, history] = await Promise.all([
          apiFetch<ActivityDetail>(endpoint),
          apiFetch<{ runs: ActivityRunSummary[] }>(`${endpoint}/runs`),
        ]);
        if (cancelled) return;
        setRuns(history.runs);
        active = history.runs.some((run) => run.status === "running");
        if (!state.current.busy && state.current.revision === revisionAtStart) {
          if (!state.current.dirty) accept(value);
          else if (value.draft.contentRevision !== state.current.revision) setChanged(true);
        }
      } catch (e) {
        if (!cancelled) setError(apiErrorText(e));
      } finally {
        if (!cancelled) timer = setTimeout(() => void refresh(), active ? 2000 : 30_000);
      }
    }
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [endpoint, refreshVersion]);
  async function action(operation: () => Promise<void>) {
    if (state.current.busy) return;
    state.current.busy = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      if (alive.current) setError(apiErrorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function save(kind: "description" | "spec") {
    if (!detail) return;
    await action(async () => {
      const draft = await apiFetch<ActivityDraft>(
        `${endpoint}/${kind === "description" ? "description" : "apply-generated-spec"}`,
        {
          method: kind === "description" ? "PATCH" : "POST",
          body: {
            expectedRevision: detail.draft.contentRevision,
            ...(kind === "description" ? { description } : { spec: JSON.parse(spec) }),
          },
        },
      );
      if (!alive.current) return;
      setDetail({
        ...detail,
        title: draft.status === "valid" ? String(draft.spec?.title) : detail.title,
        draft,
      });
      if (kind === "spec") setSpec(pretty(draft.spec));
      setNotice(S.activities.saved);
      await onSaved();
    });
  }
  const selectedAgent = agentId || currentAgent?.agentId || agents[0]?.agentId || "";
  const running = runs.some((run) => run.status === "running");
  if (!detail)
    return (
      <p
        role={error ? "alert" : "status"}
        className={`text-sm ${error ? toneInk.danger : "text-gray-500"}`}
      >
        {error || S.activities.loading}
      </p>
    );
  return (
    <section className="min-w-0 space-y-5">
      <header className="space-y-1">
        <h2 className="break-words text-lg font-semibold">{detail.title}</h2>
        <p className="break-all text-xs text-gray-500">
          {detail.productCode} / {detail.refNum} · {S.activities.collection}: {detail.collectionId}
        </p>
        <p aria-live="polite" className={`text-xs ${dirty ? toneInk.attention : toneInk.muted}`}>
          {dirty ? S.activities.unsaved : S.activities.draftStatus[detail.draft.status]}
        </p>
      </header>
      {error && (
        <p role="alert" className={`rounded-md border p-3 text-xs ${toneStrip.danger}`}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={`text-xs ${toneInk.success}`}>
          {notice}
        </p>
      )}
      {changed && (
        <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
          {S.activities.remoteChanged}
        </p>
      )}
      <div className="space-y-2">
        <Textarea
          size="sm"
          label={S.activities.description}
          rows={7}
          value={description}
          maxLength={100_000}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!editable || busy}
        />
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button
              size="sm"
              onClick={() => void save("description")}
              disabled={busy || description === detail.draft.description}
            >
              {S.activities.saveDescription}
            </Button>
          )}
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm(S.activities.discard))
                void action(async () => {
                  const value = await apiFetch<ActivityDetail>(endpoint);
                  if (alive.current) accept(value);
                });
            }}
          >
            {S.activities.reload}
          </Button>
        </div>
      </div>
      {editable && (
        <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <Select
            size="sm"
            label={S.activities.agent}
            value={selectedAgent}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={busy || running}
          >
            {agents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.name ?? agent.agentId}
              </option>
            ))}
          </Select>
          {dirty && <p className={`text-xs ${toneInk.attention}`}>{S.activities.saveFirst}</p>}
          <Button
            size="sm"
            variant="primary"
            disabled={busy || running || dirty || !selectedAgent || !description.trim()}
            onClick={() =>
              void action(async () => {
                const run = await apiFetch<ActivityRun>(`${endpoint}/generate-spec`, {
                  method: "POST",
                  body: { agentId: selectedAgent, expectedRevision: detail.draft.contentRevision },
                });
                if (alive.current) {
                  setRuns((previous) => [
                    summarize(run),
                    ...previous.filter((item) => item.runId !== run.runId),
                  ]);
                  setRefreshVersion((value) => value + 1);
                }
              })
            }
          >
            {S.activities.generate}
          </Button>
        </div>
      )}
      <div className="space-y-2">
        <Textarea
          size="sm"
          label={S.activities.spec}
          rows={15}
          className="font-mono"
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          disabled={!editable || busy}
          spellCheck={false}
        />
        {editable && (
          <Button
            size="sm"
            disabled={busy || !spec.trim() || spec === pretty(detail.draft.spec)}
            onClick={() => void save("spec")}
          >
            {S.activities.saveSpec}
          </Button>
        )}
      </div>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{S.activities.runs}</h3>
        {runs.length === 0 && <p className="text-xs text-gray-500">{S.activities.noRuns}</p>}
        {runs.map((run) => (
          <article
            key={run.runId}
            className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs ${toneSurface[runTone[run.status]]}`}>
                {S.activities.status[run.status]}
              </span>
              <time className="text-xs text-gray-500" dateTime={run.createdAt}>
                {new Date(run.createdAt).toLocaleString()}
              </time>
            </div>
            {run.error && <p className="break-words text-xs">{run.error}</p>}
            {run.status === "running" && (
              <p className="text-xs text-gray-500">{S.activities.runningHelp}</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {run.sessionId && (
                <Link
                  className="text-xs underline"
                  to={`/chat/${encodeURIComponent(run.sessionId)}`}
                >
                  {S.activities.openSession}
                </Link>
              )}
              {editable && run.status === "running" && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const result = await apiFetch<ActivityRun>(
                        `${endpoint}/runs/${run.runId}/cancel`,
                        { method: "POST", body: {} },
                      );
                      if (alive.current)
                        setRuns((previous) =>
                          previous.map((item) =>
                            item.runId === result.runId ? summarize(result) : item,
                          ),
                        );
                    })
                  }
                >
                  {S.activities.cancel}
                </Button>
              )}
            </div>
            {run.hasCandidate && (
              <CandidateReview
                endpoint={`${endpoint}/runs/${encodeURIComponent(run.runId)}/candidate`}
                editable={editable}
                busy={busy}
                onUse={(candidate) => {
                  if (!dirty || window.confirm(S.activities.discard)) setSpec(candidate);
                }}
              />
            )}
          </article>
        ))}
      </section>
    </section>
  );
}

function summarize({ candidate, ...run }: ActivityRun): ActivityRunSummary {
  return { ...run, hasCandidate: candidate !== null };
}

function CandidateReview({
  endpoint,
  editable,
  busy,
  onUse,
}: {
  endpoint: string;
  editable: boolean;
  busy: boolean;
  onUse: (candidate: string) => void;
}) {
  const [candidate, setCandidate] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function load() {
    if (pending.current || candidate !== null) return;
    pending.current = true;
    setError("");
    try {
      const result = await apiFetch<{ candidate: string | null }>(endpoint);
      if (alive.current) setCandidate(result.candidate ?? "");
    } catch (e) {
      if (alive.current) setError(apiErrorText(e));
    } finally {
      pending.current = false;
    }
  }
  return (
    <details
      className="text-xs"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary className="cursor-pointer">{S.activities.candidate}</summary>
      {error ? (
        <div className="my-2 space-y-2">
          <p role="alert" className={toneInk.danger}>
            {error}
          </p>
          <Button size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        </div>
      ) : (
        <pre className="my-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 dark:bg-gray-900">
          {candidate ?? S.activities.loading}
        </pre>
      )}
      {editable && (
        <Button size="sm" disabled={busy || candidate === null} onClick={() => onUse(candidate!)}>
          {S.activities.useCandidate}
        </Button>
      )}
    </details>
  );
}
