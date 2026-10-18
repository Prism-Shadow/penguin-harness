/**
 * Scheduled tasks (/schedules): every agent's tasks of this Project on one page.
 *
 * The nav entry is the point of the page. A task is a file of one Agent
 * (agent_state/schedule/*.toml), and until this page the only place to read them was that
 * Agent's Settings › Schedules tab — so a Project's whole schedule was invisible unless you
 * already knew which Agent to open. This page reads the Project-wide listing
 * (GET /api/projects/:projectId/schedules) through the shared schedule store, the same one the
 * session list's alarm-clock marks and the chat dock's panel read, and groups it by the Agent
 * that owns each task. Sharing the store is what keeps the three surfaces from disagreeing:
 * a task that fires, or a file written by an agent mid-turn, lands here on the store's next
 * refresh instead of this page holding a copy of its own.
 *
 * Two filters answer "what kinds of tasks do I have": the status chips (the dock panel's own
 * vocabulary — 生效中 / 已暂停 / 已完成) and the type picker, which names the interval in words
 * (一次性 / 分钟级 / 每日 …) instead of the server's `30m` grammar. The rules behind both are
 * pure (schedule-category.ts) and unit-tested; a search box narrows the same list by name and
 * prompt.
 *
 * A row opens the task in full (schedule-detail-dialog.tsx): the whole prompt, the window, the
 * bound Session, the model and Workspace a new Session would open with. Editing happens in the
 * shared form (schedule-form-modal.tsx), which is the only writer of a task file — this page
 * never re-implements it. The list refreshes on the store's own triggers — a navigation, a
 * schedule event, regaining focus — and on the header's button.
 */
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import type { ProjectScheduleItem, ScheduleStatus } from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  NoticeStrip,
  PageFrame,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import type { BadgeStyle } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { formatDateTime } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import {
  SCHEDULE_TYPES,
  countByStatus,
  countByType,
  filterSchedulePage,
} from "./schedule-category";
import type { ScheduleType } from "./schedule-category";
import { describeInstant, describePeriod } from "./schedule-describe";
import { SCHEDULE_FILTERS } from "./schedule-panel-state";
import type { ScheduleFilter } from "./schedule-panel-state";
import { ScheduleDetailDialog } from "./schedule-detail-dialog";
import { ScheduleFormModal } from "./schedule-form-modal";
import { refreshSchedules, useProjectSchedules } from "./schedule-store";

/** Display status → badge, the same mapping the settings tab's table uses. */
const STATUS_BADGE: Record<ScheduleStatus, BadgeStyle> = {
  active: { tone: "success" },
  disabled: { tone: "neutral" },
  expired: { tone: "attention" },
  done: { tone: "neutral", variant: "solid" },
  missed: { tone: "attention" },
  invalid: { tone: "danger" },
};

/** One agent's tasks, in the listing's own order (agents by id, a task's file order within). */
interface AgentGroup {
  agentId: string;
  items: ProjectScheduleItem[];
}

function groupByAgent(items: readonly ProjectScheduleItem[]): AgentGroup[] {
  const groups = new Map<string, ProjectScheduleItem[]>();
  for (const item of items) {
    const list = groups.get(item.agentId);
    if (list === undefined) groups.set(item.agentId, [item]);
    else list.push(item);
  }
  return [...groups].map(([agentId, list]) => ({ agentId, items: list }));
}

/** A chip's label: the word, then how many tasks sit under it. */
function chip(label: string, count: number): string {
  return `${label} ${count}`;
}

