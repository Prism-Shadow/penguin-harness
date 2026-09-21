import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRecord,
  ActivityRun,
  ActivityRunSummary,
  AssetManifest,
  UploadedMedia,
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
import { InfoPopover } from "../../components/ui/info-popover";
import { CreateActivityDialog } from "./create-activity-dialog";
import { MediaWorkbench } from "./media-workbench";
import { ModulePreview } from "./module-preview";
import { SceneReview } from "./scene-review";
import { activityInitials, filterActivities, latestModuleRun } from "./preview";

const basePath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/activities`;
const pretty = (value: unknown) => (value ? JSON.stringify(value, null, 2) : "");
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
  const { currentProject, unavailableProjectId } = useProject();
  const previousProject = useRef(currentProject);
  if (currentProject) previousProject.current = currentProject;
  const project =
    currentProject ??
    (previousProject.current?.projectId === unavailableProjectId ? previousProject.current : null);
  if (!project) return <p className="p-6 text-sm text-gray-500">{S.activities.noProject}</p>;
  return (
    <ActivityWorkspace
      key={project.projectId}
      projectId={project.projectId}
      available={currentProject !== null}
      editable={currentProject?.role === "owner"}
    />
  );
}

function ActivityWorkspace({
  projectId,
  editable,
  available,
}: {
  projectId: string;
  editable: boolean;
  available: boolean;
}) {
  const { registerProjectChangeGuard } = useProject();
  const { activityId } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<ActivityRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const dirty = useRef(false);
  const mounted = useRef(true);
  const accessible = useRef(available);
  accessible.current = available;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    if (!accessible.current) return;
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
  const visible = useMemo(() => filterActivities(items, search), [items, search]);
  if (activityId) {
    return (
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
          <nav className="text-xs">
            <Link className="underline" to="/activities">
              {S.activities.backToActivities}
            </Link>
          </nav>
          {/* The editor disables itself for a member or a lost Project; say why, as the list does. */}
          {!available && (
            <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
              {S.activities.unavailable}
            </p>
          )}
          {available && !editable && (
            <p className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
              {S.activities.readOnly}
            </p>
          )}
          <ActivityEditor
            key={activityId}
            projectId={projectId}
            activityId={activityId}
            editable={editable}
            available={available}
            onDirty={(value) => {
              dirty.current = value;
            }}
            onSaved={reload}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{S.activities.title}</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!available} onClick={() => void reload()}>
              {S.activities.refresh}
            </Button>
            {editable && (
              <Button
                size="sm"
                variant="primary"
                disabled={!available || !canLeave()}
                onClick={() => setCreateOpen(true)}
              >
                {S.activities.newActivity}
              </Button>
            )}
          </div>
        </header>
        {!available && (
          <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {S.activities.unavailable}
          </p>
        )}
        {available && !editable && (
          <p className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {S.activities.readOnly}
          </p>
        )}
        {error && (
          <p role="alert" className={`text-sm ${toneInk.danger}`}>
            {error}
          </p>
        )}
        {items.length > 0 && (
          <Input
            size="sm"
            aria-label={S.activities.search}
            placeholder={S.activities.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-sm"
          />
        )}
        {loading ? (
          <p role="status" className="text-xs text-gray-500">
            {S.activities.loading}
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-500">
            {items.length === 0 ? S.activities.empty : S.activities.noMatches}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/activities/${item.id}`}
                  className="flex h-full flex-col gap-2 rounded-lg border border-gray-200 p-4 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                    >
                      {activityInitials(item.title, item.productCode)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-gray-500">
                        {item.productCode} / {item.refNum}
                      </span>
                    </span>
                  </span>
                  <span className="mt-auto flex flex-wrap gap-1.5">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
                      {item.activityType === "book" ? S.activities.book : S.activities.standard}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {createOpen && (
        <CreateActivityDialog
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false);
            dirty.current = false;
            navigate(`/activities/${created}`);
          }}
        />
      )}
    </div>
  );
}

