/**
 * Evaluation Center: every Benchmark of the Project grouped by the Agent it tests, with the
 * loop a novice needs spelled out — create one (an AI prompt or a form), read its scores, hand
 * it to an optimizer. A row carries the newest Score with its change, a sparkline of the
 * scoreboard, when it was last evaluated, and inline actions; the detail (chart, evaluation
 * table, case browser) opens in a right pane on wide layouts and takes the list's place on
 * narrow ones. `?agentId=` expands only that Agent; `?benchmark=<agent>/<id>` opens one
 * directly, and a selection writes that parameter back so the view can be shared.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
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
import { writeClipboard } from "../../components/ui/copy-button";
import { Dropdown } from "../../components/ui/dropdown";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { GroupHeader } from "../../components/ui/group-list";
import { HelpFold } from "../../components/ui/help-fold";
import { CloseButton, MAGIC_WAND_ICON } from "../../components/ui/icons";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import {
  ELLIPSIS_ICON,
  TRASH_ICON,
  overflowMenuDangerClass,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { AiCreateButton, AiCreateModal, CreateMenuButton, pickDefaultAgent } from "../ai-create";
import { latestScore, matchesBenchmarkQuery, sparklineSeries } from "./benchmark-metrics";
import { benchmarkCreateExamples, benchmarkCreateTail, benchmarkPath } from "./benchmark-prompts";
import { BenchmarkDetail } from "./benchmark-detail";
import { CreateBenchmarkModal } from "./create-benchmark-modal";
import { OptimizeModal } from "./optimize-modal";
import { ScoreSparkline } from "./score-sparkline";

/** Where a Benchmark lives: the Agent it tests and its directory name. */
interface BenchmarkRef {
  agentId: string;
  benchmarkId: string;
}

/** One Agent's fetched list: null benchmarks with a null error means the fetch is in flight. */
interface GroupState {
  benchmarks: BenchmarkSummary[] | null;
  error: string | null;
}

/** Left-pointing chevron of the narrow layout's back-to-list button. */
const BACK_ICON = "m15 18-6-6 6-6";

function deltaTone(delta: number | null): string {
  if (delta === null || delta === 0) return toneInk.muted;
  return delta > 0 ? toneInk.success : toneInk.danger;
}

