/**
 * One Benchmark's own page (`/benchmark/:benchmarkId`): its title with the directory the files
 * live in, the Use entry point, and the detail itself — chart, evaluation table, case browser.
 * Opening a Benchmark enters this page the way an Agent's card enters its settings, so the back
 * button is the way out rather than a close cross. An id that no longer resolves — a deleted
 * Benchmark or a stale link — says so in place of the detail and keeps that way out.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { BenchmarkSummary, ModelsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { ICON_SIZE } from "../../lib/icon-scale";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { CopyButton, ROW_COPY_CLASS } from "../../components/ui/copy-button";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Skeleton } from "../../components/ui/skeleton";
import { BenchmarkDetail } from "./benchmark-detail";
import { benchmarkPath } from "./benchmark-prompts";
import { UseBenchmarkModal } from "./use-benchmark-modal";

/** Back to the list: the arrow-left every detail page's back button carries. */
const BACK_ICON = "M15 18l-6-6 6-6M9 12h12";

export function BenchmarkDetailPage() {
  const params = useParams<{ benchmarkId: string }>();
  const benchmarkId = params.benchmarkId ?? "";
  const navigate = useNavigate();
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [benchmark, setBenchmark] = useState<BenchmarkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The Project's list came back without this id: the Benchmark was deleted, or the link is stale. */
  const [missing, setMissing] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [using, setUsing] = useState(false);

  useDocumentTitle(benchmark?.title ?? S.benchmark.title);

  // The Project's list is the only read that carries a Benchmark's scoreboard, so the page takes
  // it whole and picks its own out of it.
  useEffect(() => {
    if (!projectId || benchmarkId === "") return;
    let cancelled = false;
    setBenchmark(null);
    setError(null);
    setMissing(false);
    api
      .listBenchmarks(projectId)
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
  }, [projectId, benchmarkId]);

  // The Project's models, for the Use dialog's conversation-model picker; a failure just leaves
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
    body = <BenchmarkDetail projectId={projectId} benchmark={benchmark} />;
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
        {/* The Benchmark's name, the directory its files live in, and the Use entry point. The
            case counts and the description are the detail's own, one block below. A Benchmark
            tests whichever Agents its scoreboard names, so no single Agent is named up here. */}
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="min-w-0 truncate text-xl font-semibold">
            {benchmark?.title ?? benchmarkId}
          </h1>
          {/* A Benchmark that no longer resolves has no directory to name and nothing to use:
              the title and the way back are all this row keeps. */}
          {benchmark && (
            <>
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <span className="min-w-0 truncate font-mono text-xs text-gray-400 dark:text-gray-500">
                  {benchmarkPath(benchmark.id)}
                </span>
                <CopyButton
                  text={benchmarkPath(benchmark.id)}
                  label={S.benchmark.copyPath}
                  className={ROW_COPY_CLASS}
                />
              </span>
              <Button size="sm" variant="primary" onClick={() => setUsing(true)}>
                {S.benchmark.use}
              </Button>
            </>
          )}
        </div>
        {body}
      </div>

      {using && benchmark !== null && (
        <UseBenchmarkModal
          key={benchmark.id}
          open
          onClose={() => setUsing(false)}
          projectId={projectId}
          benchmark={benchmark}
          agents={agents}
          models={models}
          initialTab="evaluate"
        />
      )}
    </div>
  );
}