function ActivityEditor({
  projectId,
  activityId,
  editable,
  available,
  onDirty,
  onSaved,
}: {
  projectId: string;
  activityId: string;
  editable: boolean;
  available: boolean;
  onDirty: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const { agents, currentAgent } = useProject();
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [description, setDescription] = useState("");
  const [spec, setSpec] = useState("");
  const [specOpen, setSpecOpen] = useState(false);
  const [media, setMedia] = useState("");
  const [runs, setRuns] = useState<ActivityRunSummary[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [bookMode, setBookMode] = useState<"" | "readAlong" | "decodable">("");
  const [wafRoot, setWafRoot] = useState("");
  const [voices, setVoices] = useState<string[]>([]);
  const [uploads, setUploads] = useState<UploadedMedia[]>([]);
  /**
   * Narration still to ask for. The server runs one generation per activity at a time,
   * so a bulk request is a queue this page drains as each run finishes rather than a
   * burst of requests the server would reject. It lives in the page, so leaving the
   * page stops the queue; the runs already started carry on.
   */
  const [speechQueue, setSpeechQueue] = useState<{
    language: string;
    voice: string;
    keys: string[];
  } | null>(null);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const state = useRef({ dirty: false, busy: false, revision: "", available });
  const alive = useRef(true);
  const endpoint = `${basePath(projectId)}/${encodeURIComponent(activityId)}`;
  const loadUploads = useCallback(async () => {
    setUploadsLoading(true);
    try {
      const value = await apiFetch<{ media: UploadedMedia[] }>(`${endpoint}/media-uploads`);
      if (alive.current) setUploads(value.media);
    } catch (e) {
      if (alive.current) setError(apiErrorText(e));
    } finally {
      if (alive.current) setUploadsLoading(false);
    }
  }, [endpoint]);
  /** Read the file the author chose, store it, and hand back its binding reference. */
  const upload = useCallback(
    async (file: File) => {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < buffer.length; index += 0x8000)
        binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
      const stored = await apiFetch<UploadedMedia>(`${endpoint}/media-uploads`, {
        method: "POST",
        body: { name: file.name, dataBase64: btoa(binary) },
      });
      await loadUploads();
      return stored;
    },
    [endpoint, loadUploads],
  );
  useEffect(() => {
    if (!available || !editable) return;
    let cancelled = false;
    void apiFetch<{ voices: string[] }>(`${basePath(projectId)}/speech-setup`)
      .then((value) => {
        if (!cancelled) setVoices(value.voices);
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    void loadUploads();
    void apiFetch<{ wafRoot: string | null }>(`${basePath(projectId)}/module-setup`)
      .then((value) => {
        if (!cancelled) setWafRoot(value.wafRoot ?? "");
      })
      .catch(() => {
        /* An explicit path can still be supplied when discovery fails. */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, available, editable]);
  const dirty =
    detail !== null &&
    (description !== detail.draft.description ||
      spec !== pretty(detail.draft.spec) ||
      media !== pretty(detail.draft.mediaPlan?.manifest));
  state.current = { dirty, busy, revision: detail?.draft.contentRevision ?? "", available };
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
    setMedia(pretty(value.draft.mediaPlan?.manifest));
    setChanged(false);
  }
  useEffect(() => {
    if (!available) return;
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
        setLoadError("");
        setRuns(history.runs);
        active = history.runs.some((run) => run.status === "running");
        if (!state.current.busy && state.current.revision === revisionAtStart) {
          if (!state.current.dirty) accept(value);
          else if (value.draft.contentRevision !== state.current.revision) setChanged(true);
        }
      } catch (e) {
        if (!cancelled) setLoadError(apiErrorText(e));
      } finally {
        if (!cancelled) timer = setTimeout(() => void refresh(), active ? 2000 : 30_000);
      }
    }
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [endpoint, refreshVersion, available]);
  async function action(operation: () => Promise<void>) {
    if (state.current.busy || !state.current.available) return;
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
  async function save(kind: "description" | "spec" | "media") {
    if (!detail) return;
    await action(async () => {
      const draft = await apiFetch<ActivityDraft>(
        `${endpoint}/${kind === "description" ? "description" : kind === "media" ? "media" : "apply-generated-spec"}`,
        {
          method: kind === "description" ? "PATCH" : kind === "media" ? "PUT" : "POST",
          body: {
            expectedRevision: detail.draft.contentRevision,
            ...(kind === "description"
              ? { description }
              : kind === "media"
                ? { manifest: JSON.parse(media) }
                : { spec: JSON.parse(spec) }),
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
      if (kind === "media") setMedia(pretty(draft.mediaPlan?.manifest));
      setNotice(S.activities.saved);
      await onSaved();
    });
  }
  const selectedAgent = agentId || currentAgent?.agentId || agents[0]?.agentId || "";
  const running = runs.some((run) => run.status === "running");
  useEffect(() => {
    const next = speechQueue?.keys[0];
    if (!next || running || busy || dirty || !selectedAgent || !detail) return;
    let cancelled = false;
    void (async () => {
      try {
        const run = await apiFetch<ActivityRun>(`${endpoint}/generate-audio`, {
          method: "POST",
          body: {
            agentId: selectedAgent,
            expectedRevision: detail.draft.contentRevision,
            language: speechQueue!.language,
            assetKey: next,
            voice: speechQueue!.voice,
          },
        });
        if (cancelled || !alive.current) return;
        setRuns((previous) => [
          summarize(run),
          ...previous.filter((item) => item.runId !== run.runId),
        ]);
        setRefreshVersion((value) => value + 1);
        setSpeechQueue((queue) =>
          queue && queue.keys[0] === next
            ? queue.keys.length > 1
              ? { ...queue, keys: queue.keys.slice(1) }
              : null
            : queue,
        );
      } catch (e) {
        if (cancelled || !alive.current) return;
        // Stop the queue rather than let every remaining narration fail the same way.
        setSpeechQueue(null);
        setError(apiErrorText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [speechQueue, running, busy, dirty, selectedAgent, detail, endpoint]);
  let editedManifest: AssetManifest | null = null;
  try {
    const value = JSON.parse(media);
    // Structured controls require the saved shape; advanced edits are validated by the server.
    if (
      value &&
      typeof value.assets === "object" &&
      value.assets &&
      Object.values(value.assets).every(
        (items) =>
          Array.isArray(items) &&
          items.every(
            (item) =>
              item &&
              typeof item.key === "string" &&
              ["audio", "image", "video", "animation"].includes(item.type) &&
              typeof item.description === "string" &&
              Array.isArray(item.usages) &&
              item.usages.every(
                (usage: unknown) =>
                  usage &&
                  typeof usage === "object" &&
                  "sceneId" in usage &&
                  typeof usage.sceneId === "string",
              ) &&
              (item.script === undefined || typeof item.script === "string") &&
              (item.path === undefined || typeof item.path === "string") &&
              (item.generatedAudio === undefined ||
                (item.generatedAudio && typeof item.generatedAudio.runId === "string")) &&
              (item.generatedImage === undefined ||
                (item.generatedImage &&
                  typeof item.generatedImage.runId === "string" &&
                  typeof item.generatedImage.sha256 === "string")),
          ),
      )
    )
      editedManifest = value;
  } catch {
    /* Preserve invalid JSON for correction without replacing it with a saved manifest. */
  }
  if (!detail)
    return (
      <p
        role={error || loadError ? "alert" : "status"}
        className={`text-sm ${error || loadError ? toneInk.danger : "text-gray-500"}`}
      >
        {error || loadError || S.activities.loading}
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
      {loadError && available && (
        <p role="alert" className={`rounded-md border p-3 text-xs ${toneStrip.danger}`}>
          {loadError}
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
          disabled={available && (!editable || busy)}
          readOnly={!available}
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
            disabled={busy || !available}
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
          {detail.activityType === "book" && (
            <>
              <h3 className="flex items-center gap-2 text-xs font-semibold">
                {S.activities.readingMode}
                <InfoPopover label={S.activities.readingMode}>
                  <p>{S.activities.readingModeHelp}</p>
                </InfoPopover>
              </h3>
              <Select
                size="sm"
                aria-label={S.activities.readingMode}
                hint={S.activities.readingModeHint}
                value={bookMode}
                onChange={(e) => setBookMode(e.target.value as typeof bookMode)}
                disabled={busy || running}
              >
                <option value="">{S.activities.chooseReadingMode}</option>
                <option value="readAlong">{S.activities.readAlong}</option>
                <option value="decodable">{S.activities.decodable}</option>
              </Select>
            </>
          )}
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
          <Input
            size="sm"
            label={S.activities.wafRoot}
            value={wafRoot}
            onChange={(event) => setWafRoot(event.target.value)}
            disabled={busy || running}
            hint={S.activities.wafRootHint}
          />
          <Button
            size="sm"
            disabled={
              busy ||
              running ||
              dirty ||
              !selectedAgent ||
              detail.draft.status !== "valid" ||
              !detail.draft.spec ||
              (detail.activityType === "book" && (!bookMode || !detail.draft.mediaPlan))
            }
            onClick={() =>
              void action(async () => {
                const run = await apiFetch<ActivityRun>(`${endpoint}/assemble-module`, {
                  method: "POST",
                  body: {
                    agentId: selectedAgent,
                    expectedRevision: detail.draft.contentRevision,
                    wafRoot: wafRoot.trim() || undefined,
                    ...(detail.activityType === "book" ? { bookMode } : {}),
                  },
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
            {S.activities.assemble}
          </Button>
        </div>
      )}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{S.activities.sceneReview}</h3>
        <SceneReview spec={detail.draft.spec} />
      </section>
      <details
        className="space-y-2"
        open={specOpen}
        onToggle={(event) => setSpecOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-xs font-medium">
          {S.activities.advancedSpec}
        </summary>
        <Textarea
          size="sm"
          label={S.activities.spec}
          rows={15}
          className="font-mono"
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          disabled={available && (!editable || busy)}
          readOnly={!available}
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
      </details>
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {S.activities.mediaTitle}
          <InfoPopover label={S.activities.mediaTitle}>
            <p>{S.activities.mediaHelp}</p>
            <p>{S.activities.speechHelp}</p>
            <p>{S.activities.imageHelp}</p>
            <p>{S.activities.textHelp}</p>
          </InfoPopover>
        </h3>
        {editable && (
          <Button
            size="sm"
            disabled={
              busy || running || dirty || detail.draft.status !== "valid" || !detail.draft.spec
            }
            onClick={() =>
              void action(async () => {
                const draft = await apiFetch<ActivityDraft>(`${endpoint}/plan-media`, {
                  method: "POST",
                  body: { expectedRevision: detail.draft.contentRevision },
                });
                if (alive.current) {
                  accept({ ...detail, draft });
                  setNotice(S.activities.saved);
                }
              })
            }
          >
            {detail.draft.mediaPlan ? S.activities.rebuildMedia : S.activities.planMedia}
          </Button>
        )}
        {detail.draft.mediaPlan && (
          <>
            {editedManifest ? (
              <MediaWorkbench
                manifest={editedManifest}
                spec={detail.draft.spec}
                media={uploads}
                mediaLoading={uploadsLoading}
                onUpload={upload}
                runs={runs}
                endpoint={endpoint}
                editable={editable}
                disabled={busy || !available}
                canGenerate={
                  editable &&
                  available &&
                  detail.draft.status === "valid" &&
                  !busy &&
                  !running &&
                  !dirty &&
                  !!selectedAgent
                }
                revision={detail.draft.contentRevision}
                canAccept={editable && available && !busy && !running && !dirty}
                canPreview={editable && available && !busy && !dirty}
                wafRoot={wafRoot}
                voices={voices}
                onChange={(value) => setMedia(pretty(value))}
                onGenerateAudio={(language, assetKey, voice) =>
                  void action(async () => {
                    const run = await apiFetch<ActivityRun>(`${endpoint}/generate-audio`, {
                      method: "POST",
                      body: {
                        agentId: selectedAgent,
                        expectedRevision: detail.draft.contentRevision,
                        language,
                        assetKey,
                        voice,
                      },
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
                onGenerateAllAudio={(language, assetKeys, voice) =>
                  setSpeechQueue({ language, voice, keys: assetKeys })
                }
                speechQueue={speechQueue?.keys.length ?? 0}
                onCancelSpeechQueue={() => setSpeechQueue(null)}
                onGenerateImage={(language, assetKey) =>
                  void action(async () => {
                    const run = await apiFetch<ActivityRun>(`${endpoint}/generate-image`, {
                      method: "POST",
                      body: {
                        agentId: selectedAgent,
                        expectedRevision: detail.draft.contentRevision,
                        language,
                        assetKey,
                      },
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
                onGenerateText={(language, assetKey) =>
                  void action(async () => {
                    const run = await apiFetch<ActivityRun>(`${endpoint}/generate-media-text`, {
                      method: "POST",
                      body: {
                        agentId: selectedAgent,
                        expectedRevision: detail.draft.contentRevision,
                        language,
                        assetKey,
                      },
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
                onAcceptText={(runId) =>
                  void action(async () => {
                    const draft = await apiFetch<ActivityDraft>(
                      `${endpoint}/runs/${encodeURIComponent(runId)}/accept-media-text`,
                      {
                        method: "POST",
                        body: { expectedRevision: detail.draft.contentRevision },
                      },
                    );
                    if (alive.current) {
                      accept({ ...detail, draft });
                      setNotice(S.activities.saved);
                    }
                  })
                }
                onAcceptAudio={(runId) =>
                  void action(async () => {
                    const draft = await apiFetch<ActivityDraft>(
                      `${endpoint}/runs/${encodeURIComponent(runId)}/accept-audio`,
                      {
                        method: "POST",
                        body: { expectedRevision: detail.draft.contentRevision },
                      },
                    );
                    if (alive.current) {
                      accept({ ...detail, draft });
                      setNotice(S.activities.saved);
                    }
                  })
                }
                onAcceptImage={(runId) =>
                  void action(async () => {
                    const draft = await apiFetch<ActivityDraft>(
                      `${endpoint}/runs/${encodeURIComponent(runId)}/accept-image`,
                      {
                        method: "POST",
                        body: { expectedRevision: detail.draft.contentRevision },
                      },
                    );
                    if (alive.current) {
                      accept({ ...detail, draft });
                      setNotice(S.activities.saved);
                    }
                  })
                }
              />
            ) : (
              <p className={`text-xs ${toneInk.attention}`}>{S.activities.invalidMediaEditor}</p>
            )}
            <ul className="space-y-1 text-xs">
              {Object.entries(detail.draft.mediaPlan.manifest.assets).map(([language, assets]) => (
                <li key={language}>
                  {language}:{" "}
                  {S.activities.mediaCounts(
                    assets.length,
                    assets.filter((asset) => !!asset.path).length,
                  )}
                </li>
              ))}
            </ul>
            <details className="space-y-2">
              <summary className="cursor-pointer text-xs font-medium">
                {S.activities.advancedMedia}
              </summary>
              <Textarea
                size="sm"
                label={S.activities.mediaManifest}
                rows={12}
                className="font-mono"
                value={media}
                onChange={(event) => setMedia(event.target.value)}
                spellCheck={false}
                disabled={available && (!editable || busy)}
                readOnly={!available}
                hint={S.activities.mediaPathHint}
              />
            </details>
            {editable && (
              <Button
                size="sm"
                disabled={
                  busy || !media.trim() || media === pretty(detail.draft.mediaPlan.manifest)
                }
                onClick={() => void save("media")}
              >
                {S.activities.saveMedia}
              </Button>
            )}
          </>
        )}
      </section>
      {available && (
        <ModulePreview
          runs={runs}
          spec={detail.draft.spec}
          languages={Object.keys(detail.draft.mediaPlan?.manifest.assets ?? {})}
          stale={(() => {
            const moduleRun = latestModuleRun(runs);
            return Boolean(moduleRun && moduleRun.inputRevision !== detail.draft.contentRevision);
          })()}
        />
      )}
      {available && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{S.activities.runs}</h3>
          {runs.length === 0 && <p className="text-xs text-gray-500">{S.activities.noRuns}</p>}
          {runs.map((run) => (
            <article
              key={run.runId}
              className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs">
                  {run.kind === "module"
                    ? S.activities.moduleRun
                    : run.kind === "audio"
                      ? S.activities.audioRun
                      : run.kind === "image"
                        ? S.activities.imageRun
                        : run.kind === "media-text"
                          ? S.activities.textRun
                          : S.activities.specRun}
                </span>
                <span className={`rounded px-2 py-0.5 text-xs ${toneSurface[runTone[run.status]]}`}>
                  {run.kind === "module" && run.status === "succeeded"
                    ? S.activities.moduleReady
                    : run.kind === "audio" || run.kind === "image" || run.kind === "media-text"
                      ? S.activities.speechStatus[run.status]
                      : S.activities.status[run.status]}
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
                {run.kind === "module" && run.status === "succeeded" && run.sessionId && (
                  <a
                    className="text-xs underline"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`/api/sessions/${encodeURIComponent(run.sessionId)}/files/preview-redirect?path=preview%2Findex.html`}
                  >
                    {S.activities.previewModule}
                  </a>
                )}
                {run.kind === "module" && run.inputRevision !== detail.draft.contentRevision && (
                  <span className={`text-xs ${toneInk.attention}`}>{S.activities.olderModule}</span>
                )}
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
                  editable={editable && run.kind === "spec"}
                  busy={busy}
                  onUse={(candidate) => {
                    if (!dirty || window.confirm(S.activities.discard)) {
                      setSpec(candidate);
                      setSpecOpen(true);
                    }
                  }}
                />
              )}
            </article>
          ))}
        </section>
      )}
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