/** The row's overflow menu: copy the directory path, and — for the owner — delete. */
function RowMenu({
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
 * One Benchmark in its Agent's group. The title block is the row's main button (it opens the
 * detail); the number column shows the newest Score and its change from the previous one; the
 * sparkline gives way at narrow container widths, where the action group wraps onto its own
 * line under the title instead of squeezing it.
 */
function BenchmarkRow({
  benchmark,
  active,
  locale,
  canDelete,
  onSelect,
  onOptimize,
  onCopyPath,
  onDelete,
}: {
  benchmark: BenchmarkSummary;
  active: boolean;
  locale: "zh" | "en";
  canDelete: boolean;
  onSelect: () => void;
  onOptimize: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
}) {
  const latest = latestScore(benchmark.evaluations);
  const series = sparklineSeries(benchmark.evaluations);
  const meta = [
    S.benchmark.caseCount(benchmark.caseCount),
    S.benchmark.runsPerCase(benchmark.runs ?? 1),
    ...(latest ? [S.benchmark.lastEvaluated(formatRelativeShort(latest.time, locale))] : []),
  ].join(" · ");
  return (
    <div
      className={`@container flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-gray-100 px-3 py-2.5 transition-colors duration-150 last:border-b-0 dark:border-gray-800/70 ${
        active ? "bg-gray-100/80 dark:bg-gray-800/60" : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className="min-w-0 flex-1 basis-40 text-left"
      >
        <span
          className={`block truncate text-sm text-gray-800 dark:text-gray-100 ${active ? "font-semibold" : "font-medium"}`}
        >
          {benchmark.title}
        </span>
        {benchmark.description && (
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
            {benchmark.description}
          </span>
        )}
        <span className="mt-0.5 block truncate text-[11px] text-gray-400 dark:text-gray-500">
          {meta}
        </span>
      </button>
      {series.length > 0 && (
        <div className="hidden shrink-0 @md:block">
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
      <div
        className={`flex shrink-0 items-center ${ICON_GAP.tight} @max-md:basis-full @max-md:justify-end`}
      >
        <Button size="sm" variant="primary" onClick={onOptimize}>
          <GlyphIcon d={MAGIC_WAND_ICON} />
          {S.benchmark.optimize}
        </Button>
        <Button size="sm" onClick={onSelect}>
          {S.benchmark.view}
        </Button>
        <RowMenu canDelete={canDelete} onCopyPath={onCopyPath} onDelete={onDelete} />
      </div>
    </div>
  );
}

export function BenchmarkPage() {
  useDocumentTitle(S.benchmark.title);
  const { currentProject, currentAgent, agents, agentsLoading } = useProject();
  const { locale } = useLocale();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  const [searchParams, setSearchParams] = useSearchParams();
  // ?agentId= (entered from an Agent's settings): only that Agent's group starts expanded.
  const focusAgentId = searchParams.get("agentId");
  const deepLink = searchParams.get("benchmark");

  const [groups, setGroups] = useState<Record<string, GroupState>>({});
  // Agents whose group is in the opposite state from its default (all open, or only the focused one).
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<BenchmarkRef | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTarget, setAiTarget] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualAgent, setManualAgent] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState<BenchmarkRef | null>(null);
  const [deleting, setDeleting] = useState<BenchmarkRef | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const appliedDeepLink = useRef<string | null>(null);

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
    setSelection(null);
    setToggled(new Set());
    setModels(null);
  }, [projectId]);

  // Every Agent's list is fetched up front: the search box, the counts and the deep link
  // need them all. The join keeps the effect keyed on the set of ids, not the array identity
  // the provider hands out on every reload.
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

  const select = useCallback(
    (ref: BenchmarkRef | null) => {
      setSelection(ref);
      const value = ref ? `${ref.agentId}/${ref.benchmarkId}` : null;
      appliedDeepLink.current = value;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null) next.delete("benchmark");
          else next.set("benchmark", value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // ?benchmark=<agent>/<id>: applied once its Agent's list has arrived, expanding the group
  // when the focus mode left it collapsed.
  useEffect(() => {
    if (deepLink === null || appliedDeepLink.current === deepLink) return;
    const slash = deepLink.indexOf("/");
    if (slash <= 0) return;
    const agentId = deepLink.slice(0, slash);
    const benchmarkId = deepLink.slice(slash + 1);
    const group = groups[agentId];
    if (!group || group.benchmarks === null) return;
    appliedDeepLink.current = deepLink;
    if (!group.benchmarks.some((b) => b.id === benchmarkId)) return;
    setSelection({ agentId, benchmarkId });
    if (!defaultOpen(agentId)) {
      setToggled((prev) => (prev.has(agentId) ? prev : new Set(prev).add(agentId)));
    }
  }, [deepLink, groups, defaultOpen]);

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

  const benchmarkOf = (ref: BenchmarkRef | null): BenchmarkSummary | null =>
    ref ? (groups[ref.agentId]?.benchmarks?.find((b) => b.id === ref.benchmarkId) ?? null) : null;
  const agentOf = (ref: BenchmarkRef | null): AgentSummary | null =>
    ref ? (agents.find((a) => a.agentId === ref.agentId) ?? null) : null;
  const selected = benchmarkOf(selection);
  const selectedAgent = agentOf(selection);
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
      if (selection?.agentId === ref.agentId && selection.benchmarkId === ref.benchmarkId) {
        select(null);
      }
      setDeleting(null);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const onCreated = (agentId: string, benchmark: BenchmarkSummary) => {
    setGroups((g) => ({
      ...g,
      [agentId]: {
        benchmarks: [...(g[agentId]?.benchmarks ?? []), benchmark].sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
        error: null,
      },
    }));
    if (!isOpen(agentId)) toggle(agentId);
    select({ agentId, benchmarkId: benchmark.id });
  };

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
    body = <SkeletonList rows={4} />;
  } else if (agents.length === 0) {
    body = <EmptyState title={S.aiCreate.noAgent} />;
  } else if (settled && total === 0 && !anyError) {
    body = (
      <EmptyState
        title={S.benchmark.emptyTitle}
        description={S.benchmark.emptyDescription}
        action={<AiCreateButton variant="primary" onClick={() => openAi(null)} />}
      />
    );
  } else if (searching && visible.length === 0) {
    body = <EmptyState title={S.benchmark.noMatches} />;
  } else {
    body = (
      <ul className="space-y-4">
        {visible.map(({ agent, group, rows }) => {
          const open = isOpen(agent.agentId);
          const name = agentDisplayName(agent);
          return (
            <li key={agent.agentId}>
              <GroupHeader
                open={open}
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
              {open && (
                <div className="mt-1 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                  {group === undefined || (group.benchmarks === null && group.error === null) ? (
                    <SkeletonList rows={2} />
                  ) : group.error !== null ? (
                    <p className={`px-3 py-2 text-xs ${toneInk.danger}`}>{group.error}</p>
                  ) : rows.length === 0 ? (
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                      <span>{S.benchmark.emptyAgent}</span>
                      <Button size="sm" variant="ghost" onClick={() => openAi(agent.agentId)}>
                        <GlyphIcon d={MAGIC_WAND_ICON} />
                        {S.benchmark.createForAgent}
                      </Button>
                    </div>
                  ) : (
                    rows.map((b) => {
                      const ref = { agentId: agent.agentId, benchmarkId: b.id };
                      return (
                        <BenchmarkRow
                          key={b.id}
                          benchmark={b}
                          active={
                            selection?.agentId === agent.agentId && selection.benchmarkId === b.id
                          }
                          locale={locale}
                          canDelete={isOwner}
                          onSelect={() => select(ref)}
                          onOptimize={() => setOptimizing(ref)}
                          onCopyPath={() => copyPath(ref)}
                          onDelete={() => setDeleting(ref)}
                        />
                      );
                    })
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const detailOpen = selection !== null && selected !== null && selectedAgent !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-gray-200 px-4 py-3 md:px-6 dark:border-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{S.benchmark.title}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{S.benchmark.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              size="sm"
              aria-label={S.benchmark.searchPlaceholder}
              placeholder={S.benchmark.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-56"
            />
            <CreateMenuButton
              size="sm"
              label={S.benchmark.newBenchmark}
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
      </header>

      <div className="flex min-h-0 flex-1">
        <section
          aria-label={S.benchmark.title}
          className={`@container min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:p-4 ${
            detailOpen
              ? "hidden lg:block lg:w-[44%] lg:min-w-[26rem] lg:max-w-xl lg:flex-none lg:border-r lg:border-gray-200 lg:dark:border-gray-800"
              : ""
          }`}
        >
          {body}
        </section>
        {selection !== null && selected !== null && selectedAgent !== null && (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
              <Button size="sm" variant="ghost" className="lg:hidden" onClick={() => select(null)}>
                <GlyphIcon d={BACK_ICON} />
                {S.benchmark.backToList}
              </Button>
              <AgentAvatar
                id={selectedAgent.agentId}
                name={agentDisplayName(selectedAgent)}
                size={ICON_SIZE.rowLead}
                className="shrink-0 rounded"
              />
              <span className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400">
                {agentDisplayName(selectedAgent)}
              </span>
              <span className="min-w-0 flex-1" />
              <Button size="sm" variant="primary" onClick={() => setOptimizing(selection)}>
                <GlyphIcon d={MAGIC_WAND_ICON} />
                {S.benchmark.optimize}
              </Button>
              <CloseButton
                onClose={() => select(null)}
                title={S.benchmark.closeDetail}
                className="hidden lg:block"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
              <BenchmarkDetail
                key={`${selection.agentId}/${selected.id}`}
                projectId={projectId}
                agentId={selection.agentId}
                benchmark={selected}
              />
            </div>
          </section>
        )}
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
          key={`${optimizing.agentId}/${optimizing.benchmarkId}`}
          open
          onClose={() => setOptimizing(null)}
          projectId={projectId}
          agentId={optimizing.agentId}
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
