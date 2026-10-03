/**
 * The Activity: every ActionRun of the organization — who ran which Action on what, from where,
 * and how it ended — newest first, a page at a time. Every write to the proposals and roadmaps is
 * an Action, refused attempts included, so this is the one place to see who did each step.
 *
 * Three surfaces share the list: the proposals page's Activity view (`proposals/activity`), with
 * filters by subject, actor and Action; and a proposal's detail and a roadmap's column, each with
 * the subject fixed to itself.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionRunView } from "@prismshadow/penguin-server/api";
import { Button, ICON_GAP, ICON_SIZE, Input, Skeleton, Text } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatRelativeShort } from "../../lib/format";
import { toneDot, toneInk } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { useLocale } from "../../state/locale";
import { OrgPage, useOrg } from "../company/org-layout";
import { ErrorLine, PrincipalChip } from "../company/shared";
import {
  EMPTY_FILTER,
  RUN_TONE,
  appendRuns,
  failureOf,
  filterOf,
  runState,
  type RunFilterForm,
} from "./activity-model";

/** How many runs a page asks for. */
export const ACTIVITY_PAGE = 50;

/** The list's state: the runs shown, the next page's cursor, and how the last read went. */
function useRuns(projectId: string, orgId: string, form: RunFilterForm, limit: number) {
  const [runs, setRuns] = useState<ActionRunView[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const read = useCallback(
    async (before?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.listOrgActionRuns(projectId, orgId, {
          ...filterOf(form, before),
          limit,
        });
        setRuns((shown) => (before === undefined ? page.runs : appendRuns(shown ?? [], page.runs)));
        setNext(page.next);
      } catch (e) {
        setError(apiErrorText(e));
        if (before === undefined) setRuns([]);
      } finally {
        setLoading(false);
      }
    },
    [projectId, orgId, form, limit],
  );
  useEffect(() => {
    setRuns(null);
    void read();
  }, [read]);
  return { runs, next, error, loading, read };
}

/** The proposals page's Activity view: the filters, then the list. */
export function ActivityPage() {
  const { projectId, orgId } = useOrg();
  const t = S.company.activity;
  const [draft, setDraft] = useState<RunFilterForm>(EMPTY_FILTER);
  const [form, setForm] = useState<RunFilterForm>(EMPTY_FILTER);
  return (
    <OrgPage title={t.title} info={t.info}>
      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setForm(draft);
        }}
      >
        <Input
          label={t.subject}
          placeholder="proposal:12"
          value={draft.subject}
          onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
        />
        <Input
          label={t.by}
          placeholder="user:<id>"
          value={draft.by}
          onChange={(e) => setDraft({ ...draft, by: e.target.value })}
        />
        <Input
          label={t.key}
          placeholder="proposal.approve"
          value={draft.key}
          onChange={(e) => setDraft({ ...draft, key: e.target.value })}
        />
        <Button size="sm" variant="primary" type="submit">
          {t.apply}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => {
            setDraft(EMPTY_FILTER);
            setForm(EMPTY_FILTER);
          }}
        >
          {t.clear}
        </Button>
      </form>
      <ActivityList projectId={projectId} orgId={orgId} form={form} limit={ACTIVITY_PAGE} />
    </OrgPage>
  );
}

/** The runs of one subject (a proposal, a roadmap), as a section of its page. */
export function SubjectActivity({
  projectId,
  orgId,
  subject,
  version,
}: {
  projectId: string;
  orgId: string;
  subject: string;
  /** Read again whenever this changes (the subject was written). */
  version?: unknown;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` only asks for a fresh read
  const form = useMemo(() => ({ ...EMPTY_FILTER, subject }), [subject, version]);
  return (
    <section className="mt-6">
      <h3 className="mb-1.5">
        <Text variant="eyebrow" as="span">
          {S.company.activity.title}
        </Text>
      </h3>
      <ActivityList projectId={projectId} orgId={orgId} form={form} limit={10} compact />
    </section>
  );
}

/** The list itself, read with `form`, with "load more" while the server has older runs. */
export function ActivityList({
  projectId,
  orgId,
  form,
  limit,
  compact = false,
}: {
  projectId: string;
  orgId: string;
  form: RunFilterForm;
  limit: number;
  compact?: boolean;
}) {
  const t = S.company.activity;
  const { runs, next, error, loading, read } = useRuns(projectId, orgId, form, limit);
  if (runs === null) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }
  return (
    <div>
      {error !== null && (
        <ErrorLine
          message={t.loadFailed}
          detail={error}
          onRetry={() => void read(runs.length === 0 ? undefined : (next ?? undefined))}
        />
      )}
      {runs.length === 0 && error === null ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">{t.empty}</p>
      ) : (
        <ActivityRows runs={runs} compact={compact} />
      )}
      {next !== null && (
        <div className="mt-2">
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => void read(next)}>
            {t.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The rows, with the employees' names read from the company store. */
export function ActivityRows({
  runs,
  compact = false,
}: {
  runs: readonly ActionRunView[];
  compact?: boolean;
}) {
  const company = useCompany();
  const names = useMemo(
    () => new Map((company.orgChart?.employees ?? []).map((e) => [e.agentId, e.name])),
    [company.orgChart],
  );
  return <ActivityRowsView runs={runs} names={names} compact={compact} />;
}

/** The rows with everything they read passed in. */
export function ActivityRowsView({
  runs,
  names,
  compact = false,
}: {
  runs: readonly ActionRunView[];
  names: ReadonlyMap<string, string>;
  compact?: boolean;
}) {
  const t = S.company.activity;
  const { locale } = useLocale();
  return (
    <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
      {runs.map((run) => {
        const state = runState(run);
        const tone = RUN_TONE[state];
        const failure = failureOf(run);
        return (
          <li key={run.id} className="px-3 py-2 text-xs" data-run={run.id}>
            <div className={`flex flex-wrap items-center ${ICON_GAP.row}`}>
              <span
                aria-hidden="true"
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[tone]}`}
              />
              <span className={`font-medium ${toneInk[tone]}`}>{t.outcome[state]}</span>
              <code className="font-mono text-gray-800 dark:text-gray-200">{run.key}</code>
              {!compact && (
                <code className="font-mono text-gray-500 dark:text-gray-400">{run.subject}</code>
              )}
              <span className="text-gray-400 dark:text-gray-500">·</span>
              <PrincipalChip principal={run.by} names={names} size={ICON_SIZE.rowLead} />
              <span className="text-gray-400 dark:text-gray-500">{t.via[run.via]}</span>
              <span
                className="ml-auto text-gray-400 dark:text-gray-500"
                data-tooltip={formatDateTime(run.startedAt)}
              >
                {formatRelativeShort(run.startedAt, locale)}
              </span>
            </div>
            {failure !== null && <p className={`mt-0.5 break-words ${toneInk[tone]}`}>{failure}</p>}
            {run.hookErrors.length > 0 && (
              <p className={`mt-0.5 break-words ${toneInk.attention}`}>
                {t.hookErrors(run.hookErrors.join("; "))}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
