/**
 * One Benchmark's own page (`/benchmark/:benchmarkId`): its title with the directory the files
 * live in and the version they are at, the Use entry point, and the detail itself — chart,
 * evaluation table, case browser.
 * Opening a Benchmark enters this page the way an Agent's card enters its settings, so the back
 * button is the way out rather than a close cross. An id that no longer resolves — a deleted
 * Benchmark or a stale link — says so in place of the detail and keeps that way out.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type {
  BenchmarkManifestProblem,
  BenchmarkSummary,
  ModelsResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  CopyButton,
  EmptyState,
  PageFrame,
  PageHeader,
  Skeleton,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import type { MergedBenchmark } from "../../lib/benchmark-merge";
import { nameOnMachine } from "../../lib/workspace-machines";
import { useSessions } from "../../state/sessions";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useProject } from "../../state/project";
import { BenchmarkDetail } from "./benchmark-detail";
import { benchmarkPath } from "./benchmark-prompts";
import { fetchBenchmarks } from "./benchmark-sources";
import { UseBenchmarkModal } from "./use-benchmark-modal";

/**
 * What stands in place of the detail for a Benchmark that is not published: still being built,
 * creation failed, or a manifest that cannot be read, with the reason the server gave. Deleting
 * and creating again is a failed Benchmark's only way out, and only the owner may delete, so a
 * member is told what happened without being sent to that step.
 */
export function UnpublishedNotice({
  failed,
  isOwner,
  manifestError,
}: {
  failed: boolean;
  isOwner: boolean;
  manifestError?: BenchmarkManifestProblem;
}) {
  if (manifestError !== undefined) {
    const hint = isOwner ? S.benchmark.manifestBrokenHint : S.benchmark.manifestBrokenHintMember;
    return (
      <EmptyState
        title={S.benchmark.manifestBroken}
        description={S.benchmark.manifestBrokenDetail(hint, manifestError.message)}
      />
    );
  }
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

/** `url` when it is an http(s) link, else null: a source link must never run anything. */
function webLink(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * What the header says under the Benchmark's title: the directory its files live in, with a copy
 * button, and the version its manifest is at; under them, for a copy an Agent imported from a
 * repository folder, a link to that folder. A Benchmark whose manifest was written before
 * versions or could not be read, or one a machine running an older server answered for, has no
 * version, and the header names its directory alone.
 */
export function BenchmarkHeaderFacts({
  benchmark,
}: {
  benchmark: Pick<BenchmarkSummary, "id" | "version" | "origin">;
}) {
  const source = benchmark.origin?.kind === "git" ? webLink(benchmark.origin.url) : null;
  return (
    <span className="block min-w-0">
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate font-mono text-xs text-gray-400 dark:text-gray-500">
            {benchmarkPath(benchmark.id)}
          </span>
          <CopyButton
            text={benchmarkPath(benchmark.id)}
            label={S.benchmark.copyPath}
            size="sm"
            className="shrink-0"
          />
        </span>
        {benchmark.version !== undefined && benchmark.version !== "" && (
          <span className="shrink-0 text-xs">
            <span className="text-fg-muted">{S.benchmark.versionLabel}</span>{" "}
            <span className="font-semibold tabular-nums text-fg">v{benchmark.version}</span>
          </span>
        )}
      </span>
      {source !== null && (
        // A line of its own with no width of its own (w-0 min-w-full): the link takes the width
        // the title and the line above give the header and truncates there, so a long folder
        // link never pushes the title row's Use button onto a line of its own.
        <span className="mt-1 flex w-0 min-w-full items-center gap-1 text-xs">
          <span className="shrink-0 text-fg-muted">{S.benchmark.sourceLabel}</span>
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            data-tooltip={source}
            className="min-w-0 truncate text-link underline-offset-2 hover:underline"
          >
            {source.replace(/^https?:\/\//, "")}
          </a>
        </span>
      )}
    </span>
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
    body = (
      <UnpublishedNotice
        failed={failed}
        isOwner={isOwner}
        manifestError={benchmark.manifestError}
      />
    );
  } else {
    body = (
      <BenchmarkDetail projectId={projectId} benchmark={benchmark} machineNameOf={machineNameOf} />
    );
  }

  return (
    <PageFrame width="md">
      {/* The Benchmark's name, the directory its files live in and its version under it, and
          the Use entry point at the end of the title row. The case counts and the description
          are the detail's own, one block below. A Benchmark tests whichever Agents its
          scoreboard names, so no single Agent is named up here. A Benchmark that is not
          published, reached by its address, keeps the path but drops Use, and shows the
          building or creation-failed notice in place of the detail. A Benchmark that no longer
          resolves has no directory to name and nothing to use: the title and the way back are
          all the header keeps. */}
      <PageHeader
        back={{ label: S.benchmark.backToList, onClick: () => navigate("/benchmark") }}
        title={
          <span className="min-w-0 truncate">
            {benchmark === null
              ? benchmarkId
              : onlyMachine !== null
                ? nameOnMachine(benchmark.title, onlyMachine)
                : benchmark.title}
          </span>
        }
        description={benchmark ? <BenchmarkHeaderFacts benchmark={benchmark} /> : undefined}
        actions={
          benchmark && !masked ? (
            <Button size="sm" variant="primary" onClick={() => setUsing(true)}>
              {S.benchmark.use}
            </Button>
          ) : undefined
        }
      />
      {body}

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
    </PageFrame>
  );
}
