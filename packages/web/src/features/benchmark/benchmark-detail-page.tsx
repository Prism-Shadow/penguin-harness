/**
 * One Benchmark's own page (`/benchmark/:benchmarkId`): its title with the directory the files
 * live in, the Use entry point, and the detail itself — chart, evaluation table, case browser.
 * Opening a Benchmark enters this page the way an Agent's card enters its settings, so the back
 * button is the way out rather than a close cross. An id that no longer resolves — a deleted
 * Benchmark or a stale link — says so in place of the detail and keeps that way out.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { ModelsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import type { MergedBenchmark } from "../../lib/benchmark-merge";
import { nameOnMachine } from "../../lib/workspace-machines";
import { useSessions } from "../../state/sessions";
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
import { fetchBenchmarks } from "./benchmark-sources";
import { UseBenchmarkModal } from "./use-benchmark-modal";

/** Back to the list: the arrow-left every detail page's back button carries. */
const BACK_ICON = "M15 18l-6-6 6-6M9 12h12";

/**
 * What stands in place of the detail for a Benchmark that is not published: still being built,
 * or creation failed. Deleting and creating again is a failed Benchmark's only way out, and only
 * the owner may delete, so a member is told what happened without being sent to that step.
 */
export function UnpublishedNotice({ failed, isOwner }: { failed: boolean; isOwner: boolean }) {
  if (!failed) {
    return <EmptyState title={S.benchmark.building} description={S.benchmark.buildingDetail} />;
  }
  return (
    <EmptyState
      title={S.benchmark.creationFailed}
      description={
        isOwner ? S.benchmark.creationFailedDetail : S.benchmark.creationFailedDetailMember
      }
    />
  );
}

export function BenchmarkDetailPage() {
  const params = useParams<{ benchmarkId: string }>();
  const benchmarkId = params.benchmarkId ?? "";
  const navigate = useNavigate();
  const { currentProject, agents } = useProject();
  const { machineIds, machineLabels } = useSessions();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";

  const [benchmark, setBenchmark] = useState<MergedBenchmark | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The Project's list came back without this id: the Benchmark was deleted, or the link is stale. */
  const [missing, setMissing] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [using, setUsing] = useState(false);

  useDocumentTitle(benchmark?.title ?? S.benchmark.title);

  // The Project's list is the only read that carries a Benchmark's scoreboard, so the page takes
  // it whole — merged over this server and the machines it holds — and picks its own out of it.
  const machinesKey = machineIds.join(",");
  useEffect(() => {
    if (!projectId || benchmarkId === "") return;
    let cancelled = false;
    setBenchmark(null);
    setError(null);
    setMissing(false);
    fetchBenchmarks(projectId, machinesKey === "" ? [] : machinesKey.split(","))
      .then((merged) => {
        if (cancelled) return;
        const found = merged.find((b) => b.id === benchmarkId) ?? null;
        setBenchmark(found);
        setMissing(found === null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, benchmarkId, machinesKey]);

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

  /** The ssh alias of a machine, or null for this server. An unlabelled machine falls back to its id. */
  const machineNameOf = (machineId: string | null): string | null =>
    machineId === null ? null : (machineLabels.get(machineId) ?? machineId);
  /** The one machine holding this Benchmark when it is not on this server; null otherwise. */
  const onlyMachine =
    benchmark !== null && benchmark.machineIds.length === 1
      ? machineNameOf(benchmark.machineIds[0] ?? null)
      : null;

  // A Benchmark that is not published has no settled cases or scores to show and nothing to
  // evaluate against: a draft is still being written and calibrated by the agent, and a failed
  // one never finished calibrating and can only be deleted.
  const masked = benchmark !== null && benchmark.status !== "published";
  const failed = benchmark !== null && benchmark.status === "failed";

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
  } else if (masked) {
    body = <UnpublishedNotice failed={failed} isOwner={isOwner} />;
  } else {
    body = (
      <BenchmarkDetail projectId={projectId} benchmark={benchmark} machineNameOf={machineNameOf} />
    );
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
            tests whichever Agents its scoreboard names, so no single Agent is named up here. A
            Benchmark that is not published, reached by its address, keeps the path but drops
            Use, and shows the building or creation-failed notice in place of the detail. */}
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="min-w-0 truncate text-xl font-semibold">
            {benchmark === null
              ? benchmarkId
              : onlyMachine !== null
                ? nameOnMachine(benchmark.title, onlyMachine)
                : benchmark.title}
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
              {!masked && (
                <Button size="sm" variant="primary" onClick={() => setUsing(true)}>
                  {S.benchmark.use}
                </Button>
              )}
            </>
          )}
        </div>
        {body}
      </div>

      {using && benchmark !== null && !masked && (
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
