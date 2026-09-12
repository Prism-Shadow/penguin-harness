/**
 * Evaluation Center: every Benchmark of the Project as one card, with the loop a novice needs
 * spelled out in a standing block under the title — write the cases, evaluate an agent on them,
 * optimize it against the scores. A Benchmark sits beside the agents rather than under one, so
 * the page is a flat list and the agents a card names are the ones its scoreboard has tested.
 * Each card carries the newest Score with its change against the previous record of the same
 * label, a sparkline of the scoreboard, when it was last evaluated, and its actions; opening one
 * enters the Benchmark's own page (`/benchmark/:benchmarkId`) instead of splitting this one in
 * two, the way an Agent's card enters its settings. `?agentId=` narrows the list to the
 * Benchmarks that tested that Agent.
 */
import { Fragment, useEffect, useState } from "react";
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
import { CreateBenchmarkModal } from "./create-benchmark-modal";
import { ScoreSparkline } from "./score-sparkline";
import { UseBenchmarkModal } from "./use-benchmark-modal";

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
 * The loop, standing under the title: three steps side by side (stacked on a narrow screen),
 * each naming the Skill it rests on, then one line on the order to walk them in. It does not
 * collapse and cannot be dismissed — evaluating an agent is something a user does a few times
 * a year, and a disclosure that has to be found again every time is worse than four calm lines.
 */
function GuideFlow() {
  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400">
      <div className="flex flex-col gap-2 md:flex-row md:gap-3">
        {S.benchmark.guideFlow.map((step, i) => (
          <Fragment key={step.skill}>
            {/* The order is already in the numbers, so the arrow is decoration: it points
                along the axis the steps are laid out on and is hidden from the reader. */}
            {i > 0 && (
              <span
                aria-hidden="true"
                className="shrink-0 self-start text-gray-300 md:self-center dark:text-gray-600"
              >
                <span className="hidden md:inline">{"\u2192"}</span>
                <span className="md:hidden">{"\u2193"}</span>
              </span>
            )}
            <div className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-mono tabular-nums text-gray-400 dark:text-gray-500">
                  {i + 1}
                </span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">{step.title}</span>
                <code className="min-w-0 truncate font-mono text-gray-400 dark:text-gray-500">
                  {step.skill}
                </code>
              </span>
              <p className="mt-1 leading-relaxed">{step.text}</p>
            </div>
          </Fragment>
        ))}
      </div>
      <p className="mt-3 border-t border-gray-200 pt-2 leading-relaxed dark:border-gray-800">
        {S.benchmark.guideHowTo}
      </p>
      <p className="mt-1 leading-relaxed">{S.benchmark.guideNote}</p>
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
 * nested block.
 */
function BenchmarkCard({
  benchmark,
  locale,
  nameOf,
  canDelete,
  onOpen,
  onUse,
  onDelete,
}: {
  benchmark: BenchmarkSummary;
  locale: "zh" | "en";
  nameOf: (agentId: string) => string;
  canDelete: boolean;
  onOpen: () => void;
  onUse: () => void;
  onDelete: () => void;
}) {
  const latest = latestWithDelta(benchmark.evaluations);
  const series = sparklineSeries(benchmark.evaluations);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900">
      <button type="button" onClick={onOpen} className="min-w-[14rem] flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-base font-bold">{benchmark.title}</span>
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
      <div className="w-16 shrink-0 text-right">
        {latest ? (
          <>
            <span
              className="block font-mono text-sm font-semibold tabular-nums"
              title={S.benchmark.latestScoreLabel}
            >
              {formatScore(latest.score)}
            </span>
            <span className={`block truncate text-[11px] tabular-nums ${deltaTone(latest.delta)}`}>
              {latest.delta === null
                ? S.benchmark.firstEvaluation
                : latest.delta === 0
                  ? "0"
                  : signedDelta(formatScore(latest.delta))}
            </span>
          </>
        ) : (
          <span className="block text-xs text-gray-400 dark:text-gray-500">
            {S.benchmark.notEvaluated}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* One dialog behind "Use", opened on its Evaluate tab: evaluating an agent is what a
            Benchmark is for, and optimizing it is the tab next door. */}
        <Button size="sm" variant="primary" onClick={onUse}>
          {S.benchmark.use}
        </Button>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          {S.benchmark.view}
        </Button>
        {canDelete && (
          <Button
            size="icon"
            variant="danger"
            title={S.benchmark.deleteBenchmark}
            aria-label={S.benchmark.deleteBenchmark}
            onClick={onDelete}
          >
            <GlyphIcon d={TRASH_ICON} size={ICON_SIZE.iconButton} />
          </Button>
        )}
      </div>
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
  const { locale } = useLocale();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  // ?agentId= (entered from an Agent): the list narrows to the Benchmarks that tested it.
  const [searchParams, setSearchParams] = useSearchParams();
  const filterAgentId = searchParams.get("agentId");

  const [benchmarks, setBenchmarks] = useState<BenchmarkSummary[] | null>(null);
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

  // Benchmarks belong to the Project, so the page reads one list — and a Project change starts
  // it over rather than showing the previous Project's cards while the next list is in flight.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setBenchmarks(null);
    setError(null);
    api
      .listBenchmarks(projectId)
      .then((data) => {
        if (!cancelled) setBenchmarks(data.benchmarks);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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

  const benchmarkOf = (benchmarkId: string | null): BenchmarkSummary | null =>
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
      setBenchmarks((prev) => (prev ?? []).filter((b) => b.id !== benchmarkId));
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
        action={<CreateButtons size="sm" onAi={openAi} onManual={() => setManualOpen(true)} />}
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
            canDelete={isOwner}
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
        {/* The title row and the flow block under it share one block, so the gap below stays
            one gap — the Agents and Models headers have the same shape. */}
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
              <CreateButtons size="sm" onAi={openAi} onManual={() => setManualOpen(true)} />
            </div>
          </div>
          <GuideFlow />
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
