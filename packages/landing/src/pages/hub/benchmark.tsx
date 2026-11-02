/**
 * One benchmark: its summary, its tasks — each folds open to its budget and statement, and
 * `#<task-id>` opens one from a link — and the leaderboards measured on it. Rubrics are for the
 * evaluating agent and stay in the repository.
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ChevronDownIcon, Fold, useSiteLocale } from "@prismshadow/penguin-ui/site";
import {
  AuthorName,
  HubDetail,
  HubMissing,
  HubPending,
  HubSection,
  useHubDetail,
} from "../../components/hub/hub-detail";
import { HubMarkdown } from "../../components/hub/hub-markdown";
import { ExternalLink } from "../../components/external-link";
import { useDocumentMeta } from "../../lib/document-meta";
import { formatDay, pick, titleOf } from "../../lib/hub/text";
import type { BenchmarkDetail, BenchmarkTask } from "../../lib/hub/types";
import { S } from "../../lib/strings";

export function BenchmarkPage() {
  const { id = "" } = useParams();
  const benchmark = useHubDetail("benchmark", id);
  if (benchmark === undefined) return <HubPending />;
  if (benchmark === null) return <HubMissing listHref="/benchmarks" />;
  return <BenchmarkView benchmark={benchmark} />;
}

function BenchmarkView({ benchmark }: { benchmark: BenchmarkDetail }) {
  const { locale } = useSiteLocale();
  const { hash } = useLocation();
  const title = titleOf(locale, benchmark);
  const description = pick(locale, benchmark.description, benchmark.descriptionZh);
  useDocumentMeta(S.hub.pageTitle(title), description);
  const linked = decodeURIComponent(hash.slice(1));
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(linked ? [linked] : []));

  useEffect(() => {
    if (!linked || !benchmark.tasks.some((task) => task.id === linked)) return;
    setOpen((current) => new Set([...current, linked]));
    document.getElementById(linked)?.scrollIntoView({ block: "start" });
  }, [linked, benchmark.tasks]);

  const toggle = (taskId: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  return (
    <HubDetail
      title={title}
      subtitle={benchmark.id}
      sourceUrl={benchmark.sourceUrl}
      facts={[
        { label: S.hub.meta.author, value: <AuthorName author={benchmark.author} /> },
        { label: S.hub.meta.version, value: benchmark.version },
        { label: S.hub.meta.status, value: S.hub.status[benchmark.status] ?? benchmark.status },
        { label: S.hub.meta.updated, value: formatDay(benchmark.lastUpdate, locale) },
        { label: S.hub.meta.tasks, value: benchmark.tasks.length },
        ...(benchmark.leaderboards.length > 0
          ? [
              {
                label: S.hub.benchmarks.leaderboards,
                value: (
                  <ul className="flex flex-col gap-1">
                    {benchmark.leaderboards.map((board) => (
                      <li key={board.id}>
                        <Link
                          to={`/leaderboards/${board.id}`}
                          className="text-brand-700 hover:underline dark:text-brand-300"
                        >
                          {titleOf(locale, board)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ),
              },
            ]
          : []),
      ]}
    >
      <HubSection title={S.hub.benchmarks.about}>
        <p className="text-sm leading-7 text-gray-700 dark:text-gray-300">{description}</p>
      </HubSection>
      <HubSection title={S.hub.benchmarks.tasks}>
        <ul className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {benchmark.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              open={open.has(task.id)}
              onToggle={() => toggle(task.id)}
              base={`${benchmark.sourceUrl}/${task.id}/statement/`}
            />
          ))}
        </ul>
      </HubSection>
      {benchmark.references.length > 0 && (
        <HubSection title={S.hub.references}>
          <ul className="flex flex-col gap-1.5 text-sm">
            {benchmark.references.map((href) => (
              <li key={href} className="[overflow-wrap:anywhere]">
                <ExternalLink
                  href={href}
                  className="text-brand-700 hover:underline dark:text-brand-300"
                >
                  {href}
                </ExternalLink>
              </li>
            ))}
          </ul>
        </HubSection>
      )}
    </HubDetail>
  );
}

function TaskRow({
  task,
  open,
  onToggle,
  base,
}: {
  task: BenchmarkTask;
  open: boolean;
  onToggle: () => void;
  base: string;
}) {
  const { locale } = useSiteLocale();
  const panel = `task-${task.id}`;
  const budget = budgetText(task.budget);
  return (
    <li id={task.id} className="scroll-mt-20">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={onToggle}
        className="flex w-full items-start gap-3 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{titleOf(locale, task)}</span>
          <span className="mt-0.5 block text-sm text-gray-600 dark:text-gray-400">
            {pick(locale, task.description, task.descriptionZh)}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={`mt-1 h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div id={panel} className="site-ui">
        <Fold open={open} className="site-ui-fold">
          <div className="pb-5">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {task.id}
              {budget.map((part) => (
                <span key={part} className="ml-3">
                  {part}
                </span>
              ))}
            </p>
            {task.statement && (
              <div className="mt-3">
                <HubMarkdown base={base}>{task.statement}</HubMarkdown>
              </div>
            )}
          </div>
        </Fold>
      </div>
    </li>
  );
}

/** The task's budget as short phrases, e.g. "Time 15 min", "CPU 1 core"; unset limits omitted. */
function budgetText(budget: BenchmarkTask["budget"]): string[] {
  const words = S.hub.benchmarks;
  const parts: string[] = [];
  if (budget.timeout !== undefined) {
    const minutes = budget.timeout / 60;
    parts.push(
      `${words.budget.timeout} ${
        minutes >= 60 && minutes % 60 === 0
          ? words.hours(minutes / 60)
          : words.minutes(Math.round(minutes))
      }`,
    );
  }
  if (budget.cpus !== undefined) parts.push(`${words.budget.cpus} ${words.cores(budget.cpus)}`);
  if (budget.ram !== undefined) parts.push(`${words.budget.ram} ${words.gigabytes(budget.ram)}`);
  if (budget.disk !== undefined) parts.push(`${words.budget.disk} ${words.gigabytes(budget.disk)}`);
  if (budget.gpus !== undefined) parts.push(`${words.budget.gpus} ${words.cards(budget.gpus)}`);
  return parts;
}
