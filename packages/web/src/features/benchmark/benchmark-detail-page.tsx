/**
 * One Benchmark's own page (`/benchmark/:agentId/:benchmarkId`): the Agent it tests, the pair of
 * optimize entry points, and the detail itself — chart, evaluation table, case browser. Opening
 * a Benchmark enters this page the way an Agent's card enters its settings, so the back button
 * is the way out rather than a close cross. A pair that no longer resolves — a deleted Benchmark
 * or a stale link — says so in place of the detail and keeps that way out.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { BenchmarkSummary, ModelsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { ICON_SIZE } from "../../lib/icon-scale";
import { agentDisplayName, useProject } from "../../state/project";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Skeleton } from "../../components/ui/skeleton";
import { CreateButtons } from "../ai-create";
import { BenchmarkDetail } from "./benchmark-detail";
import { OptimizeModal } from "./optimize-modal";
import type { OptimizeMode } from "./optimize-modal";

/** Back to the list: the arrow-left every detail page's back button carries. */
const BACK_ICON = "M15 18l-6-6 6-6M9 12h12";

export function BenchmarkDetailPage() {
  const params = useParams<{ agentId: string; benchmarkId: string }>();
  const agentId = params.agentId ?? "";
  const benchmarkId = params.benchmarkId ?? "";
  const navigate = useNavigate();
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [benchmark, setBenchmark] = useState<BenchmarkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The Agent's list came back without this id: the Benchmark was deleted, or the link is stale. */
  const [missing, setMissing] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [optimizing, setOptimizing] = useState<OptimizeMode | null>(null);

  useDocumentTitle(benchmark?.title ?? S.benchmark.title);

  // The Agent's list is the only read that carries a Benchmark's scoreboard, so the page takes
  // it whole and picks its own out of it.
  useEffect(() => {
    if (!projectId || agentId === "" || benchmarkId === "") return;
    let cancelled = false;
    setBenchmark(null);
    setError(null);
    setMissing(false);
    api
      .listBenchmarks(projectId, agentId)
      .then((data) => {
        if (cancelled) return;
        const found = data.benchmarks.find((b) => b.id === benchmarkId) ?? null;
        setBenchmark(found);
        setMissing(found === null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId, benchmarkId]);

  // The Project's models, for the Optimize dialog's session-model picker; a failure just leaves
  // the picker at the Project default.
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

  const agent = agents.find((a) => a.agentId === agentId) ?? null;
  const agentName = agent ? agentDisplayName(agent) : agentId;

  let body;
  if (error !== null) {
    body = <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  } else if (missing) {
    body = <EmptyState title={S.benchmark.notFound} description={S.benchmark.notFoundHint} />;
  } else if (benchmark === null) {
    body = (
      <div className="space-y-3">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  } else {
    body = <BenchmarkDetail projectId={projectId} agentId={agentId} benchmark={benchmark} />;
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-4xl">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/benchmark")}
          className="-ml-2 mb-3 text-gray-500 dark:text-gray-400"
        >
          <GlyphIcon d={BACK_ICON} size={ICON_SIZE.rowLead} />
          {S.benchmark.backToList}
        </Button>
        {/* Whose Benchmark this is, and the pair of optimize entry points over it. The title,
            case counts and description are the detail's own, one block below. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <AgentAvatar
            id={agentId}
            name={agentName}
            size={ICON_SIZE.rowLead}
            className="shrink-0 rounded"
          />
          <span className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400">
            {agentName}
          </span>
          <span className="min-w-0 flex-1" />
          {benchmark && (
            <CreateButtons
              aiLabel={S.benchmark.optimizeWithAi}
              manualLabel={S.benchmark.optimizeManual}
              onAi={() => setOptimizing("prompt")}
              onManual={() => setOptimizing("manual")}
            />
          )}
        </div>
        {body}
      </div>

      {optimizing !== null && benchmark !== null && (
        <OptimizeModal
          key={optimizing}
          open
          onClose={() => setOptimizing(null)}
          projectId={projectId}
          agentId={agentId}
          mode={optimizing}
          benchmark={benchmark}
          agents={agents}
          models={models}
        />
      )}
    </div>
  );
}
