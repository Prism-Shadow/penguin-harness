/**
 * Evaluation Center: every Benchmark of the Project as one card, with the loop a novice needs
 * spelled out in a standing block under the title — write the cases, evaluate an agent on them,
 * optimize it against the scores. A Benchmark sits beside the agents rather than under one, so
 * the page is a flat list and the agents a card names are the ones its scoreboard has tested.
 * Each card carries the newest Score with its change against the previous record of the same
 * label, a sparkline of the scoreboard, when it was last evaluated, and its actions; opening one
 * enters the Benchmark's own page (`/benchmark/:benchmarkId`) instead of splitting this one in
 * two, the way an Agent's card enters its settings. `?agentId=` narrows the list to the
 * Benchmarks that tested that Agent. The list is read off this server and every machine it holds
 * (benchmark-sources.ts): a Benchmark written on a machine is listed too, under its id.
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type {
  AgentSummary,
  BenchmarkSummary,
  ModelsResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatRelativeShort, formatScore, signedDelta } from "../../lib/format";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { STAT_ICONS } from "../../lib/stat-icons";
import { toneInk } from "../../lib/tone";
import { agentDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import type { MergedBenchmark } from "../../lib/benchmark-merge";
import { nameOnMachine } from "../../lib/workspace-machines";
import { useLocale } from "../../state/locale";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Skeleton, SkeletonCard } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { AiCreateModal, CreateButtons, pickDefaultAgent } from "../ai-create";
import { latestWithDelta, matchesBenchmarkQuery, sparklineSeries } from "./benchmark-metrics";
import { benchmarkCreateExamples, benchmarkCreateTail } from "./benchmark-prompts";
import { benchmarkRoute } from "./benchmark-route";
import { fetchBenchmarks } from "./benchmark-sources";
import { CreateBenchmarkModal } from "./create-benchmark-modal";
import { ScoreSparkline } from "./score-sparkline";
import { UseBenchmarkModal } from "./use-benchmark-modal";

/** The Skills a design conversation is opened with (see the create modal below). */
const BENCHMARK_DESIGN_SKILLS = ["benchmark-design", "agent-evaluation"];

/** Delete (trash can), the same card-row mark the Agents list carries. */
const TRASH_ICON =
  "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7m4 4v6m4-6v6";

/** How many tested Agents a card names before the rest fold into a "+n". */
const AVATARS_SHOWN = 3;

function deltaTone(delta: number | null): string {
  if (delta === null || delta === 0) return toneInk.muted;
  return delta > 0 ? toneInk.success : toneInk.danger;
}

/**
 * The page's pair of create entry points, in its header and in its empty state alike. Creating
 * with AI opens a conversation, which any member of the Project may start; creating by hand posts
 * the cases for the server to write under the Project's `benchmarks/`, which only the owner may
 * do (the route answers anyone else with 403). So a member is offered the AI button by itself,
 * the way the scheduled-tasks tab offers it.
 */
export function BenchmarkCreateButtons({
  isOwner,
  onAi,
  onManual,
}: {
  isOwner: boolean;
  onAi: () => void;
  onManual: () => void;
}) {
  return <CreateButtons size="sm" onAi={onAi} {...(isOwner ? { onManual } : {})} />;
}

/**
 * The three steps of the loop, a card each: three across from `md` up, stacked below. Every card
 * names its step and says where on this page to do it — the create buttons at the top right,
 * Use → Evaluate and Use → Optimize on a Benchmark — and nothing else stands above or beside
 * them: the maintainer wants the three stages alone, without a how-to line or the Skill names
 * in grey. Nothing is drawn between the cards — the numbers already carry the order, and an
 * arrow would only survive one of the two layouts. A member's first card leaves out Create
 * manually, since the header does not offer it to them.
 */
