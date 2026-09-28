import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useBlocker,
  useMatch,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import type {
  ActivityDetail,
  ActivityDraft,
  ActivityRecord,
  ActivityRun,
  ActivityRunSummary,
  ActivitySummary,
  AssetManifest,
  BookWordsRefresh,
  MediaStat,
  PipelineSelection,
  PipelineState,
  SoundProviderId,
  SoundProviderStatus,
  SoundSetup,
  SpeechProviderId,
  SpeechProviderStatus,
  SpeechSetup,
  UploadedMedia,
  VideoSetup,
  VoiceOption,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { toastAttention, toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { discoverCodingAgents, listCodingAgents } from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip } from "../../lib/tone";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import {
  RUNNING_POLL_MS,
  settledActivityRuns,
  shouldPollSummaries,
  startedUnlistedRuns,
  shouldReloadList,
} from "../../lib/activity-sessions";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { InfoPopover } from "../../components/ui/info-popover";
import { EmptyState } from "../../components/ui/empty-state";
import { AssetLibraryView } from "./asset-library-view";
import { settledPipeline, settledRuns, type Announcement } from "./run-toasts";
import { CreateActivityDialog } from "./create-activity-dialog";
import { ImportDialog } from "./import-dialog";
import { ActivityWorkspace as WorkspaceShell, type StudioPanelEntry } from "./activity-workspace";
import { AssetEditor } from "./asset-editor";
import { SpeechCoverage } from "./speech-coverage";
import { BookWordsPanel } from "./book-words-panel";
import { withoutBookWords, wordsWithoutSounds } from "./book-words";
import { speechTally } from "./bulk-speech";
import { bulkSoundProvider, pendingSoundKinds } from "./bulk-sound";
import { buildSceneTree, filterTree, treeSelections, type SceneAssetType } from "./scene-assets";
import { firstSelection, sameSelection, type SceneAssetSelection } from "./scene-asset-tree";
import {
  resolveSection,
  workspaceSections,
  type StudioPanel,
  sectionFromParam,
  type WorkspaceSection,
} from "./workspace-model";
import { assetForPick, buildStudioTree } from "./studio-tree";
import { ConversationPanel } from "./conversation-panel";
import { focusFor, latestConversation } from "./conversation";
import { applyMediaChange, type ProposalChange } from "./proposal";
import { ScriptEditor } from "./script-editor";
import { PipelineControls, PipelinePanel } from "./pipeline-panel";
import { storyboardFrames, type StoryboardFrame } from "./storyboard";
import { Storyboard } from "./storyboard-view";
import { BuildPanel } from "./build-panel";
import { QualityChecksView } from "./quality-checks-view";
import { TestResultsView } from "./test-results-view";
import { ModuleDocumentView } from "./module-document-view";
import { ActivityStatsView } from "./activity-stats-view";
import { RefSwitcher } from "./ref-switcher";
import { CreateRefView } from "./create-ref-view";
import { renumberManifestText } from "./ref-number";
import { ImplementationFeaturesView } from "./implementation-features-view";
import { GenerationHistory } from "./history-section";
import { DeployPanel } from "./deploy-panel";
import { useAssistProposal } from "./use-assist-proposal";
import { StudioTreeView } from "./studio-tree-view";
import { runTitle, SessionsPanel } from "./sessions-panel";
import { ModulePreview } from "./module-preview";
import { SandboxPanel } from "./sandbox-panel";
import { sandboxHasModule, type SandboxStatusLike } from "./sandbox";
import { SceneReview } from "./scene-review";
import { SpecDiffView } from "./spec-diff-view";
import { latestModuleRun } from "./preview";
import { ActivityList } from "./activity-list";
import { ProjectMediaView } from "./project-media-view";
import type { GroupSort } from "./activity-groups";
import { useDiscardConfirm } from "./use-discard-confirm";
import { applyVoice, optionsFromVoices } from "./voice-catalogue";
import {
  applyProvider,
  isElevenLabsVoiceId,
  sharedProvider,
  speechChoice,
  wordCatalogue,
} from "./speech-provider";

const basePath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/activities`;
const pretty = (value: unknown) => (value ? JSON.stringify(value, null, 2) : "");

/** A stage sequence the panels can draw, or null for an answer that is not one. */
function pipelineOrNull(value: unknown): PipelineState | null {
  const state = value as PipelineState | null;
  return state && Array.isArray(state.steps) && typeof state.status === "string" ? state : null;
}

/** How long after the last keystroke the script saves itself: long enough not to save mid-word. */
const SCRIPT_AUTOSAVE_MS = 5000;
function announce({ kind, text }: Announcement) {
  if (kind === "success") toastSuccess(text);
  else if (kind === "error") toastError(text);
  else if (kind === "attention") toastAttention(text);
  else toastInfo(text);
}

export function ActivitiesPage() {
  useLocale();
  useDocumentTitle(S.activities.title);
  const { currentProject, unavailableProjectId } = useProject();
  const previousProject = useRef(currentProject);
  if (currentProject) previousProject.current = currentProject;
  const project =
    currentProject ??
    (previousProject.current?.projectId === unavailableProjectId ? previousProject.current : null);
  if (!project) return <EmptyState title={S.activities.noProject} />;
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const media = useMatch("/activities/media") !== null;
  const [items, setItems] = useState<ActivityRecord[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ActivitySummary>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Kept here rather than in the list, so opening an activity and coming back keeps them.
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<GroupSort>("recent");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
  // Read through a ref so `reload` keeps one identity across opening and leaving an activity.
  const openActivityId = useRef(activityId);
  openActivityId.current = activityId;
  const reload = useCallback(async () => {
    if (!accessible.current) return;
    // Inside an activity (a studio save, say) only the records are needed: the summaries
    // fan out over every activity, and the return-to-list reload fetches them fresh.
    const withSummaries = openActivityId.current === undefined;
    try {
      const result = await apiFetch<{
        activities: ActivityRecord[];
        summaries?: Record<string, ActivitySummary>;
      }>(withSummaries ? `${basePath(projectId)}?summary=1` : basePath(projectId));
      if (mounted.current) {
        setItems(result.activities);
        if (withSummaries) setSummaries(result.summaries ?? {});
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
  // Live refresh: no server event exists for activity runs, so the home list rides the
  // sessions store instead — an activity-run session going idle (or otherwise settling)
  // is the signal that this list may be stale. Only while looking at the list itself
  // (not a single activity's own workspace), and only on the running -> settled edge, so a
  // page that never had a run in flight does not reload on every unrelated session tick.
  const { sessions, liveStatuses } = useSessions();
  const seenRunStatus = useRef(new Map<string, string>());
  useEffect(() => {
    if (!activityId && settledActivityRuns(seenRunStatus.current, sessions)) void reload();
    seenRunStatus.current = new Map(sessions.map((session) => [session.sessionId, session.status]));
  }, [sessions, activityId, reload]);
  // A run started elsewhere after the store loaded has no row, only a live status: reload on
  // its start, so its summary says "running" and the poll below takes it to its end.
  const seenLive = useRef<ReadonlyMap<string, string>>(liveStatuses);
  useEffect(() => {
    if (!activityId && startedUnlistedRuns(seenLive.current, liveStatuses, sessions)) void reload();
    seenLive.current = liveStatuses;
  }, [liveStatuses, sessions, activityId, reload]);
  // A run can settle while the user is still inside that activity's own workspace — the
  // effect above never fires then, since it only watches while `!activityId`, so the run
  // "settling" is missed there. Coming back to the list is itself a reason to check again:
  // `prevActivityId` starts undefined, so the list's own first mount does not double-reload.
  const prevActivityId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (shouldReloadList(prevActivityId.current, activityId)) void reload();
    prevActivityId.current = activityId;
  }, [activityId, reload]);
  // A run started after the sessions store loaded never reaches the settle signal above, so
  // while the list is shown and some summary says a run is in flight, re-read it every few
  // seconds; the poll stops once nothing is running or an activity is opened.
  const polling = shouldPollSummaries(activityId, summaries);
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => void reload(), RUNNING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, reload]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const canLeave = useCallback(() => !dirty.current, []);
  const isDirty = useCallback(() => dirty.current, []);
  const discard = useDiscardConfirm(isDirty);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && dirty.current,
  );
  // Ask once per blocked *attempt*, not merely once per "unblocked -> blocked" edge: a
  // Cancel's `blocker.reset()` and the very next navigation's own block can land in the same
  // React batch (e.g. a browser-back thrown right after dismissing the previous dialog), and
  // React is then free to skip rendering the intermediate "unblocked" state entirely — this
  // effect would never see it and would wrongly treat the new attempt as already answered.
  // Each blocked attempt is a new blocker object, so its identity survives that skip.
  const askedFor = useRef<typeof blocker | null>(null);
  useEffect(() => {
    if (blocker.state !== "blocked") {
      askedFor.current = null;
      return;
    }
    if (askedFor.current === blocker) return;
    askedFor.current = blocker;
    discard.ask(
      () => blocker.proceed(),
      () => blocker.reset(),
    );
  }, [blocker, discard.ask]);
  // Switching or deleting a Project while dirty asks through the same dialog. The caller
  // (setCurrentProjectId / deleteProject / the removed-selection reload) awaits this, so its
  // own success/error handling runs on whichever answer actually happened — declining
  // resolves false right away, discarding clears `dirty` and resolves true.
  const projectChangeGuard = useCallback(() => {
    if (!dirty.current) return true;
    return new Promise<boolean>((resolve) => {
      discard.ask(
        () => {
          dirty.current = false;
          resolve(true);
        },
        () => resolve(false),
      );
    });
  }, [discard.ask]);
  useLayoutEffect(
    () => registerProjectChangeGuard(projectChangeGuard),
    [registerProjectChangeGuard, projectChangeGuard],
  );
  if (!activityId && searchParams.get("view") === "media")
    return <Navigate to="/activities/media" replace />;
  if (media) return <ProjectMediaView projectId={projectId} available={available} />;
  if (activityId) {
    // The workspace fills this pane and scrolls inside itself, so nothing may wrap it
    // in a scroller or a max-width column.
    return (
      <div className="h-full min-h-0">
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
          onDeleted={(title) => {
            // Nothing unsaved is worth keeping in an activity that is gone.
            dirty.current = false;
            announce({ kind: "success", text: S.activities.deleteActivity.deleted(title) });
            void reload();
            navigate("/activities");
          }}
        />
        {discard.modal}
      </div>
    );
  }
  return (
    <>
      <ActivityList
        items={items}
        loading={loading}
        error={error}
        editable={editable}
        available={available}
        createDisabled={!canLeave()}
        projectId={projectId}
        summaries={summaries}
        sort={sort}
        onSort={setSort}
        search={search}
        onSearch={setSearch}
        tag={tag}
        onTag={setTag}
        onRefresh={() => void reload()}
        onImport={() => setImportOpen(true)}
        onCreate={() => setCreateOpen(true)}
        onMedia={() => navigate("/activities/media")}
      />
      {importOpen && (
        <ImportDialog
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onImported={() => void reload()}
        />
      )}
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
      {discard.modal}
    </>
  );
}

function ActivityEditor({
  projectId,
  activityId,
  editable,
  available,
  onDirty,
  onSaved,
  onDeleted,
}: {
  projectId: string;
  activityId: string;
  editable: boolean;
  available: boolean;
  onDirty: (value: boolean) => void;
  onSaved: () => Promise<void>;
  onDeleted: (title: string) => void;
}) {
  const { agents, currentAgent } = useProject();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [description, setDescription] = useState("");
  const [spec, setSpec] = useState("");
  const [specOpen, setSpecOpen] = useState(false);
  // The open section is mirrored into ?section= so a link can land on it; an unknown or
  // not-yet-available one falls back like any other choice.
  const [searchParams, setSearchParams] = useSearchParams();
  const [sectionChoice, setSectionChoice] = useState<WorkspaceSection | null>(() =>
    sectionFromParam(searchParams.get("section")),
  );
  const setSection = useCallback(
    (next: WorkspaceSection) => {
      setSectionChoice(next);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set("section", next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [languageChoice, setLanguage] = useState("");
  const [kind, setKind] = useState<SceneAssetType | "all">("all");
  const [selected, setSelected] = useState<SceneAssetSelection | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  // Controlled like the specification's, so moving between sections does not close it.
  const [mediaOpen, setMediaOpen] = useState(false);
  const [media, setMedia] = useState("");
  const [runs, setRuns] = useState<ActivityRunSummary[]>([]);
  const [sandboxModule, setSandboxModule] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  // The activity's run of its stages, as the server last reported it (pipeline-run.ts).
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const [pipelineChoice, setPipelineChoice] = useState<PipelineSelection>("all");
  // The languages the product supports: what the activity may be translated into.
  const [languageSetup, setLanguageSetup] = useState<{
    defaultLanguage: string;
    languages: { code: string; label: string }[];
  }>({ defaultLanguage: "en-US", languages: [] });
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ defaultLanguage: string; languages: { code: string; label: string }[] }>(
      `${basePath(projectId)}/language-setup`,
    )
      .then((value) => {
        // A table is kept only when it is one; anything else offers no language to add.
        if (
          !cancelled &&
          Array.isArray(value?.languages) &&
          typeof value.defaultLanguage === "string"
        )
          setLanguageSetup(value);
      })
      .catch(() => {
        /* Without the table no language is offered to add; nothing else depends on it. */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  // The Scenes section opens on the storyboard; opening an asset leaves it for the editor.
  const [board, setBoard] = useState(true);
  const [boardScene, setBoardScene] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState<{ key: StudioPanel; at: number } | null>(null);
  // An excerpt on its way to the conversation's composer, from another panel.
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const takeExcerpt = useCallback(() => setExcerpt(null), []);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  /** A Penguin agent id, or `coding:<id>` for an external coding agent. */
  const [agentId, setAgentId] = useState("");
  const [codingAgents, setCodingAgents] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    // Saved coding agents plus the ones detected as runnable on the server; either can run a
    // stage. Unavailable coding agents simply leave the list with Penguin agents only.
    void Promise.all([listCodingAgents(), discoverCodingAgents()])
      .then(([saved, discovered]) => {
        if (cancelled) return;
        const byId = new Map(saved.agents.map((a) => [a.id, a.title ?? a.id]));
        for (const candidate of discovered.candidates)
          if (candidate.detected && candidate.launch && !byId.has(candidate.recipeId))
            byId.set(candidate.recipeId, candidate.title);
        setCodingAgents([...byId].map(([id, title]) => ({ id, title })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const [bookMode, setBookMode] = useState<"" | "readAlong" | "decodable">("");
  const [wafRoot, setWafRoot] = useState("");
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const voices = voiceOptions.map((option) => option.id);
  // The voice bulk speech, retries and the stage sequence speak with where a narration names
  // none of its own; one per session.
  const [bulkVoiceChoice, setBulkVoice] = useState("");
  const bulkVoice = voices.includes(bulkVoiceChoice) ? bulkVoiceChoice : (voices[0] ?? "");
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
  const discard = useDiscardConfirm(() => dirty);
  state.current = { dirty, busy, revision: detail?.draft.contentRevision ?? "", available };
  // The conversation the panel has open, whose proposal the studio shows; until the panel
  // says otherwise, the newest.
  const [threadRunId, setThreadRunId] = useState<string | null | undefined>(undefined);
  const proposal = useAssistProposal(
    endpoint,
    threadRunId === undefined ? (latestConversation(runs)?.runId ?? null) : threadRunId,
  );
  // The proposed script, while it still differs from the saved one.
  const proposedScript = proposal.read?.proposal?.changes.find(
    (change) => change.target === "description",
  );
  const scriptProposal =
    proposedScript && detail && proposedScript.text !== detail.draft.description
      ? proposedScript.text
      : null;
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
        const [value, history, sandbox, stages] = await Promise.all([
          apiFetch<ActivityDetail>(endpoint),
          apiFetch<{ runs: ActivityRunSummary[] }>(`${endpoint}/runs`),
          // A module this project never assembled -- one Loom generated -- still has a
          // Module section; only the sandbox knows it is there.
          apiFetch<SandboxStatusLike>(`${endpoint}/sandbox/status`).catch(() => null),
          // Following a run is a courtesy over the history, which stands without it.
          apiFetch<{ pipeline: PipelineState | null }>(`${endpoint}/pipeline`).catch(() => null),
        ]);
        if (cancelled) return;
        setLoadError("");
        setRuns(history.runs);
        setSandboxModule(sandboxHasModule(sandbox));
        if (stages) setPipeline(pipelineOrNull(stages.pipeline));
        active =
          history.runs.some((run) => run.status === "running") ||
          stages?.pipeline?.status === "running";
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
  // Background work announces itself when it settles, wherever the author has gone in
  // the workspace. While the stages run, their runs settle one after another, so only the
  // stages' own outcome is announced.
  const seenRuns = useRef<{
    endpoint: string;
    statuses: Map<string, ActivityRunSummary["status"]>;
  }>({ endpoint: "", statuses: new Map() });
  const seenPipeline = useRef<{ endpoint: string; status: PipelineState["status"] | null }>({
    endpoint: "",
    status: null,
  });
  useEffect(() => {
    const before = seenRuns.current.endpoint === endpoint ? seenRuns.current.statuses : new Map();
    if (pipeline?.status !== "running")
      for (const announcement of settledRuns(before, runs)) announce(announcement);
    seenRuns.current = {
      endpoint,
      statuses: new Map(runs.map((run) => [run.runId, run.status])),
    };
  }, [runs, endpoint, pipeline?.status]);
  useEffect(() => {
    const before = seenPipeline.current.endpoint === endpoint ? seenPipeline.current.status : null;
    const announcement = settledPipeline(before, pipeline);
    if (announcement) announce(announcement);
    seenPipeline.current = { endpoint, status: pipeline?.status ?? null };
  }, [pipeline, endpoint]);
  /** Run one change at a time; resolves true only when it went through. */
  async function action(operation: () => Promise<void>): Promise<boolean> {
    if (state.current.busy || !state.current.available) return false;
    state.current.busy = true;
    setBusy(true);
    setError("");
    try {
      await operation();
      return true;
    } catch (e) {
      if (alive.current) setError(apiErrorText(e));
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  /** Save one part of the draft. `quiet` leaves out the toast, for an autosave. */
  async function save(
    kind: "description" | "spec" | "media",
    quiet = false,
    /** The manifest to save instead of the editor's text, which a state update has not reached yet. */
    manifest?: AssetManifest,
  ): Promise<boolean> {
    if (!detail) return false;
    return action(async () => {
      const draft = await apiFetch<ActivityDraft>(
        `${endpoint}/${kind === "description" ? "description" : kind === "media" ? "media" : "apply-generated-spec"}`,
        {
          method: kind === "description" ? "PATCH" : kind === "media" ? "PUT" : "POST",
          body: {
            expectedRevision: detail.draft.contentRevision,
            ...(kind === "description"
              ? { description }
              : kind === "media"
                ? { manifest: manifest ?? JSON.parse(media) }
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
      if (!quiet) toastSuccess(S.activities.saved);
      await onSaved();
    });
  }
  const selectedAgent = agentId || currentAgent?.agentId || agents[0]?.agentId || "";
  const codingAgentId = selectedAgent.startsWith("coding:") ? selectedAgent.slice(7) : null;
  /** Who runs a stage, as the stage routes take it. */
  // A coding agent's run is a Session too, owned by the Penguin agent the Project would use.
  const penguinAgent = currentAgent?.agentId ?? agents[0]?.agentId;
  const runner = codingAgentId
    ? { codingAgentId, ...(penguinAgent !== undefined ? { agentId: penguinAgent } : {}) }
    : { agentId: selectedAgent };
  // Which sound providers the chosen Penguin agent can use; a coding agent can use none.
  const [soundSetup, setSoundSetup] = useState<{
    agentId: string;
    providers: SoundProviderStatus[];
  } | null>(null);
  useEffect(() => {
    if (!available || !editable || !selectedAgent || codingAgentId) return;
    let cancelled = false;
    void apiFetch<SoundSetup>(
      `${basePath(projectId)}/sound-setup?${new URLSearchParams({ agentId: selectedAgent })}`,
    )
      .then((value) => {
        if (!cancelled) setSoundSetup({ agentId: selectedAgent, providers: value.providers });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [available, editable, selectedAgent, codingAgentId, projectId]);
  // Whether the scene-video experiment is on; the studio shows nothing of it until it is.
  const [videoSetup, setVideoSetup] = useState<VideoSetup | null>(null);
  useEffect(() => {
    if (!available || !editable) return;
    let cancelled = false;
    void apiFetch<VideoSetup>(`${basePath(projectId)}/video-setup`)
      .then((value) => {
        if (!cancelled) setVideoSetup(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [available, editable, projectId]);
  const soundProviders =
    soundSetup && !codingAgentId && soundSetup.agentId === selectedAgent
      ? soundSetup.providers
      : null;
  // The voices, and with a Penguin agent chosen, which speech providers its Vault has keys
  // for and whether it names a default ElevenLabs voice.
  const speechAgent = selectedAgent && !codingAgentId ? selectedAgent : "";
  const [speechSetup, setSpeechSetup] = useState<{
    agentId: string;
    providers: SpeechProviderStatus[] | null;
  } | null>(null);
  useEffect(() => {
    if (!available || !editable) return;
    let cancelled = false;
    void apiFetch<Partial<SpeechSetup> & { voices: string[] }>(
      `${basePath(projectId)}/speech-setup${
        speechAgent ? `?${new URLSearchParams({ agentId: speechAgent })}` : ""
      }`,
    )
      .then((value) => {
        if (cancelled) return;
        // An older server sends the bare names only.
        setVoiceOptions(
          Array.isArray(value.catalogue)
            ? wordCatalogue(value.catalogue)
            : optionsFromVoices(value.voices, value.model),
        );
        setSpeechSetup({ agentId: speechAgent, providers: value.providers ?? null });
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, available, editable, speechAgent]);
  const speechProviders =
    speechSetup && speechAgent && speechSetup.agentId === speechAgent
      ? speechSetup.providers
      : null;
  const running = runs.some((run) => run.status === "running");
  const pipelineRunning = pipeline?.status === "running";
  // The script saves itself a few seconds after typing stops, and holds off while
  // the pipeline runs so a save never moves the draft under a stage. Text typed during a
  // save stays: a save never writes the saved text back over the editor.
  const [scriptSave, setScriptSave] = useState<"saving" | "saved" | "failed" | null>(null);
  const scriptDirty = !!detail && description !== detail.draft.description;
  const autosaveHeld = running || pipelineRunning;
  useEffect(() => {
    if (!scriptDirty || !editable || !available || busy || autosaveHeld) return;
    const timer = setTimeout(() => {
      setScriptSave("saving");
      void save("description", true).then((ok) => {
        if (alive.current) setScriptSave(ok ? "saved" : "failed");
      });
    }, SCRIPT_AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // `save` reads the latest text when it fires; the timer restarts on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, scriptDirty, editable, available, busy, autosaveHeld]);
  const scriptStatus = scriptDirty
    ? autosaveHeld
      ? S.activities.studioScript.autosave.held
      : scriptSave === "saving"
        ? S.activities.studioScript.autosave.saving
        : scriptSave === "failed"
          ? S.activities.studioScript.autosave.failed
          : S.activities.studioScript.autosave.pending
    : scriptSave === "saved"
      ? S.activities.studioScript.autosave.saved
      : null;
  const words = S.activities.studioRun;
  // Why Run cannot start the stages now. The server refuses the same cases; saying so
  // here saves the round trip, and says it in the author's terms.
  const pipelineBlocked =
    !editable || !available
      ? null
      : dirty
        ? words.saveFirst
        : running || pipelineRunning
          ? words.otherRun
          : !selectedAgent
            ? words.noAgent
            : null;
  const agentLabel = codingAgentId
    ? (codingAgents.find((agent) => agent.id === codingAgentId)?.title ?? codingAgentId)
    : (agents.find((agent) => agent.agentId === selectedAgent)?.name ?? selectedAgent);
  function runStages(
    stage: PipelineSelection = pipelineChoice,
    scope?: { language: string; assetKey?: string },
    soundProvider?: SoundProviderId,
  ) {
    void action(async () => {
      if (!detail) return;
      const started = await apiFetch<PipelineState>(`${endpoint}/pipeline`, {
        method: "POST",
        body: {
          ...runner,
          stage,
          ...scope,
          ...(soundProvider ? { soundProvider } : {}),
          ...(bulkVoice ? { voice: bulkVoice } : {}),
          ...(wafRoot.trim() ? { wafRoot: wafRoot.trim() } : {}),
          ...(detail.activityType === "book" && bookMode ? { bookMode } : {}),
        },
      });
      if (!alive.current) return;
      setPipeline(pipelineOrNull(started));
      setShowPanel({ key: "run", at: Date.now() });
      setRefreshVersion((value) => value + 1);
    });
  }
  function stopStages() {
    void action(async () => {
      const stopped = await apiFetch<{ pipeline: PipelineState | null }>(
        `${endpoint}/pipeline/stop`,
        { method: "POST", body: {} },
      );
      if (alive.current) setPipeline(pipelineOrNull(stopped.pipeline));
    });
  }
  useEffect(() => {
    const next = speechQueue?.keys[0];
    if (!next || running || busy || dirty || !selectedAgent || codingAgentId || !detail) return;
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
            // A narration speaks with its own provider and saved voice; the queue's voice
            // fills the rest where that provider speaks with it.
            ...speechChoice(
              detail.draft.mediaPlan?.manifest.assets[speechQueue!.language]?.find(
                (asset) => asset.key === next,
              ),
              voiceOptions,
              speechQueue!.voice,
            ),
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
  }, [
    speechQueue,
    running,
    busy,
    dirty,
    selectedAgent,
    codingAgentId,
    detail,
    endpoint,
    voiceOptions,
  ]);
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
                  typeof item.generatedImage.sha256 === "string")) &&
              (item.generatedVideo === undefined ||
                (item.generatedVideo &&
                  typeof item.generatedVideo.runId === "string" &&
                  typeof item.generatedVideo.sha256 === "string")),
          ),
      )
    )
      editedManifest = value;
  } catch {
    /* Preserve invalid JSON for correction without replacing it with a saved manifest. */
  }
  /** Start one generation run and show it at the top of the history immediately. */
  function startRun(path: string, body: Record<string, unknown>) {
    void action(async () => {
      const run = await apiFetch<ActivityRun>(`${endpoint}/${path}`, {
        method: "POST",
        body: { ...runner, expectedRevision: detail!.draft.contentRevision, ...body },
      });
      if (alive.current) {
        setRuns((previous) => [
          summarize(run),
          ...previous.filter((item) => item.runId !== run.runId),
        ]);
        setRefreshVersion((value) => value + 1);
      }
    });
  }
  /**
   * Accept one change an agent proposed, through the route the author's own save uses, so
   * it is checked and recorded the same way. The author's unsaved edits are never
   * overwritten: the card will not offer Accept while there are any.
   */
  async function acceptProposal(change: ProposalChange): Promise<void> {
    await action(async () => {
      if (!detail || state.current.dirty) throw new Error(S.activities.studioProposal.saveFirst);
      const [path, method, body] =
        change.target === "description"
          ? (["description", "PATCH", { description: change.text }] as const)
          : change.target === "spec"
            ? (["apply-generated-spec", "POST", { spec: change.spec }] as const)
            : ([
                "media",
                "PUT",
                {
                  manifest: applyMediaChange(
                    detail.draft.mediaPlan?.manifest ??
                      fail(S.activities.studioProposal.missingAsset(change.assetKey)),
                    change,
                  ),
                },
              ] as const);
      const draft = await apiFetch<ActivityDraft>(`${endpoint}/${path}`, {
        method,
        body: { expectedRevision: detail.draft.contentRevision, ...body },
      });
      if (!alive.current) return;
      accept({
        ...detail,
        title: draft.status === "valid" ? String(draft.spec?.title) : detail.title,
        draft,
      });
      toastSuccess(S.activities.saved);
    });
  }
  /**
   * Apply the conversation's whole proposal as one draft change, read fresh from its run
   * by the server, so it lands whole or not at all.
   */
  async function applyWholeProposal(runId: string): Promise<void> {
    await action(async () => {
      if (!detail || state.current.dirty) throw new Error(S.activities.studioProposal.saveFirst);
      const draft = await apiFetch<ActivityDraft>(
        `${endpoint}/runs/${encodeURIComponent(runId)}/proposal/apply`,
        { method: "POST", body: { expectedRevision: detail.draft.contentRevision } },
      );
      if (!alive.current) return;
      accept({
        ...detail,
        title: draft.status === "valid" ? String(draft.spec?.title) : detail.title,
        draft,
      });
      toastSuccess(S.activities.saved);
    });
  }
  async function discardProposal(runId: string): Promise<void> {
    await action(async () => {
      await apiFetch(`${endpoint}/runs/${encodeURIComponent(runId)}/proposal/discard`, {
        method: "POST",
        body: {},
      });
      proposal.reload();
    });
  }
  /** Accept a candidate, which replaces the draft rather than starting anything. */
  function acceptRun(runId: string, path: string) {
    void action(async () => {
      const draft = await apiFetch<ActivityDraft>(
        `${endpoint}/runs/${encodeURIComponent(runId)}/${path}`,
        { method: "POST", body: { expectedRevision: detail!.draft.contentRevision } },
      );
      if (alive.current) {
        accept({ ...detail!, draft });
        toastSuccess(S.activities.saved);
      }
    });
  }
  // The rail and the detail pane read one derivation, so they cannot disagree about
  // which language, which scene, or which asset is being shown.
  // A saved specification that asks an assessment can have one generated before any module.
  const usesAssessment =
    detail?.draft.status === "valid" &&
    (detail.draft.spec?.runtime as { usesAssessment?: unknown } | undefined)?.usesAssessment ===
      true;
  const sections = workspaceSections({
    hasSpec: !!detail?.draft.spec,
    hasPlan: !!detail?.draft.mediaPlan,
    hasModule: !!latestModuleRun(runs) || sandboxModule,
    usesAssessment,
  });
  const section = resolveSection(sectionChoice, {
    hasSpec: !!detail?.draft.spec,
    hasPlan: !!detail?.draft.mediaPlan,
    hasModule: !!latestModuleRun(runs) || sandboxModule,
    usesAssessment,
  });
  // The saved draft's media stats, read once per revision while the scenes are open, for
  // the file details of a bound clip. Null when they could not be read.
  const statsRevision = detail?.draft.contentRevision ?? "";
  const wantMediaStats = section === "scenes" && !!detail?.draft.mediaPlan;
  const [mediaStats, setMediaStats] = useState<{
    key: string;
    media: MediaStat[] | null;
  } | null>(null);
  useEffect(() => {
    if (!wantMediaStats) return;
    const key = `${endpoint}@${statsRevision}`;
    let cancelled = false;
    apiFetch<{ media: MediaStat[] }>(`${endpoint}/media-stats`)
      .then((value) => {
        if (!cancelled) setMediaStats({ key, media: value.media });
      })
      .catch(() => {
        if (!cancelled) setMediaStats({ key, media: null });
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, statsRevision, wantMediaStats]);
  const currentMediaStats =
    mediaStats?.key === `${endpoint}@${statsRevision}` ? mediaStats.media : undefined;
  const language = editedManifest?.assets[languageChoice]
    ? languageChoice
    : (Object.keys(editedManifest?.assets ?? {})[0] ?? "en-US");
  const tree = filterTree(
    buildSceneTree(detail?.draft.spec ?? null, editedManifest?.assets[language] ?? []),
    kind,
  );
  // A selection the filter or a rebuilt plan removed falls back to the first leaf, so
  // the detail pane never points at an asset the tree no longer draws.
  const fullTree = buildSceneTree(
    detail?.draft.spec ?? null,
    editedManifest?.assets[language] ?? [],
  );
  const frames = storyboardFrames(
    fullTree,
    detail?.draft.mediaPlan?.manifest.assets[language] ?? [],
    runs,
    proposal.read?.proposal?.changes ?? [],
    language,
  );
  const selection =
    selected && treeSelections(tree).some((entry) => sameSelection(entry, selected))
      ? selected
      : firstSelection(tree);
  // The open asset's place on the storyboard, and the scenes either side that have media
  // to open, so an author can walk the activity scene by scene from the editor.
  const frameLabel = (frame: StoryboardFrame) =>
    frame.general
      ? S.activities.studioBoard.shared
      : S.activities.studioBoard.scene(frame.number, frame.sceneId);
  const openFrame = (frame: StoryboardFrame | undefined) =>
    frame?.firstAssetKey
      ? {
          label: frameLabel(frame),
          open: () => {
            setKind("all");
            setSelected({ sceneId: frame.sceneId, key: frame.firstAssetKey! });
            setBoardScene(frame.sceneId);
          },
        }
      : null;
  const openable = frames.filter((frame) => frame.firstAssetKey);
  const here = openable.findIndex((frame) => frame.sceneId === selection?.sceneId);
  const sceneNav =
    here >= 0
      ? {
          label: frameLabel(openable[here]!),
          onBoard: () => {
            setBoardScene(openable[here]!.sceneId);
            setBoard(true);
          },
          previous: openFrame(openable[here - 1]),
          next: openFrame(openable[here + 1]),
        }
      : undefined;
  const languages = Object.keys(detail?.draft.mediaPlan?.manifest.assets ?? {});
  const panels: StudioPanelEntry[] = detail
    ? [
        {
          key: "run",
          label: S.activities.studioPanels.names.run,
          icon: "M5 6h10M5 12h14M5 18h7",
          render: () => (
            <PipelinePanel
              pipeline={pipeline}
              agentLabel={agentLabel}
              onAddExcerpt={(text) => {
                setExcerpt(text);
                setShowPanel({ key: "conversation", at: Date.now() });
              }}
            />
          ),
        },
        {
          key: "player",
          label: S.activities.studioPanels.names.player,
          icon: "M8 5v14l11-7z",
          render: () => (
            <div className="p-3">
              <SandboxPanel
                projectId={projectId}
                activityId={detail.id}
                spec={detail.draft.spec}
                languages={languages}
                hasMedia={!!editedManifest?.assets[language]?.length}
                onPick={(pick, sceneId) => {
                  // Matched against every kind of media, whatever the tree shows.
                  const found = assetForPick(
                    buildSceneTree(detail.draft.spec, editedManifest?.assets[language] ?? []),
                    sceneId,
                    pick,
                  );
                  if (!found) return null;
                  setSelected(found);
                  setBoard(false);
                  setSection("scenes");
                  return found.key;
                }}
              />
            </div>
          ),
        },
        {
          key: "conversation",
          label: S.activities.studioPanels.names.conversation,
          icon: "M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z",
          render: () => (
            <ConversationPanel
              endpoint={endpoint}
              runs={runs}
              runner={selectedAgent ? runner : null}
              revision={detail.draft.contentRevision}
              focus={
                section === "scenes" && board
                  ? { section, ...(boardScene ? { sceneId: boardScene, language } : {}) }
                  : focusFor(section, selection, language)
              }
              editable={editable}
              onStarted={(run) => {
                setRuns((previous) => [
                  summarize(run),
                  ...previous.filter((item) => item.runId !== run.runId),
                ]);
                setRefreshVersion((value) => value + 1);
              }}
              base={{
                description: detail.draft.description,
                spec: detail.draft.spec,
                manifest: detail.draft.mediaPlan?.manifest ?? null,
              }}
              dirty={dirty}
              onAccept={acceptProposal}
              proposal={proposal.read}
              onReplyEnded={proposal.reload}
              seed={excerpt}
              onSeedTaken={takeExcerpt}
              onApplyAll={
                proposal.read ? () => applyWholeProposal(proposal.read!.runId) : undefined
              }
              onDiscard={proposal.read ? () => discardProposal(proposal.read!.runId) : undefined}
              onThread={setThreadRunId}
            />
          ),
        },
        {
          key: "sessions",
          label: S.activities.studioPanels.names.sessions,
          icon: "M4 5h16v11H9l-5 4z",
          render: () => <SessionsPanel runs={runs} />,
        },
      ]
    : [];
  if (!detail)
    return (
      <p
        role={error || loadError ? "alert" : "status"}
        className={`text-sm ${error || loadError ? toneInk.danger : "text-gray-500"}`}
      >
        {error || loadError || S.activities.loading}
      </p>
    );
  const runningRun = runs.find((run) => run.status === "running");
  return (
    <>
      <WorkspaceShell
        panels={panels}
        showPanel={showPanel}
        layout={{ section, onSection: setSection }}
        header={
          <>
            <nav
              aria-label={S.activities.breadcrumb}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm"
            >
              <Link
                to="/activities"
                className="shrink-0 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {S.activities.backToActivities}
              </Link>
              <span aria-hidden className="shrink-0 text-gray-300 dark:text-gray-600">
                /
              </span>
              <span
                className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400"
                title={`${S.activities.collection}: ${detail.collectionId}`}
              >
                {detail.productCode}
              </span>
              <span aria-hidden className="shrink-0 text-gray-300 dark:text-gray-600">
                /
              </span>
              <h2 className="min-w-0 truncate font-semibold" title={detail.title}>
                {detail.title}
              </h2>
              <RefSwitcher
                base={basePath(projectId)}
                activity={detail}
                editable={editable && available}
                onIdentity={(record) => {
                  setDetail((current) => (current ? { ...current, ...record } : current));
                  // A name or tags change shows on the list's cards, for every ref of the
                  // product; the list is kept while an activity is open, so refresh it now.
                  void onSaved();
                }}
                revision={detail.draft.contentRevision}
                onRenumbered={(value, from) => {
                  // Only the number and the manifest's address changed; unsaved script or
                  // specification text stays in its editor. The manifest editor follows the
                  // new address, and unsaved manifest edits are moved to the new number so
                  // they can still be saved.
                  setMedia(
                    media === pretty(detail.draft.mediaPlan?.manifest)
                      ? pretty(value.draft.mediaPlan?.manifest)
                      : renumberManifestText(media, from, value.refNum),
                  );
                  setDetail(value);
                  announce({
                    kind: "success",
                    text: S.activities.studioRefs.renumbered(from, value.refNum),
                  });
                  // An assembled module keeps the old number in its file names.
                  if (latestModuleRun(runs) || sandboxModule)
                    announce({ kind: "attention", text: S.activities.studioRefs.reassemble });
                  void onSaved();
                }}
                onDeleted={() => onDeleted(detail.title)}
                // The new-ref table walks the media plan, so the way in waits for one.
                onNewRef={detail.draft.mediaPlan ? () => setSection("newRef") : undefined}
              />
              {runningRun && (
                <span
                  className={`ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/20 px-2 py-0.5 text-xs ${toneInk.busy}`}
                >
                  <span aria-hidden className={`size-1.5 rounded-full ${toneDot.busy}`} />
                  {S.activities.runningChip(runTitle(runningRun.kind))}
                </span>
              )}
            </nav>
            <p
              aria-live="polite"
              className={`whitespace-nowrap text-xs ${dirty ? toneInk.attention : toneInk.muted}`}
            >
              {dirty ? S.activities.unsaved : S.activities.draftStatus[detail.draft.status]}
            </p>
            <Button
              size="sm"
              disabled={busy || !available}
              onClick={() =>
                discard.ask(
                  () =>
                    void action(async () => {
                      const value = await apiFetch<ActivityDetail>(endpoint);
                      if (alive.current) accept(value);
                    }),
                )
              }
            >
              {S.activities.reload}
            </Button>
          </>
        }
        notices={
          <>
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
              <p role="alert" className={`rounded-md border p-3 text-xs ${toneStrip.danger}`}>
                {error}
              </p>
            )}
            {loadError && available && (
              <p role="alert" className={`rounded-md border p-3 text-xs ${toneStrip.danger}`}>
                {loadError}
              </p>
            )}
            {changed && (
              <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
                {S.activities.remoteChanged}
              </p>
            )}
          </>
        }
        rail={(dismiss) => (
          <div className="flex min-h-0 flex-1 flex-col">
            {Object.keys(editedManifest?.assets ?? {}).length > 1 && (
              <div className="shrink-0 px-3 pt-2">
                <Select
                  size="sm"
                  label={S.activities.mediaLanguage}
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  {Object.keys(editedManifest?.assets ?? {}).map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <StudioTreeView
              nodes={buildStudioTree(sections, tree)}
              section={section}
              selection={section === "scenes" && !board ? selection : null}
              onChoose={(target) => {
                if (target.kind === "section") {
                  setSection(target.section);
                  if (target.section === "scenes") setBoard(true);
                } else if (target.kind === "asset") {
                  setSelected(target.selection);
                  setBoard(false);
                  setSection("scenes");
                }
                dismiss();
              }}
            />
            {editable && available && (
              <PipelineControls
                choice={pipelineChoice}
                pipeline={pipeline}
                blocked={pipelineBlocked}
                onChoose={setPipelineChoice}
                onRun={() => runStages()}
                onStop={stopStages}
              />
            )}
          </div>
        )}
      >
        {section === "scenes" && editedManifest && board ? (
          <Storyboard
            frames={frames}
            selected={boardScene}
            assetsOf={(sceneId) =>
              fullTree.scenes
                .find((scene) => scene.sceneId === sceneId)
                ?.categories.flatMap((category) => category.assets) ?? []
            }
            thumbnailUrl={(assetKey) =>
              `${endpoint}/media-image?${new URLSearchParams({
                language,
                assetKey,
                expectedRevision: detail.draft.contentRevision,
                ...(wafRoot.trim() ? { wafRoot: wafRoot.trim() } : {}),
              })}`
            }
            onSelect={setBoardScene}
            onOpen={(sceneId, key) => {
              setKind("all");
              setSelected({ sceneId, key });
              setBoardScene(sceneId);
              setBoard(false);
            }}
            onPlay={() => setShowPanel({ key: "player", at: Date.now() })}
            onEditMedia={() => {
              const first = frames.find((frame) => frame.sceneId === boardScene)?.firstAssetKey;
              if (boardScene && first) setSelected({ sceneId: boardScene, key: first });
              setBoard(false);
            }}
            onAssemble={() => setSection("module")}
          />
        ) : section === "scenes" && editedManifest ? (
          <AssetEditor
            manifest={editedManifest}
            language={language}
            selection={selection}
            media={uploads}
            mediaLoading={uploadsLoading}
            onUpload={upload}
            onMediaCopied={() => void loadUploads()}
            runs={runs}
            endpoint={endpoint}
            editable={editable}
            disabled={busy || !available}
            mediaDirty={!!editedManifest && media !== pretty(detail.draft.mediaPlan?.manifest)}
            onSaveMedia={() => void save("media")}
            canGenerate={
              editable &&
              available &&
              detail.draft.status === "valid" &&
              !busy &&
              !running &&
              !dirty &&
              !!selectedAgent
            }
            canGenerateMedia={
              editable &&
              available &&
              detail.draft.status === "valid" &&
              !busy &&
              !running &&
              !dirty &&
              !!selectedAgent &&
              !codingAgentId
            }
            revision={detail.draft.contentRevision}
            mediaStats={currentMediaStats}
            savedManifest={detail.draft.mediaPlan?.manifest}
            canAccept={editable && available && !busy && !running && !dirty}
            canPreview={editable && available && !busy && !dirty}
            wafRoot={wafRoot}
            voices={voiceOptions}
            defaultVoice={bulkVoice}
            onChange={(value) => setMedia(pretty(value))}
            onGenerateAudio={(lang, assetKey, voice, provider) =>
              startRun("generate-audio", { language: lang, assetKey, voice, provider })
            }
            soundProviders={soundProviders}
            speechProviders={speechProviders}
            onGenerateSound={(lang, assetKey, provider, model) =>
              startRun("generate-sound", {
                language: lang,
                assetKey,
                provider,
                ...(model !== undefined ? { model } : {}),
              })
            }
            onGenerateImage={(lang, assetKey) =>
              startRun("generate-image", { language: lang, assetKey })
            }
            onAcceptAudio={(runId) => acceptRun(runId, "accept-audio")}
            onAcceptImage={(runId) => acceptRun(runId, "accept-image")}
            onGenerateText={(lang, assetKey) =>
              startRun("generate-media-text", { language: lang, assetKey })
            }
            onAcceptText={(runId) => acceptRun(runId, "accept-media-text")}
            defaultLanguage={languageSetup.defaultLanguage}
            onLanguage={setLanguage}
            onTranslate={
              language === languageSetup.defaultLanguage
                ? undefined
                : (lang, assetKey) =>
                    startRun("generate-media-text", { language: lang, assetKey, translate: true })
            }
            sceneNav={sceneNav}
            spec={detail?.draft.spec}
            onCompose={
              videoSetup?.enabled
                ? (lang, assetKey) =>
                    startRun("compose-video", {
                      language: lang,
                      assetKey,
                      // Scene images bound to checkout media are read from the chosen checkout.
                      ...(wafRoot.trim() ? { wafRoot: wafRoot.trim() } : {}),
                    })
                : undefined
            }
            onRecordVideo={
              videoSetup?.enabled
                ? (compositionRunId) => startRun("render-video", { compositionRunId })
                : undefined
            }
            onAcceptVideo={
              videoSetup?.enabled ? (runId) => acceptRun(runId, "accept-video") : undefined
            }
            onSaveSounds={(lang, assetKey, phonemes) =>
              void action(async () => {
                const draft = await apiFetch<ActivityDraft>(
                  `${endpoint}/book-words/${encodeURIComponent(assetKey)}/phonemes`,
                  {
                    method: "PUT",
                    body: {
                      language: lang,
                      phonemes,
                      expectedRevision: detail.draft.contentRevision,
                    },
                  },
                );
                if (!alive.current) return;
                accept({ ...detail, draft });
                toastSuccess(S.activities.bookWords.saved);
              })
            }
          />
        ) : section === "description" ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ScriptEditor
              value={description}
              saved={detail.draft.description}
              proposal={scriptProposal}
              access={!available ? "read" : editable ? "edit" : "disabled"}
              status={scriptStatus}
              canSave={editable}
              saveDisabled={busy || description === detail.draft.description}
              acceptBlocked={dirty ? S.activities.studioProposal.saveFirst : null}
              onChange={setDescription}
              onSave={() => void save("description")}
              onAcceptProposal={
                editable && available && scriptProposal !== null
                  ? () => void acceptProposal({ target: "description", text: scriptProposal })
                  : undefined
              }
            />
            {editable && (
              <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-gray-200 p-4 dark:border-gray-800">
                <div className="mx-auto max-w-4xl">
                  <div className="space-y-3">
                    <Select
                      size="sm"
                      label={S.activities.agent}
                      value={selectedAgent}
                      onChange={(e) => setAgentId(e.target.value)}
                      disabled={busy || running}
                    >
                      <optgroup label={S.activities.penguinAgents}>
                        {agents.map((agent) => (
                          <option key={agent.agentId} value={agent.agentId}>
                            {agent.name ?? agent.agentId}
                          </option>
                        ))}
                      </optgroup>
                      {codingAgents.length > 0 && (
                        <optgroup label={S.activities.codingAgents}>
                          {codingAgents.map((agent) => (
                            <option key={agent.id} value={`coding:${agent.id}`}>
                              {agent.title}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </Select>
                    {codingAgentId && (
                      <p className="text-xs text-gray-500">{S.activities.codingAgentMedia}</p>
                    )}
                    {dirty && (
                      <p className={`text-xs ${toneInk.attention}`}>{S.activities.saveFirst}</p>
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy || running || dirty || !selectedAgent || !description.trim()}
                      onClick={() =>
                        void action(async () => {
                          const run = await apiFetch<ActivityRun>(`${endpoint}/generate-spec`, {
                            method: "POST",
                            body: {
                              ...runner,
                              expectedRevision: detail.draft.contentRevision,
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
                      {S.activities.generate}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mx-auto max-w-4xl space-y-5">
                {section === "specification" && (
                  <>
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
                      <div className="flex flex-wrap items-center gap-2">
                        {editable && (
                          <Button
                            size="sm"
                            disabled={busy || !spec.trim() || spec === pretty(detail.draft.spec)}
                            onClick={() => void save("spec")}
                          >
                            {S.activities.saveSpec}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={spec === pretty(detail.draft.spec)}
                          onClick={() => setDiffOpen((value) => !value)}
                        >
                          {diffOpen ? S.activities.diffHide : S.activities.diffShow}
                        </Button>
                      </div>
                      {diffOpen && (
                        <SpecDiffView
                          saved={pretty(detail.draft.spec)}
                          edited={spec}
                          onRevert={
                            editable && !busy ? () => setSpec(pretty(detail.draft.spec)) : undefined
                          }
                        />
                      )}
                    </details>
                  </>
                )}
                {section === "scenes" && (
                  <>
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
                            busy ||
                            running ||
                            dirty ||
                            detail.draft.status !== "valid" ||
                            !detail.draft.spec
                          }
                          onClick={() =>
                            void action(async () => {
                              const draft = await apiFetch<ActivityDraft>(
                                `${endpoint}/plan-media`,
                                {
                                  method: "POST",
                                  body: { expectedRevision: detail.draft.contentRevision },
                                },
                              );
                              if (alive.current) {
                                accept({ ...detail, draft });
                                toastSuccess(S.activities.saved);
                              }
                            })
                          }
                        >
                          {detail.draft.mediaPlan
                            ? S.activities.rebuildMedia
                            : S.activities.planMedia}
                        </Button>
                      )}
                    </section>
                  </>
                )}
                {section === "speech" && editedManifest && detail.activityType === "book" && (
                  <BookWordsPanel
                    endpoint={endpoint}
                    language={language}
                    group={editedManifest.assets[language] ?? []}
                    runs={runs}
                    revision={detail.draft.contentRevision}
                    chosenMode={bookMode}
                    editable={editable}
                    canChange={editable && available && !busy && !running && !dirty}
                    canGenerate={
                      editable && available && !busy && !running && !dirty && !!selectedAgent
                    }
                    onRefresh={(mode) =>
                      void action(async () => {
                        const result = await apiFetch<BookWordsRefresh>(
                          `${endpoint}/book-words/refresh`,
                          {
                            method: "POST",
                            body: {
                              language,
                              expectedRevision: detail.draft.contentRevision,
                              ...(mode ? { bookMode: mode } : {}),
                            },
                          },
                        );
                        if (!alive.current) return;
                        accept({ ...detail, draft: result.draft });
                        const group = result.draft.mediaPlan?.manifest.assets[language] ?? [];
                        announce({
                          kind: "success",
                          text: S.activities.bookWords.refreshed(
                            group.length - withoutBookWords(group).length,
                          ),
                        });
                      })
                    }
                    onAskModel={(words) => startRun("generate-phonemes", { language, words })}
                    canRecord={
                      editable &&
                      available &&
                      !busy &&
                      pipelineBlocked === null &&
                      !codingAgentId &&
                      !!selectedAgent
                    }
                    onRecord={() => runStages("words", { language })}
                    onUseSounds={(runId) =>
                      void action(async () => {
                        const before = wordsWithoutSounds(
                          detail.draft.mediaPlan?.manifest.assets[language] ?? [],
                        ).length;
                        const draft = await apiFetch<ActivityDraft>(
                          `${endpoint}/runs/${encodeURIComponent(runId)}/accept-phonemes`,
                          {
                            method: "POST",
                            body: { expectedRevision: detail.draft.contentRevision },
                          },
                        );
                        if (!alive.current) return;
                        accept({ ...detail, draft });
                        const after = wordsWithoutSounds(
                          draft.mediaPlan?.manifest.assets[language] ?? [],
                        ).length;
                        announce({
                          kind: "success",
                          text: S.activities.bookWords.accepted(before - after),
                        });
                      })
                    }
                  />
                )}
                {section === "speech" && editedManifest && (
                  <SpeechCoverage
                    assets={withoutBookWords(editedManifest.assets[language] ?? [])}
                    language={language}
                    editable={editable}
                    canGenerate={
                      editable &&
                      available &&
                      !busy &&
                      !running &&
                      !dirty &&
                      !!selectedAgent &&
                      !codingAgentId
                    }
                    onSelect={(key) => {
                      const usage = (editedManifest.assets[language] ?? [])
                        .find((entry) => entry.key === key)
                        ?.usages.map((entry) => entry.sceneId)[0];
                      // A narration is only in the tree while the filter admits audio, and
                      // a filter left on images would drop the selection and open whatever
                      // came first instead.
                      setKind((current) => (current === "all" ? current : "audio"));
                      setSelected({ sceneId: usage ?? "", key });
                      setBoard(false);
                      setSection("scenes");
                    }}
                    onGenerateAll={(keys) => setSpeechQueue({ language, voice: bulkVoice, keys })}
                    queued={speechQueue?.keys.length ?? 0}
                    onCancelQueue={() => setSpeechQueue(null)}
                    runs={runs}
                    languages={Object.entries(editedManifest.assets).map(([code, group]) => {
                      const tally = speechTally(withoutBookWords(group), runs, code);
                      return { language: code, ready: tally.ready, total: tally.total };
                    })}
                    onLanguage={setLanguage}
                    voices={voiceOptions}
                    voice={bulkVoice}
                    onVoice={setBulkVoice}
                    voiceDisabled={busy || !available || running || pipelineRunning}
                    speechProviders={speechProviders}
                    onApplyProviderToAll={(provider: SpeechProviderId) => {
                      const updated = structuredClone(editedManifest);
                      const count = applyProvider(
                        updated.assets[language] ?? [],
                        provider,
                        voiceOptions,
                      );
                      if (!count) return;
                      setMedia(pretty(updated));
                      void save("media", true, updated).then((ok) => {
                        if (ok && alive.current)
                          announce({
                            kind: "success",
                            text: S.activities.speechProvider.applied(count),
                          });
                      });
                    }}
                    onApplyVoiceToAll={(voice) => {
                      const updated = structuredClone(editedManifest);
                      const group = updated.assets[language] ?? [];
                      // A voice belongs to one provider, which comes with it.
                      const owner =
                        voiceOptions.find((option) => option.id === voice)?.providerId ??
                        (isElevenLabsVoiceId(voice) ? "elevenlabs" : "gemini");
                      if (sharedProvider(group) !== owner)
                        applyProvider(group, owner, voiceOptions);
                      const count = applyVoice(group, voice);
                      if (!count) return;
                      // The choice shows at once and stays in the editor if the save fails.
                      setMedia(pretty(updated));
                      void save("media", true, updated).then((ok) => {
                        if (ok && alive.current)
                          announce({
                            kind: "success",
                            text: S.activities.voicePicker.applied(count),
                          });
                      });
                    }}
                    sources={
                      language === languageSetup.defaultLanguage
                        ? undefined
                        : new Map(
                            (editedManifest.assets[languageSetup.defaultLanguage] ?? [])
                              .filter((asset) => asset.type === "audio" && asset.script)
                              .map((asset) => [asset.key, asset.script!]),
                          )
                    }
                    onTranslate={(key) =>
                      startRun("generate-media-text", { language, assetKey: key, translate: true })
                    }
                    onTranslateAll={() => runStages("translations", { language })}
                    soundProvider={
                      soundProviders
                        ? bulkSoundProvider(
                            soundProviders,
                            pendingSoundKinds(
                              editedManifest.assets[language] ?? [],
                              runs,
                              language,
                            ),
                          )
                        : undefined
                    }
                    onGenerateSounds={(provider) => runStages("sounds", { language }, provider)}
                    onTranslateAndSpeak={(key) =>
                      runStages("narration", { language, ...(key ? { assetKey: key } : {}) })
                    }
                    addable={languageSetup.languages
                      .filter(
                        (entry) =>
                          entry.code !== languageSetup.defaultLanguage &&
                          !(entry.code in editedManifest.assets),
                      )
                      .map((entry) => ({ code: entry.code, label: entry.label }))}
                    onAddLanguage={(code) =>
                      void action(async () => {
                        const draft = await apiFetch<ActivityDraft>(`${endpoint}/languages`, {
                          method: "POST",
                          body: { language: code, expectedRevision: detail.draft.contentRevision },
                        });
                        if (!alive.current) return;
                        accept({ ...detail, draft });
                        setLanguage(code);
                      })
                    }
                    onRetry={(key) =>
                      startRun("generate-audio", {
                        language,
                        assetKey: key,
                        ...speechChoice(
                          editedManifest.assets[language]?.find((asset) => asset.key === key),
                          voiceOptions,
                          bulkVoice,
                        ),
                      })
                    }
                  />
                )}
                {section === "library" && (
                  <AssetLibraryView
                    assets={editedManifest?.assets[language] ?? []}
                    uploads={uploads}
                    uploadsLoading={uploadsLoading}
                    endpoint={endpoint}
                    onOpen={(key) => {
                      const usage = (editedManifest?.assets[language] ?? []).find(
                        (entry) => entry.key === key,
                      )?.usages[0]?.sceneId;
                      setKind("all");
                      setSelected({ sceneId: usage ?? "", key });
                      setBoard(false);
                      setSection("scenes");
                    }}
                  />
                )}
                {section === "features" && (
                  <ImplementationFeaturesView
                    endpoint={endpoint}
                    editable={editable && available}
                  />
                )}
                {section === "stats" && (
                  <ActivityStatsView endpoint={endpoint} revision={detail.draft.contentRevision} />
                )}
                {(section === "configuration" || section === "assessment") && (
                  <ModuleDocumentView
                    // One editor per document, so unsaved text never carries to the other kind.
                    key={section}
                    endpoint={endpoint}
                    kind={section}
                    revision={detail.draft.contentRevision}
                    editable={editable && available}
                    onSaved={(draft, text) => {
                      // Only the draft changed; unsaved script or specification text stays.
                      setDetail((current) => (current ? { ...current, draft } : current));
                      announce({ kind: "success", text });
                    }}
                    generation={
                      section === "assessment"
                        ? {
                            refNum: detail.refNum,
                            usesAssessment,
                            runs,
                            blocked:
                              running || pipelineRunning
                                ? S.activities.studioRun.otherRun
                                : !selectedAgent
                                  ? S.activities.studioRun.noAgent
                                  : null,
                            onGenerate: () => startRun("generate-assessment", {}),
                            onAccept: (runId) =>
                              void action(async () => {
                                const draft = await apiFetch<ActivityDraft>(
                                  `${endpoint}/runs/${encodeURIComponent(runId)}/accept-assessment`,
                                  {
                                    method: "POST",
                                    body: { expectedRevision: detail.draft.contentRevision },
                                  },
                                );
                                if (!alive.current) return;
                                // Only the draft changed; unsaved script or specification text stays.
                                setDetail((current) => (current ? { ...current, draft } : current));
                                announce({
                                  kind: "success",
                                  text: S.activities.assessment.accepted,
                                });
                              }),
                          }
                        : undefined
                    }
                  />
                )}
                {section === "module" && (
                  <>
                    <BuildPanel
                      endpoint={endpoint}
                      revision={detail.draft.contentRevision}
                      wafRoot={wafRoot}
                      runs={runs}
                      unsaved={dirty}
                      proposalOpen={!!proposal.read?.proposal?.changes.length}
                    >
                      {(blocked) =>
                        editable && (
                          <div className="space-y-3">
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
                                blocked ||
                                busy ||
                                running ||
                                dirty ||
                                !selectedAgent ||
                                detail.draft.status !== "valid" ||
                                !detail.draft.spec ||
                                (detail.activityType === "book" &&
                                  (!bookMode || !detail.draft.mediaPlan))
                              }
                              onClick={() =>
                                void action(async () => {
                                  const run = await apiFetch<ActivityRun>(
                                    `${endpoint}/assemble-module`,
                                    {
                                      method: "POST",
                                      body: {
                                        ...runner,
                                        expectedRevision: detail.draft.contentRevision,
                                        wafRoot: wafRoot.trim() || undefined,
                                        ...(detail.activityType === "book" ? { bookMode } : {}),
                                      },
                                    },
                                  );
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
                        )
                      }
                    </BuildPanel>
                    {available && (
                      <QualityChecksView
                        endpoint={endpoint}
                        runs={runs}
                        editable={editable}
                        onStarted={(run) => {
                          setRuns((previous) => [
                            summarize(run),
                            ...previous.filter((item) => item.runId !== run.runId),
                          ]);
                          setRefreshVersion((value) => value + 1);
                        }}
                      />
                    )}
                    {available && (
                      <TestResultsView
                        endpoint={endpoint}
                        runs={runs}
                        editable={editable}
                        runner={selectedAgent ? runner : null}
                        revision={detail.draft.contentRevision}
                        unsaved={dirty}
                        onStarted={(run) => {
                          setRuns((previous) => [
                            summarize(run),
                            ...previous.filter((item) => item.runId !== run.runId),
                          ]);
                          setRefreshVersion((value) => value + 1);
                        }}
                      />
                    )}
                    <SandboxPanel
                      projectId={projectId}
                      activityId={detail.id}
                      spec={detail.draft.spec}
                      languages={Object.keys(detail.draft.mediaPlan?.manifest.assets ?? {})}
                    />
                    {available && (
                      <ModulePreview
                        runs={runs}
                        spec={detail.draft.spec}
                        languages={Object.keys(detail.draft.mediaPlan?.manifest.assets ?? {})}
                        stale={(() => {
                          const moduleRun = latestModuleRun(runs);
                          return Boolean(
                            moduleRun && moduleRun.inputRevision !== detail.draft.contentRevision,
                          );
                        })()}
                      />
                    )}
                  </>
                )}
                {section === "newRef" && available && (
                  <CreateRefView
                    key={detail.id}
                    base={basePath(projectId)}
                    endpoint={endpoint}
                    template={detail}
                    editable={editable}
                    voices={voiceOptions}
                    uploads={uploads}
                    uploadsLoading={uploadsLoading}
                    agents={agents}
                    defaultAgent={currentAgent?.agentId ?? ""}
                    wafRoot={wafRoot}
                    onIdentity={(record) => {
                      setDetail((current) => (current ? { ...current, ...record } : current));
                      void onSaved();
                    }}
                    onOpenAssessment={() => setSection("assessment")}
                    onCreated={(made, problem) => {
                      announce(
                        problem
                          ? {
                              kind: "attention",
                              text: S.activities.createRef.createdWithProblem(made.refNum, problem),
                            }
                          : { kind: "success", text: S.activities.createRef.created(made.refNum) },
                      );
                      void onSaved();
                      navigate(`/activities/${encodeURIComponent(made.id)}?section=scenes`);
                    }}
                  />
                )}
                {section === "deploy" && available && (
                  <DeployPanel
                    key={detail.id}
                    endpoint={endpoint}
                    productCode={detail.productCode}
                    editable={editable}
                    pinnedBuild={Boolean(detail.draft.pinnedModuleRunId)}
                    onAnnounce={announce}
                  />
                )}
                {section === "history" && available && (
                  <GenerationHistory
                    runs={runs}
                    draftRevision={detail.draft.contentRevision}
                    endpoint={endpoint}
                    editable={editable}
                    busy={busy}
                    onCancel={(runId) =>
                      void action(async () => {
                        const result = await apiFetch<ActivityRun>(
                          `${endpoint}/runs/${runId}/cancel`,
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
                    onAnnounce={announce}
                    unsaved={dirty}
                    onRestored={(draft) =>
                      accept({
                        ...detail,
                        title: draft.status === "valid" ? String(draft.spec?.title) : detail.title,
                        draft,
                      })
                    }
                    pinnedModuleRunId={detail.draft.pinnedModuleRunId}
                    onDraft={(draft) =>
                      // A pin changes only which build the preview plays; unsaved text stays.
                      setDetail((current) => (current ? { ...current, draft } : current))
                    }
                    onUseCandidate={(candidate) =>
                      discard.ask(() => {
                        setSpec(candidate);
                        setSpecOpen(true);
                      })
                    }
                  />
                )}
                {section === "specification" && editedManifest && detail.draft.mediaPlan && (
                  <>
                    <ul className="space-y-1 text-xs">
                      {Object.entries(detail.draft.mediaPlan?.manifest.assets).map(
                        ([language, assets]) => (
                          <li key={language}>
                            {language}:{" "}
                            {S.activities.mediaCounts(
                              assets.length,
                              assets.filter((asset) => !!asset.path).length,
                            )}
                          </li>
                        ),
                      )}
                    </ul>
                    <details
                      className="space-y-2"
                      open={mediaOpen}
                      onToggle={(event) => setMediaOpen(event.currentTarget.open)}
                    >
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
                          busy ||
                          !media.trim() ||
                          media === pretty(detail.draft.mediaPlan?.manifest)
                        }
                        onClick={() => void save("media")}
                      >
                        {S.activities.saveMedia}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        )}
      </WorkspaceShell>
      {discard.modal}
    </>
  );
}

function fail(message: string): never {
  throw new Error(message);
}

function summarize({ candidate, ...run }: ActivityRun): ActivityRunSummary {
  return { ...run, hasCandidate: candidate !== null };
}
