/**
 * What the Evaluation Center adds for a Harbor Benchmark — one whose cases run as Harbor tasks in
 * Docker, from task folders in a public repository (the built-in ones): a neutral tag beside its
 * title, a link to its task files on its page, the trial a run records in place of a Session,
 * and the Evaluate tab's one line on what the run needs. A plain Benchmark gets none of them.
 */
import type { BenchmarkHarborSource, BenchmarkSummary } from "@prismshadow/penguin-server/api";
import { Badge, CopyButton, Link } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** How agent-evaluation records a Harbor trial in a run's `session_id`: it is no Session. */
const TRIAL_PREFIX = "harbor:";

/** The trial a run's id names, or null for a Session id. */
export function harborTrialName(sessionId: string): string | null {
  return sessionId.startsWith(TRIAL_PREFIX) ? sessionId.slice(TRIAL_PREFIX.length) : null;
}

/**
 * The tag after a Harbor Benchmark's title: a kind, so a neutral badge. It carries no hover hint
 * — its word is on screen, and what it means is the Benchmark's description and the docs.
 */
export function HarborTag({ benchmark }: { benchmark: Pick<BenchmarkSummary, "kind"> }) {
  if (benchmark.kind !== "harbor") return null;
  return (
    <Badge tone="neutral" size="sm">
      {S.benchmark.harborTag}
    </Badge>
  );
}

/**
 * Where the tasks live: the repository at the ref every case links. On GitHub the link opens the
 * tree at that ref; anywhere else, the repository itself.
 */
export function HarborRepoLink({ harbor }: { harbor: BenchmarkHarborSource }) {
  const repo = harbor.repo.replace(/\/+$/, "");
  const github = /^https:\/\/github\.com\//.exec(repo);
  const href = github ? `${repo}/tree/${harbor.ref}` : repo;
  const name = github ? repo.slice(github[0].length) : repo.replace(/^https?:\/\//, "");
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      <span className="shrink-0">{S.benchmark.harborRepo}</span>
      <Link href={href} external variant="standalone" className="min-w-0 font-mono">
        <span className="min-w-0 truncate">{`${name}@${harbor.ref}`}</span>
      </Link>
    </span>
  );
}

/** The Evaluate tab's line for a Harbor Benchmark: what the machine and the model need. */
export function HarborEvaluateNote({ benchmark }: { benchmark: Pick<BenchmarkSummary, "kind"> }) {
  if (benchmark.kind !== "harbor") return null;
  return (
    <p className="text-xs text-gray-500 dark:text-gray-400">{S.benchmark.harborEvaluateHint}</p>
  );
}

/**
 * A run's Session id, for correlating it with what the side panel shows. A Harbor trial is no
 * Session the app can open, so its id comes with a button that copies the trial's name — the
 * directory to look for under the Benchmark's `.jobs/`.
 */
export function RunSessionId({ sessionId }: { sessionId?: string }) {
  if (!sessionId) return <span className="text-gray-400">—</span>;
  const id = <span className="font-mono text-gray-600 dark:text-gray-300">{sessionId}</span>;
  const trial = harborTrialName(sessionId);
  if (trial === null) return id;
  return (
    <span className="inline-flex items-center gap-1">
      {id}
      <CopyButton text={trial} label={S.benchmark.copyTrialName} size="sm" className="shrink-0" />
    </span>
  );
}
