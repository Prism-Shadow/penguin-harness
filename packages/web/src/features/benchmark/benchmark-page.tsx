/**
 * Evaluation Center: every Benchmark of the Project grouped by the Agent it tests, with the
 * loop a novice needs spelled out — create one (an AI prompt or a form), read its scores, hand
 * it to an optimizer. Each Benchmark is a card carrying the newest Score with its change, a
 * sparkline of the scoreboard, when it was last evaluated, and its actions; opening one enters
 * the Benchmark's own page (`/benchmark/:agentId/:benchmarkId`) instead of splitting this one
 * in two, the way an Agent's card enters its settings. `?agentId=` expands only that Agent.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { BenchmarkSummary, ModelsResponse } from "@prismshadow/penguin-server/api";
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
import { writeClipboard } from "../../components/ui/copy-button";
import { Dropdown } from "../../components/ui/dropdown";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { GroupHeader } from "../../components/ui/group-list";
import { HelpFold } from "../../components/ui/help-fold";
import { HAND_ICON, MAGIC_WAND_ICON } from "../../components/ui/icons";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import {
  ELLIPSIS_ICON,
  TRASH_ICON,
  overflowMenuDangerClass,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";
import { Skeleton, SkeletonCard } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { AiCreateModal, CreateButtons, pickDefaultAgent } from "../ai-create";
import { latestScore, matchesBenchmarkQuery, sparklineSeries } from "./benchmark-metrics";
import { benchmarkCreateExamples, benchmarkCreateTail, benchmarkPath } from "./benchmark-prompts";
import { benchmarkRoute } from "./benchmark-route";
import { CreateBenchmarkModal } from "./create-benchmark-modal";
import { OptimizeModal } from "./optimize-modal";
import type { OptimizeMode } from "./optimize-modal";
import { ScoreSparkline } from "./score-sparkline";

/** Where a Benchmark lives: the Agent it tests and its directory name. */
interface BenchmarkRef {
  agentId: string;
  benchmarkId: string;
}

/** An open optimize dialog: which Benchmark, and which way the Skill's inputs get filled. */
type OptimizeTarget = BenchmarkRef & { mode: OptimizeMode };

/** One Agent's fetched list: null benchmarks with a null error means the fetch is in flight. */
interface GroupState {
  benchmarks: BenchmarkSummary[] | null;
  error: string | null;
}

function deltaTone(delta: number | null): string {
  if (delta === null || delta === 0) return toneInk.muted;
  return delta > 0 ? toneInk.success : toneInk.danger;
}

/** The card's overflow menu: copy the directory path, and — for the owner — delete. */
function CardMenu({
  canDelete,
  onCopyPath,
  onDelete,
}: {
  canDelete: boolean;
  onCopyPath: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      className="inline-block"
      portal={{ direction: "down", align: "right" }}
      menuClass="w-48"
      button={
        <Button
          size="icon"
          variant="ghost"
          title={S.benchmark.moreActions}
          aria-label={S.benchmark.moreActions}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <GlyphIcon d={ELLIPSIS_ICON} size={ICON_SIZE.iconButton} filled />
        </Button>
      }
    >
      <div role="menu" className="py-1">
        <button
          type="button"
          role="menuitem"
          className={overflowMenuRowClass}
          onClick={() => run(onCopyPath)}
        >
          {overflowMenuGlyph(STAT_ICONS.copy)}
          {S.benchmark.copyPath}
        </button>
        {canDelete && (
          <button
            type="button"
            role="menuitem"
            className={overflowMenuDangerClass}
            onClick={() => run(onDelete)}
          >
            <span className="shrink-0">
              <GlyphIcon d={TRASH_ICON} size={ICON_SIZE.inlineGlyph} />
            </span>
            {S.benchmark.deleteBenchmark}
          </button>
        )}
      </div>
    </Dropdown>
  );
}

/**
 * One Benchmark in its Agent's group, in the Agents list's card shape: an info column of title,
 * description and stats, then the sparkline, the newest Score with its change from the previous
 * one, and the actions. The info column is the card's main button — it enters the Benchmark's
 * page — so everything inside it is phrasing content rather than a nested block.
 */
