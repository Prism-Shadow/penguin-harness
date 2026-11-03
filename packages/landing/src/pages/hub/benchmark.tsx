/**
 * One benchmark: its summary; its tasks, each folding open to its budget and, a tab each, its
 * statement, rubric and data (`#<task-id>` opens one from a link); its data folder; the
 * leaderboards measured on it; and its references last.
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ChevronDownIcon, Fold, useSiteLocale } from "@prismshadow/penguin-ui/site";
import {
  AuthorName,
  CountTitle,
  HubDetail,
  HubMissing,
  HubPanel,
  HubPending,
  HubReferences,
  useHubDetail,
} from "../../components/hub/hub-detail";
import { HubMarkdown } from "../../components/hub/hub-markdown";
import { InlineText } from "../../components/hub/inline-text";
import { ExternalLink } from "../../components/external-link";
import { useDocumentMeta } from "../../lib/document-meta";
import { formatDay, pick, titleOf } from "../../lib/hub/text";
import type { BenchmarkData, BenchmarkDetail, BenchmarkTask, TaskData } from "../../lib/hub/types";
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
  const t = S.hub.benchmarks;

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
      ]}
      aside={
        benchmark.leaderboards.length > 0 && (
          <HubPanel title={t.leaderboards} flush>
            <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-800">
              {benchmark.leaderboards.map((board) => (
                <li key={board.id} className="px-4 py-2.5">
                  <Link
                    to={`/leaderboards/${board.id}`}
                    className="font-medium text-brand-700 hover:underline dark:text-brand-300"
                  >
                    {titleOf(locale, board)}
                  </Link>
                </li>
              ))}
            </ul>
          </HubPanel>
        )
      }
    >
      <HubPanel title={t.about}>
        <p className="text-sm leading-7 text-gray-700 dark:text-gray-300">
          <InlineText>{description}</InlineText>
        </p>
      </HubPanel>
      <HubPanel title={<CountTitle label={t.tasks} count={benchmark.tasks.length} />} flush>
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {benchmark.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              open={open.has(task.id)}
              onToggle={() => toggle(task.id)}
              base={`${benchmark.sourceUrl}/${task.id}`}
            />
          ))}
        </ul>
      </HubPanel>
      {benchmark.data && <DataPanel data={benchmark.data} />}
      <HubReferences links={benchmark.references} />
    </HubDetail>
  );
}

type TaskPart = "statement" | "rubric" | "data";

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
  const t = S.hub.benchmarks;
  const panel = `task-${task.id}`;
  const budget = budgetText(task.budget);
  const parts: TaskPart[] = [
    ...(task.statement ? (["statement"] as const) : []),
    ...(task.rubric ? (["rubric"] as const) : []),
    ...(task.data ? (["data"] as const) : []),
  ];
  const [chosen, setChosen] = useState<TaskPart | undefined>(undefined);
  const part = chosen ?? parts[0];
  return (
    <li id={task.id} className="scroll-mt-20 last:overflow-hidden last:rounded-b-xl">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 sm:px-5 dark:hover:bg-gray-800"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            <InlineText>{titleOf(locale, task)}</InlineText>
          </span>
          <span className="mt-0.5 block text-sm text-gray-600 dark:text-gray-400">
            <InlineText>{pick(locale, task.description, task.descriptionZh)}</InlineText>
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={`mt-1 h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div id={panel} className="site-ui">
        <Fold open={open} className="site-ui-fold">
          <div className="px-4 pb-5 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {parts.length > 1 ? (
                <div
                  role="tablist"
                  aria-label={t.taskParts}
                  className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700"
                >
                  {parts.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      role="tab"
                      aria-selected={candidate === part}
                      onClick={() => setChosen(candidate)}
                      className={`rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors ${
                        candidate === part
                          ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                          : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                      }`}
                    >
                      {t[candidate]}
                    </button>
                  ))}
                </div>
              ) : (
                <span />
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {task.id}
                {budget.map((item) => (
                  <span key={item} className="ml-3">
                    {item}
                  </span>
                ))}
              </p>
            </div>
            <div className="mt-4">
              {part === "statement" && (
                <HubMarkdown base={`${base}/statement/`}>{task.statement}</HubMarkdown>
              )}
              {part === "rubric" && (
                <HubMarkdown base={`${base}/rubric/`}>{task.rubric}</HubMarkdown>
              )}
              {part === "data" && task.data && <TaskDataView data={task.data} />}
            </div>
          </div>
        </Fold>
      </div>
    </li>
  );
}

/** How many of a task's files the page lists before pointing at the folder. */
const SHOWN_FILES = 12;

/** Files the agent works from first (its workspace), then the rest, each in path order. */
const workspaceFirst = (files: readonly string[]) => [
  ...files.filter((file) => file.includes("workspace/")),
  ...files.filter((file) => !file.includes("workspace/")),
];

function TaskDataView({ data }: { data: TaskData }) {
  const t = S.hub.benchmarks;
  const files = workspaceFirst(data.files).slice(0, SHOWN_FILES);
  const blob = data.url.replace("/tree/", "/blob/");
  return (
    <div className="flex flex-col gap-5">
      {data.instruction && (
        <div>
          <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400">{t.instruction}</h3>
          <div className="mt-2">
            <HubMarkdown base={`${data.url}/`}>{data.instruction}</HubMarkdown>
          </div>
        </div>
      )}
      <div>
        <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t.files(data.fileCount)}
        </h3>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {files.map((file) => (
            <li key={file} className="[overflow-wrap:anywhere]">
              <ExternalLink
                href={`${blob}/${file}`}
                className="text-gray-700 hover:text-brand-700 hover:underline dark:text-gray-300 dark:hover:text-brand-300"
              >
                {file}
              </ExternalLink>
            </li>
          ))}
        </ul>
        <ExternalLink
          href={data.url}
          className="mt-2 inline-block text-sm text-brand-700 hover:underline dark:text-brand-300"
        >
          {data.fileCount > files.length ? t.allFiles(data.fileCount) : t.dataFolder}
        </ExternalLink>
      </div>
    </div>
  );
}

/** The benchmark's data folder: its README, cut short until asked for, and a link to the files. */
function DataPanel({ data }: { data: BenchmarkData }) {
  const t = S.hub.benchmarks;
  const [whole, setWhole] = useState(false);
  return (
    <HubPanel
      title={t.data}
      actions={
        <ExternalLink
          href={data.url}
          className="text-sm text-brand-700 hover:underline dark:text-brand-300"
        >
          {t.allFiles(data.fileCount)}
        </ExternalLink>
      }
    >
      {data.readme && (
        <>
          <div className={whole ? "" : "max-h-96 overflow-hidden"}>
            <HubMarkdown base={`${data.url}/`}>{data.readme}</HubMarkdown>
          </div>
          <button
            type="button"
            aria-expanded={whole}
            onClick={() => setWhole((value) => !value)}
            className="mt-4 text-sm text-brand-700 hover:underline dark:text-brand-300"
          >
            {whole ? t.showLess : t.showAll}
          </button>
        </>
      )}
    </HubPanel>
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