export function SchedulesPage() {
  const { currentProject, agents } = useProject();
  const { locale } = useLocale();
  const projectId = currentProject?.projectId ?? null;
  // The key is this page: the store refetches whenever it changes, and here it never does — the
  // page is not a conversation, so its list rides the store's event and focus refreshes.
  const { items, error } = useProjectSchedules(projectId, "schedules-page");
  const [status, setStatus] = useState<ScheduleFilter>("all");
  const [type, setType] = useState<ScheduleType | "all">("all");
  const [query, setQuery] = useState("");
  // The task the detail dialog shows, by identity rather than by snapshot: a toggle or a save
  // replaces the list, and the dialog must show what the server now says, not what it said when
  // the row was clicked. A task that disappeared (deleted elsewhere) closes the dialog by itself.
  const [openKey, setOpenKey] = useState<{ agentId: string; name: string } | null>(null);
  const [editing, setEditing] = useState<ProjectScheduleItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useDocumentTitle(S.schedulesPage.title);

  const all = useMemo(() => items ?? [], [items]);
  const shown = useMemo(() => filterSchedulePage(all, status, type, query), [all, status, type, query]);
  const statusCounts = useMemo(() => countByStatus(all), [all]);
  const typeCounts = useMemo(() => countByType(all), [all]);
  const groups = useMemo(() => groupByAgent(shown), [shown]);
  const detail = useMemo(
    () =>
      openKey === null
        ? null
        : (all.find((i) => i.agentId === openKey.agentId && i.name === openKey.name) ?? null),
    [all, openKey],
  );
  const filtered = status !== "all" || type !== "all" || query.trim() !== "";
  const nameOf = useCallback(
    (agentId: string): string => {
      const agent = agents.find((a) => a.agentId === agentId);
      return agent === undefined ? agentId : agentDisplayName(agent);
    },
    [agents],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await refreshSchedules(projectId);
    setRefreshing(false);
    toastSuccess(S.schedulesPage.refreshed);
  }, [projectId]);

  /** After a write: re-read the list so the row, the counts and the Session marks agree. */
  const changed = useCallback(() => {
    void refreshSchedules(projectId);
  }, [projectId]);

  const clearFilters = () => {
    setStatus("all");
    setType("all");
    setQuery("");
  };

  // One table per agent, each with the same columns; the min width lets the narrow columns hold
  // their line before the overflow container takes over.
  const head = (
    <TableHead>
      <TableHeaderCell>{S.schedulesPage.colTask}</TableHeaderCell>
      <TableHeaderCell>{S.schedule.colStatus}</TableHeaderCell>
      <TableHeaderCell>{S.schedulesPage.colPlan}</TableHeaderCell>
      <TableHeaderCell>{S.schedulesPage.colTarget}</TableHeaderCell>
      <TableHeaderCell>{S.schedulesPage.colNext}</TableHeaderCell>
      <TableHeaderCell>{S.schedulesPage.colLast}</TableHeaderCell>
    </TableHead>
  );

  let body: React.ReactNode;
  if (items === null) {
    body = error === null ? <Skeleton className="h-40 w-full" /> : null;
  } else if (all.length === 0) {
    body = <EmptyState title={S.schedulesPage.emptyTitle} description={S.schedulesPage.emptyHint} />;
  } else if (shown.length === 0) {
    body = (
      <EmptyState
        title={S.schedulesPage.noMatch}
        action={
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            {S.schedulesPage.clearFilters}
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="space-y-4">
        {groups.map((group) => (
          <Card key={group.agentId} padding="none">
            <CardHeader
              title={nameOf(group.agentId)}
              actions={
                // A link, not a button: the destination is a route, so it can be opened in a
                // new tab — and a <button> inside an <a> is neither.
                <Link
                  to={`/agents/${encodeURIComponent(group.agentId)}?tab=schedules`}
                  className="text-xs text-fg-muted hover:underline"
                >
                  {S.schedulesPage.openAgent}
                </Link>
              }
            />
            <Table framed={false} tableClassName="min-w-[720px]">
              {head}
              <TableBody>
                {group.items.map((item) => (
                  // The whole row is the way into the task: the list has one row per task and no
                  // room for the prompt, and a per-row "details" button would be a second thing
                  // to read on every line. The house pattern for a row that opens (benchmark).
                  <TableRow
                    key={`${item.agentId}/${item.name}`}
                    onClick={() => setOpenKey({ agentId: item.agentId, name: item.name })}
                    className="cursor-pointer"
                  >
                    <TableCell
                      className="max-w-48 truncate font-mono text-xs"
                      data-tooltip={item.name}
                      data-tooltip-content="code"
                    >
                      {item.name}
                    </TableCell>
                    <TableCell nowrap>
                      <span data-tooltip={item.invalidReason} data-tooltip-extra>
                        <Badge {...STATUS_BADGE[item.status]}>
                          {S.schedule.statusNames[item.status] ?? item.status}
                        </Badge>
                      </span>
                    </TableCell>
                    {/* The plan in everyday words, with the raw grammar on hover: "每天 09:00" is
                        what a reader wants, "24h" is what they edit. The cadence only — the
                        "next fire" tail the panel's line carries would repeat the column beside
                        it and push this one into an ellipsis. */}
                    <TableCell
                      className="max-w-56 truncate text-xs"
                      data-tooltip={item.period}
                      data-tooltip-content="code"
                    >
                      {item.period === undefined
                        ? S.schedule.human.once(describeInstant(item.startAt, locale, new Date()))
                        : describePeriod(item.period, item.nextFireAt ?? item.startAt, locale)}
                    </TableCell>
                    <TableCell
                      className="max-w-40 truncate text-xs text-fg-muted"
                      data-tooltip={item.sessionId}
                      data-tooltip-content="text"
                    >
                      {item.sessionId === undefined ? (
                        S.schedule.newSession
                      ) : (
                        <span className="font-mono">{item.sessionId}</span>
                      )}
                    </TableCell>
                    <TableCell nowrap className="text-xs">
                      {item.nextFireAt === undefined ? "—" : formatDateTime(item.nextFireAt)}
                    </TableCell>
                    <TableCell nowrap className="text-xs text-fg-muted">
                      {item.lastFiredAt === undefined ? "—" : formatDateTime(item.lastFiredAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <PageFrame width="lg">
      <PageHeader
        title={S.schedulesPage.title}
        description={S.schedulesPage.subtitle}
        actions={
          <Button size="sm" disabled={refreshing || projectId === null} onClick={() => void refresh()}>
            {S.schedulesPage.refresh}
          </Button>
        }
      >
        {/* The two filters, each chip carrying its own count, so the page says what kinds of
            tasks exist before anything is clicked. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="w-full min-w-0 sm:w-96">
            <Segmented
              cols={4}
              options={SCHEDULE_FILTERS.map((value) => ({
                value,
                label: chip(
                  value === "all"
                    ? S.schedule.filterAll
                    : value === "active"
                      ? S.schedule.filterActive
                      : value === "paused"
                        ? S.schedule.filterPaused
                        : S.schedule.filterCompleted,
                  statusCounts[value],
                ),
              }))}
              value={status}
              onChange={setStatus}
            />
          </div>
          <div className="w-40 shrink-0">
            <Select size="sm" value={type} onChange={(e) => setType(e.target.value as ScheduleType | "all")}>
              <option value="all">{chip(S.schedulesPage.typeAll, statusCounts.all)}</option>
              {SCHEDULE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {chip(S.schedulesPage.typeNames[value] ?? value, typeCounts[value])}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-0 flex-1">
            <SearchInput
              size="sm"
              value={query}
              placeholder={S.schedulesPage.searchPlaceholder}
              aria-label={S.schedulesPage.searchPlaceholder}
              onChange={setQuery}
            />
          </div>
        </div>
        {items !== null && all.length > 0 && (
          <p className="mt-2 text-xs text-fg-muted">
            {/* The list's own count while a filter is on, so a narrowed page never looks like the
                whole schedule; the type breakdown names what the picker can narrow to. */}
            {filtered
              ? S.schedulesPage.filteredCount(shown.length, statusCounts.all)
              : S.schedulesPage.countAll(statusCounts.all)}
            {SCHEDULE_TYPES.filter((t) => typeCounts[t] > 0)
              .map((t) => ` · ${S.schedulesPage.typeNames[t] ?? t} ${typeCounts[t]}`)
              .join("")}
          </p>
        )}
      </PageHeader>

      {error !== null && (
        <NoticeStrip tone="danger" className="mb-4 rounded-md border px-3 py-2 text-sm">
          {S.schedulesPage.loadFailed}：{error}
        </NoticeStrip>
      )}

      {body}

      <ScheduleDetailDialog
        item={detail}
        onClose={() => setOpenKey(null)}
        onEdit={(item) => {
          // The form replaces the dialog rather than stacking on it: two modals at once would
          // leave the reader unsure which one the Esc key closes.
          setOpenKey(null);
          setEditing(item);
        }}
        onChanged={changed}
      />

      <ScheduleFormModal
        open={editing !== null}
        agentId={editing?.agentId ?? ""}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          changed();
        }}
      />
    </PageFrame>
  );
}