function BenchmarkCard({
  benchmark,
  locale,
  canDelete,
  onOpen,
  onOptimize,
  onCopyPath,
  onDelete,
}: {
  benchmark: BenchmarkSummary;
  locale: "zh" | "en";
  canDelete: boolean;
  onOpen: () => void;
  onOptimize: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
}) {
  const latest = latestScore(benchmark.evaluations);
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
        {/* An empty description still takes its line, so cards of a group keep one height. */}
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
      <div className="flex shrink-0 items-center gap-2">
        {/*
          A card holds one control, not the pair the wider surfaces offer, so this one takes the
          manual path — the form, where every input is visible before anything is sent. The AI
          path is one click away in the Benchmark's own page.
        */}
        <Button size="sm" title={S.benchmark.optimizeManual} onClick={onOptimize}>
          <GlyphIcon d={HAND_ICON} />
          {S.benchmark.optimize}
        </Button>
        <Button size="sm" onClick={onOpen}>
          {S.benchmark.view}
        </Button>
        <CardMenu canDelete={canDelete} onCopyPath={onCopyPath} onDelete={onDelete} />
      </div>
    </div>
  );
}

/** Card-shaped placeholders, so nothing shifts when a group's fetch lands. */
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
  const { currentProject, currentAgent, agents, agentsLoading } = useProject();
  const { locale } = useLocale();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  // ?agentId= (entered from an Agent's settings): only that Agent's group starts expanded.
  const [searchParams] = useSearchParams();
  const focusAgentId = searchParams.get("agentId");

  const [groups, setGroups] = useState<Record<string, GroupState>>({});
  // Agents whose group is in the opposite state from its default (all open, or only the focused one).
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTarget, setAiTarget] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualAgent, setManualAgent] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState<OptimizeTarget | null>(null);
  const [deleting, setDeleting] = useState<BenchmarkRef | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const defaultOpen = useCallback(
    (agentId: string) => focusAgentId === null || focusAgentId === agentId,
    [focusAgentId],
  );
  const isOpen = (agentId: string) => defaultOpen(agentId) !== toggled.has(agentId);
  const toggle = (agentId: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });

  // A Project change starts everything over.
  useEffect(() => {
    setGroups({});
    setToggled(new Set());
    setModels(null);
  }, [projectId]);

  // Every Agent's list is fetched up front: the search box and the counts need them all. The
  // join keeps the effect keyed on the set of ids, not the array identity the provider hands
  // out on every reload.
  const agentIds = agents.map((a) => a.agentId).join(" ");
  useEffect(() => {
    if (!projectId || agentIds === "") return;
    let cancelled = false;
    for (const agentId of agentIds.split(" ")) {
      api
        .listBenchmarks(projectId, agentId)
        .then((data) => {
          if (!cancelled) {
            setGroups((g) => ({ ...g, [agentId]: { benchmarks: data.benchmarks, error: null } }));
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setGroups((g) => ({ ...g, [agentId]: { benchmarks: null, error: apiErrorText(e) } }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [projectId, agentIds]);

  // The Project's models, for the Optimize dialog's session-model picker; a failure just
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

  const fallbackAgent = currentAgent?.agentId ?? pickDefaultAgent(agents)?.agentId ?? "";
  const openAi = (agentId: string | null) => {
    setAiTarget(agentId ?? fallbackAgent);
    setAiOpen(true);
  };
  const openManual = (agentId: string | null) => {
    setManualAgent(agentId ?? (fallbackAgent === "" ? null : fallbackAgent));
    setManualOpen(true);
  };
  const open = (ref: BenchmarkRef) => navigate(benchmarkRoute(ref.agentId, ref.benchmarkId));

  const benchmarkOf = (ref: BenchmarkRef | null): BenchmarkSummary | null =>
    ref ? (groups[ref.agentId]?.benchmarks?.find((b) => b.id === ref.benchmarkId) ?? null) : null;
  const optimizingBenchmark = benchmarkOf(optimizing);
  const deletingBenchmark = benchmarkOf(deleting);

  const copyPath = (ref: BenchmarkRef) => {
    writeClipboard(benchmarkPath(ref.agentId, ref.benchmarkId));
    toastSuccess(S.benchmark.pathCopied);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const ref = deleting;
    setDeleteBusy(true);
    try {
      await api.deleteBenchmark(projectId, ref.agentId, ref.benchmarkId);
      toastSuccess(S.benchmark.deleted);
      setGroups((g) => ({
        ...g,
        [ref.agentId]: {
          benchmarks: (g[ref.agentId]?.benchmarks ?? []).filter((b) => b.id !== ref.benchmarkId),
          error: null,
        },
      }));
      setDeleting(null);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  // A Benchmark that was just written is the one the user is about to read: go straight into it.
  const onCreated = (agentId: string, benchmark: BenchmarkSummary) =>
    open({ agentId, benchmarkId: benchmark.id });

  const searching = query.trim() !== "";
  const settled = agents.every((a) => {
    const g = groups[a.agentId];
    return g !== undefined && (g.benchmarks !== null || g.error !== null);
  });
  const total = agents.reduce((n, a) => n + (groups[a.agentId]?.benchmarks?.length ?? 0), 0);
  const anyError = agents.some((a) => (groups[a.agentId]?.error ?? null) !== null);
  const visible = agents
    .map((agent) => ({
      agent,
      group: groups[agent.agentId],
      rows: (groups[agent.agentId]?.benchmarks ?? []).filter((b) =>
        matchesBenchmarkQuery(b, agent, query),
      ),
    }))
    .filter(({ rows }) => !searching || rows.length > 0);

  let body;
  if (agentsLoading) {
    body = <CardSkeletons rows={4} />;
  } else if (agents.length === 0) {
    body = <EmptyState title={S.aiCreate.noAgent} />;
  } else if (settled && total === 0 && !anyError) {
    body = (
      <EmptyState
        title={S.benchmark.emptyTitle}
        description={S.benchmark.emptyDescription}
        action={<CreateButtons onAi={() => openAi(null)} onManual={() => openManual(null)} />}
      />
    );
  } else if (searching && visible.length === 0) {
    body = <EmptyState title={S.benchmark.noMatches} />;
  } else {
    body = (
      <ul className="space-y-5">
        {visible.map(({ agent, group, rows }) => {
          const groupOpen = isOpen(agent.agentId);
          const name = agentDisplayName(agent);
          return (
            <li key={agent.agentId}>
              <GroupHeader
                open={groupOpen}
                onToggle={() => toggle(agent.agentId)}
                icon={
                  <AgentAvatar
                    id={agent.agentId}
                    name={name}
                    size={ICON_SIZE.groupHeaderAvatar}
                    className="shrink-0 rounded"
                  />
                }
                label={name}
                uppercase
                {...(group?.benchmarks ? { count: group.benchmarks.length } : {})}
                actions={
                  <Button
                    size="icon"
                    variant="ghost"
                    title={S.benchmark.createForAgent}
                    aria-label={S.benchmark.createForAgent}
                    onClick={() => openAi(agent.agentId)}
                  >
                    <GlyphIcon d={MAGIC_WAND_ICON} size={ICON_SIZE.groupHeaderAction} />
                  </Button>
                }
              />
              {groupOpen && (
                <div className="mt-2">
                  {group === undefined || (group.benchmarks === null && group.error === null) ? (
                    <CardSkeletons rows={2} />
                  ) : group.error !== null ? (
                    <p className={`px-1 text-xs ${toneInk.danger}`}>{group.error}</p>
                  ) : rows.length === 0 ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-gray-200 px-5 py-4 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
                      <span>{S.benchmark.emptyAgent}</span>
                      <CreateButtons
                        size="sm"
                        onAi={() => openAi(agent.agentId)}
                        onManual={() => openManual(agent.agentId)}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {rows.map((b) => {
                        const ref = { agentId: agent.agentId, benchmarkId: b.id };
                        return (
                          <BenchmarkCard
                            key={b.id}
                            benchmark={b}
                            locale={locale}
                            canDelete={isOwner}
                            onOpen={() => open(ref)}
                            onOptimize={() => setOptimizing({ ...ref, mode: "manual" })}
                            onCopyPath={() => copyPath(ref)}
                            onDelete={() => setDeleting(ref)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        {/* The title row and the guide under it share one block, so the gap below the block is
            the same whether or not the guide is unfolded — the Agents and Models headers have
            the same shape. */}
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
              <CreateButtons
                size="sm"
                onAi={() => openAi(null)}
                onManual={() => openManual(null)}
              />
            </div>
          </div>
          <HelpFold title={S.benchmark.guideTitle} className="mt-2">
            <ol className="list-decimal space-y-1 pl-4">
              {S.benchmark.guideSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <p className="mt-1.5">{S.benchmark.guideNote}</p>
          </HelpFold>
        </div>

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
        agents={agents}
        initialAgentId={manualAgent}
        onCreated={onCreated}
      />
      {optimizing && optimizingBenchmark && (
        <OptimizeModal
          key={`${optimizing.agentId}/${optimizing.benchmarkId}/${optimizing.mode}`}
          open
          onClose={() => setOptimizing(null)}
          projectId={projectId}
          agentId={optimizing.agentId}
          mode={optimizing.mode}
          benchmark={optimizingBenchmark}
          agents={agents}
          models={models}
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
          {S.benchmark.deleteConfirm(deletingBenchmark?.title ?? deleting?.benchmarkId ?? "")}
        </p>
      </ConfirmModal>
    </div>
  );
}