function GuideSteps({ isOwner }: { isOwner: boolean }) {
  return (
    <div className="mt-3 grid md:grid-cols-3 gap-3">
      {S.benchmark.guideFlow.map((step, i) => (
        <div
          key={step.title}
          className="min-w-0 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400"
        >
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-mono tabular-nums text-gray-400 dark:text-gray-500">{i + 1}</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{step.title}</span>
          </span>
          <p className="mt-1 leading-relaxed">
            {i === 0 && !isOwner ? S.benchmark.guideCreateMember : step.text}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * The Agents a Benchmark has scored, newest scoreboard order first: three tiles and a "+n" for
 * the rest. The names are in the group's tooltip rather than beside each tile — a card that
 * tested five agents would otherwise be a list of names with a Benchmark somewhere in it.
 */
function TestedAgents({
  agentIds,
  nameOf,
}: {
  agentIds: readonly string[];
  nameOf: (agentId: string) => string;
}) {
  if (agentIds.length === 0) return null;
  const shown = agentIds.slice(0, AVATARS_SHOWN);
  const rest = agentIds.length - shown.length;
  return (
    <div
      className="hidden shrink-0 items-center gap-1 sm:flex"
      title={`${S.benchmark.testedAgents}: ${agentIds.map(nameOf).join(", ")}`}
    >
      {shown.map((agentId) => (
        <AgentAvatar
          key={agentId}
          id={agentId}
          name={nameOf(agentId)}
          size={ICON_SIZE.rowLead}
          className="shrink-0 rounded"
        />
      ))}
      {rest > 0 && (
        <span className="text-[11px] tabular-nums text-gray-400 dark:text-gray-500">+{rest}</span>
      )}
    </div>
  );
}

/**
 * One Benchmark in the Agents list's card shape: an info column of title, description and stats,
 * then the Agents it has tested, the sparkline, the newest Score with its change from the
 * previous record of the same label, and the actions. The info column is the card's main button
 * — it enters the Benchmark's page — so everything inside it is phrasing content rather than a
 * nested block. A card that is not published is masked under a notice — still being built for a
 * draft, creation failed for a Benchmark whose calibration never finished — with only the delete
 * icon left live.
 */
export function BenchmarkCard({
  benchmark,
  locale,
  nameOf,
  machineName,
  canDelete,
  onOpen,
  onUse,
  onDelete,
}: {
  benchmark: BenchmarkSummary;
  locale: "zh" | "en";
  nameOf: (agentId: string) => string;
  /** The ssh alias of the one machine that holds this Benchmark, or null when this server has it. */
  machineName: string | null;
  canDelete: boolean;
  onOpen: () => void;
  onUse: () => void;
  onDelete: () => void;
}) {
  const latest = latestWithDelta(benchmark.evaluations);
  const series = sparklineSeries(benchmark.evaluations);
  // A Benchmark that is not published is masked and inert: a draft is still being written and
  // calibrated by the agent, and a failed one never finished calibrating and can only be thrown
  // away. Only the owner's delete stays above the mask, which is how either is cleaned up.
  const masked = benchmark.status !== "published";
  const failed = benchmark.status === "failed";
  // Deleting and creating again is a failed Benchmark's only way out, and the hint names that
  // step only to a viewer who has the delete button beside it.
  const failedHint = canDelete
    ? S.benchmark.creationFailedHint
    : S.benchmark.creationFailedHintMember;
  return (
    <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900">
      <button
        type="button"
        onClick={onOpen}
        disabled={masked}
        className="min-w-[14rem] flex-1 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-base font-bold">
            {machineName !== null ? nameOnMachine(benchmark.title, machineName) : benchmark.title}
          </span>
          <span className="hidden shrink-0 font-mono text-xs text-gray-400 md:inline dark:text-gray-500">
            {benchmark.id}
          </span>
        </span>
        {/* An empty description still takes its line, so the cards keep one height. */}
        <span className="mt-1.5 block min-h-4 truncate text-xs text-gray-500 dark:text-gray-400">
          {benchmark.description ?? ""}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span className="shrink-0">{S.benchmark.caseCount(benchmark.caseCount)}</span>
          <span className="shrink-0">{S.benchmark.runsPerCase(benchmark.runs ?? 1)}</span>
          {latest && (
            <span
              className={`inline-flex shrink-0 items-center ${ICON_GAP.tight}`}
              title={S.benchmark.lastEvaluated(formatRelativeShort(latest.time, locale))}
            >
              <GlyphIcon d={STAT_ICONS.elapsed} size={ICON_SIZE.inlineGlyph} />
              {formatRelativeShort(latest.time, locale)}
            </span>
          )}
        </span>
      </button>
      <TestedAgents agentIds={benchmark.agentIds} nameOf={nameOf} />
      {series.length > 0 && (
        <div className="hidden shrink-0 md:block">
          <ScoreSparkline values={series} label={S.benchmark.sparklineLabel(series.length)} />
        </div>
      )}
      {/* At least a score's width, and as wide as its label beyond that: the label is a phrase
          ("first evaluation", "Not evaluated yet") that runs longer than a score in English,
          and cut short or broken over lines it stops reading as one. */}
      <div className="min-w-16 shrink-0 text-right">
        {latest ? (
          <>
            <span
              className="block font-mono text-sm font-semibold tabular-nums"
              title={S.benchmark.latestScoreLabel}
            >
              {formatScore(latest.score)}
            </span>
            <span
              className={`block whitespace-nowrap text-[11px] tabular-nums ${deltaTone(latest.delta)}`}
            >
              {latest.delta === null
                ? S.benchmark.firstEvaluation
                : latest.delta === 0
                  ? "0"
                  : signedDelta(formatScore(latest.delta))}
            </span>
          </>
        ) : (
          <span className="block whitespace-nowrap text-xs text-gray-400 dark:text-gray-500">
            {S.benchmark.notEvaluated}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* One dialog behind "Use", opened on its Evaluate tab: evaluating an agent is what a
            Benchmark is for, and optimizing it is the tab next door. */}
        <Button size="sm" variant="primary" onClick={onUse} disabled={masked}>
          {S.benchmark.use}
        </Button>
        <Button size="sm" variant="ghost" onClick={onOpen} disabled={masked}>
          {S.benchmark.view}
        </Button>
        {canDelete && (
          <Button
            size="icon"
            variant="danger"
            title={S.benchmark.deleteBenchmark}
            aria-label={S.benchmark.deleteBenchmark}
            onClick={onDelete}
            className={masked ? "relative z-10" : undefined}
          >
            <GlyphIcon d={TRASH_ICON} size={ICON_SIZE.iconButton} />
          </Button>
        )}
      </div>
      {masked && (
        <div
          role="note"
          title={failed ? failedHint : S.benchmark.buildingHint}
          className="absolute inset-0 flex cursor-not-allowed flex-col items-center justify-center gap-1 rounded-md bg-white/75 px-4 text-center backdrop-blur-[1px] dark:bg-gray-900/75"
        >
          {/* A failed creation is the one thing here the user has to act on, so its title takes
              the danger ink; the line under it stays secondary text either way. */}
          <span
            className={`text-sm font-medium ${failed ? toneInk.danger : "text-gray-700 dark:text-gray-200"}`}
          >
            {failed ? S.benchmark.creationFailed : S.benchmark.building}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {failed ? failedHint : S.benchmark.buildingHint}
          </span>
        </div>
      )}
    </div>
  );
}

/** Card-shaped placeholders, so nothing shifts when the fetch lands. */
function CardSkeletons({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonCard key={i} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
          <div className="min-w-[14rem] flex-1">
            <Skeleton className="h-[18px] w-40" />
            <Skeleton className="mt-1.5 h-4 w-2/3" />
            <Skeleton className="mt-1.5 h-4 w-48" />
          </div>
          <Skeleton className="hidden h-9 w-24 md:block" />
          <Skeleton className="h-8 w-44" />
        </SkeletonCard>
      ))}
    </div>
  );
}

export function BenchmarkPage() {
  useDocumentTitle(S.benchmark.title);
  const navigate = useNavigate();
  const { currentProject, currentAgent, agents } = useProject();
  const { machineIds, machineLabels } = useSessions();
  const { locale } = useLocale();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  // ?agentId= (entered from an Agent): the list narrows to the Benchmarks that tested it.
  const [searchParams, setSearchParams] = useSearchParams();
  const filterAgentId = searchParams.get("agentId");

  const [benchmarks, setBenchmarks] = useState<MergedBenchmark[] | null>(null);
  /** Bumped to read the list again — after a delete that leaves a machine's copy behind. */
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTarget, setAiTarget] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  /** The Benchmark whose Use dialog is open, if any. */
  const [using, setUsing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Benchmarks belong to the Project, so the page reads one list, merged over this server and
  // the machines it holds — and a Project change starts it over rather than showing the previous
  // Project's cards while the next list is in flight. A machine that connects re-asks.
  const machinesKey = machineIds.join(",");
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setBenchmarks(null);
    setError(null);
    fetchBenchmarks(projectId, machinesKey === "" ? [] : machinesKey.split(","))
      .then((merged) => {
        if (!cancelled) setBenchmarks(merged);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, machinesKey, reload]);

  // The Project's models, for the Use dialog's conversation-model picker; a failure just
  // leaves the picker at the Project default.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .getModels(projectId)
      .then((res) => {
        if (!cancelled) setModels(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId) return null;

  const agentOf = (agentId: string): AgentSummary | undefined =>
    agents.find((a) => a.agentId === agentId);
  /** The ssh alias of a machine, or null for this server. An unlabelled machine falls back to its id. */
  const machineNameOf = (machineId: string | null): string | null =>
    machineId === null ? null : (machineLabels.get(machineId) ?? machineId);
  const nameOf = (agentId: string): string => {
    const agent = agentOf(agentId);
    return agent ? agentDisplayName(agent) : agentId;
  };

  const fallbackAgent = currentAgent?.agentId ?? pickDefaultAgent(agents)?.agentId ?? "";
  const openAi = () => {
    setAiTarget(filterAgentId ?? fallbackAgent);
    setAiOpen(true);
  };
  const open = (benchmarkId: string) => navigate(benchmarkRoute(benchmarkId));
  const clearAgentFilter = () =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("agentId");
        return next;
      },
      { replace: true },
    );

  const benchmarkOf = (benchmarkId: string | null): MergedBenchmark | null =>
    benchmarkId === null ? null : (benchmarks?.find((b) => b.id === benchmarkId) ?? null);
  const usingBenchmark = benchmarkOf(using);
  const deletingBenchmark = benchmarkOf(deleting);

  const confirmDelete = async () => {
    if (deleting === null) return;
    const benchmarkId = deleting;
    setDeleteBusy(true);
    try {
      await api.deleteBenchmark(projectId, benchmarkId);
      toastSuccess(S.benchmark.deleted);
      // Delete removes this server's directory; a copy a machine holds is still a Benchmark.
      if (deletingBenchmark !== null && deletingBenchmark.machineIds.length > 1) {
        setReload((n) => n + 1);
      } else {
        setBenchmarks((prev) => (prev ?? []).filter((b) => b.id !== benchmarkId));
      }
      setDeleting(null);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const rows = (benchmarks ?? [])
    .filter((b) => filterAgentId === null || b.agentIds.includes(filterAgentId))
    .filter((b) => matchesBenchmarkQuery(b, agents, query));

  let body;
  if (error !== null) {
    body = <p className={`px-1 text-xs ${toneInk.danger}`}>{error}</p>;
  } else if (benchmarks === null) {
    body = <CardSkeletons rows={4} />;
  } else if (benchmarks.length === 0) {
    body = (
      <EmptyState
        title={S.benchmark.emptyTitle}
        description={S.benchmark.emptyDescription}
        action={
          <BenchmarkCreateButtons
            isOwner={isOwner}
            onAi={openAi}
            onManual={() => setManualOpen(true)}
          />
        }
      />
    );
  } else if (rows.length === 0) {
    body = <EmptyState title={S.benchmark.noMatches} />;
  } else {
    body = (
      <div className="space-y-3">
        {rows.map((b) => (
          <BenchmarkCard
            key={b.id}
            benchmark={b}
            locale={locale}
            nameOf={nameOf}
            machineName={b.machineIds.length === 1 ? machineNameOf(b.machineIds[0] ?? null) : null}
            // Only this server's copy can be deleted from here.
            canDelete={isOwner && b.machineIds.includes(null)}
            onOpen={() => open(b.id)}
            onUse={() => setUsing(b.id)}
            onDelete={() => setDeleting(b.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        {/* The title row, the intro block and the step cards share one block, so the gap below
            stays one gap — the Agents and Models headers have the same shape. */}
        <div className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-semibold">{S.benchmark.title}</h1>
            {/* Search plus the two create entry points. Below sm the search box takes a line of
                its own and the pair of buttons wraps under it: three controls sharing a phone's
                width would leave the box too narrow to read what was typed into it. */}
            <div className="flex min-w-0 max-w-full grow flex-wrap items-center gap-2 sm:grow-0">
              <div className="w-full min-w-0 sm:w-56 sm:flex-none">
                <Input
                  size="sm"
                  aria-label={S.benchmark.searchPlaceholder}
                  placeholder={S.benchmark.searchPlaceholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <BenchmarkCreateButtons
                isOwner={isOwner}
                onAi={openAi}
                onManual={() => setManualOpen(true)}
              />
            </div>
          </div>
          <GuideSteps isOwner={isOwner} />
        </div>

        {/* What the address is filtering by, and the way out of it: the list is narrowed by a
            query parameter, which nothing else on the page would otherwise account for. */}
        {filterAgentId !== null && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <AgentAvatar
              id={filterAgentId}
              name={nameOf(filterAgentId)}
              size={ICON_SIZE.rowLead}
              className="shrink-0 rounded"
            />
            <span className="min-w-0 truncate" title={nameOf(filterAgentId)}>
              {S.benchmark.filterByAgent(filterAgentId)}
            </span>
            <Button size="sm" variant="ghost" onClick={clearAgentFilter}>
              {S.benchmark.clearFilter}
            </Button>
          </div>
        )}

        {body}
      </div>

      <AiCreateModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        title={S.benchmark.aiCreateTitle}
        description={S.benchmark.aiCreateDescription}
        agents={agents}
        examples={benchmarkCreateExamples()}
        // The Skills the design conversation rests on, preselected in the composer so the
        // `[use_skills]` block names them on send: the designer's own, and the evaluator it has
        // to delegate every trial evaluation to. An agent that lacks one keeps its list short.
        skills={BENCHMARK_DESIGN_SKILLS}
        {...(aiTarget !== "" ? { tail: benchmarkCreateTail(aiTarget) } : {})}
        intro={
          <Select
            size="sm"
            label={S.benchmark.targetAgent}
            hint={S.benchmark.targetAgentHint}
            value={aiTarget}
            onChange={(e) => setAiTarget(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {agentDisplayName(a)}
              </option>
            ))}
          </Select>
        }
      />
      <CreateBenchmarkModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        projectId={projectId}
        onCreated={(benchmark) => open(benchmark.id)}
      />
      {usingBenchmark && (
        <UseBenchmarkModal
          key={usingBenchmark.id}
          open
          onClose={() => setUsing(null)}
          projectId={projectId}
          benchmark={usingBenchmark}
          agents={agents}
          models={models}
          initialTab="evaluate"
        />
      )}
      <ConfirmModal
        open={deleting !== null}
        title={S.benchmark.deleteBenchmark}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        confirmLabel={S.common.delete}
        busy={deleteBusy}
      >
        <p className="text-sm text-gray-700 dark:text-gray-200">
          {S.benchmark.deleteConfirm(deletingBenchmark?.title ?? deleting ?? "")}
        </p>
      </ConfirmModal>
    </div>
  );
}
