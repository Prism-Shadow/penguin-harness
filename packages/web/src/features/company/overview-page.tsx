/**
 * The organization's overview, a calm dashboard: a hero naming the organization (its
 * mission, status pill and this period's spend against the CEO's budget as a ring), a KPI
 * strip — employees (on desk / running / paused), the board as a segmented bar with its
 * blocked count, today's calendar, the spend — then what needs the user ("for me": mentions,
 * tickets in review, tickets blocked on them) beside today's timeline with each instance's
 * outcome, and the latest chat beside the budget alerts. Every value is a link to the page
 * it summarizes. A brand-new organization (nobody hired, empty board) gets the three-step
 * guide in place of the empty sections.
 *
 * Loading discipline: the skeleton shows only until the first response or the first error;
 * a failed refresh keeps what was last read on screen under one error line with its retry.
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import type {
  OrgChartResponse,
  OrgTicketStatus,
  OrganizationDetail,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatMoney, formatRelativeShort } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneDot, toneInk, toneSurface } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useCompany } from "../../state/company";
import { useLocale } from "../../state/locale";
import { useTheme } from "../../state/theme";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { NAV_ICONS } from "../../components/ui/icons";
import { toastError } from "../../components/ui/toast";
import { STAT_ICONS } from "../../lib/stat-icons";
import { orgPagePath } from "./company-nav";
import type { CompanyNavKey } from "./company-nav";
import { OrgEmptyLine, OrgPage, OrgPageSkeleton, OrgSection, useOrg } from "./org-layout";
import {
  BudgetBar,
  ErrorLine,
  OrgStatusPill,
  PrincipalChip,
  PriorityBadge,
  SpendRing,
} from "./shared";
import { agentPrincipal } from "./principals";
import { timeLabel } from "./calendar-geom";
import {
  BOARD_SEGMENT_TONE,
  FIRST_STEPS,
  TIMELINE_TONE,
  boardSummary,
  chatTail,
  employeeCounts,
  firstSteps,
  pendingRows,
  spendSummary,
  todaySummary,
} from "./overview-summary";
import type { FirstStep, TimelineMark } from "./overview-summary";

/** How many of each list the page shows before pointing at the page that holds the rest. */
const TIMELINE_ROWS = 6;
const CHAT_ROWS = 6;

/** A row of a section: full width, quiet hover, the content decides the rest. */
const rowClass =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800";

/** A small tone-marked count: the dot, the label, the number. */
function ToneCount({ tone, label, value }: { tone: Tone; label: string; value: number }) {
  return (
    <span className={`inline-flex items-center ${ICON_GAP.tight}`} title={label}>
      <span className={`block h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} />
      <span>{label}</span>
      <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">{value}</span>
    </span>
  );
}

/** The bar segments' fills: the ticket status badges' tones, with done as the heavier neutral its badge wears. */
const BOARD_FILL: Record<OrgTicketStatus, string> = {
  proposed: toneDot.muted,
  in_progress: toneDot.busy,
  review: toneDot.attention,
  done: "bg-gray-500 dark:bg-gray-400",
  rejected: toneDot.danger,
};

/** The label of a timeline mark: the calendar's own outcome names, plus "upcoming". */
function markLabel(mark: TimelineMark): string {
  return mark === "upcoming"
    ? S.company.overview.upcoming
    : (S.company.calendarOutcomes[mark] ?? mark);
}

/**
 * One cell of the KPI strip. `value` is the headline number, `detail` the line under it;
 * the whole cell is the link to its page unless the cell brings its own controls
 * (`interactive`), in which case only the headline is.
 */
function KpiCell({
  label,
  value,
  detail,
  onClick,
  interactive = false,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  onClick: () => void;
  interactive?: boolean;
}) {
  const inner = (
    <>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <span className="mt-1 block text-2xl font-semibold leading-none tabular-nums">{value}</span>
    </>
  );
  const cellClass = "flex min-h-28 flex-col justify-between bg-white px-4 py-3 dark:bg-gray-950";
  if (interactive) {
    return (
      <div className={cellClass}>
        <button
          type="button"
          onClick={onClick}
          className="rounded-md text-left transition-colors duration-150 hover:text-gray-600 dark:hover:text-gray-300"
        >
          {inner}
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          {detail}
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${cellClass} text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-900`}
    >
      <span className="block">{inner}</span>
      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        {detail}
      </span>
    </button>
  );
}

/** One step of the first-steps guide: its number (a check once done), title, what to do, and the button that does it. */
function StepCard({
  index,
  done,
  current,
  title,
  body,
  action,
}: {
  index: number;
  done: boolean;
  current: boolean;
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <li
      className={`flex flex-col gap-2 rounded-md border p-4 ${
        current ? "border-gray-300 dark:border-gray-700" : "border-gray-200 dark:border-gray-800"
      }`}
    >
      <span className={`flex items-center ${ICON_GAP.menu}`}>
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            done
              ? toneSurface.success
              : current
                ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          }`}
        >
          {done ? <GlyphIcon d={STAT_ICONS.check} size={ICON_SIZE.inlineGlyph} /> : index}
        </span>
        <span className="text-sm font-medium">{title}</span>
      </span>
      <p className="flex-1 text-xs text-gray-500 dark:text-gray-400">{body}</p>
      <span className="flex items-center justify-between gap-2">
        {done ? (
          <span className={`text-xs ${toneInk.success}`}>{S.company.overview.stepDone}</span>
        ) : (
          <span />
        )}
        {action}
      </span>
    </li>
  );
}

export function OverviewPage() {
  const { projectId, orgId, org } = useOrg();
  const navigate = useNavigate();
  const company = useCompany();
  const { user } = useAuth();
  const { currency } = useTheme();
  const { locale } = useLocale();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.overview}` : S.nav.org.overview);
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [chart, setChart] = useState<OrgChartResponse | null>(null);
  /** The whole calendar's size, read only while the organization is fresh (today's slice says nothing about next week). */
  const [calendarCount, setCalendarCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingDesk, setOpeningDesk] = useState(false);

  // Another organization's data must not linger while this one loads.
  useEffect(() => {
    setDetail(null);
    setChart(null);
    setCalendarCount(null);
    setError(null);
  }, [projectId, orgId]);

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([
        api.getOrganization(projectId, orgId),
        api.getOrgChart(projectId, orgId),
      ]);
      setDetail(d);
      setChart(c);
      setError(null);
      if (
        firstSteps({
          employeeCount: c.employees.length,
          boardTotal: boardSummary(d.board).total,
          ceoDeskOpened: d.ceoDeskSessionId !== undefined,
          calendarCount: 0,
        }).fresh
      ) {
        // Best effort: an unreadable calendar only leaves the third step unticked.
        try {
          setCalendarCount((await api.listOrgCalendar(projectId, orgId)).events.length);
        } catch {
          setCalendarCount(null);
        }
      }
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId]);

  // Every event family moves something on this page: reload on any of them.
  const { chat, tickets, runs, budget } = company.versions;
  useEffect(() => {
    void load();
  }, [load, chat, tickets, runs, budget]);

  const page = (key: CompanyNavKey, query = "") =>
    navigate(`${orgPagePath(projectId, orgId, key)}${query}`);
  const openTicket = (ticketId: string) =>
    page("tickets", `?ticket=${encodeURIComponent(ticketId)}`);

  const openCeoDesk = async () => {
    if (chart === null || openingDesk) return;
    setOpeningDesk(true);
    try {
      const desk = await api.getOrgDesk(projectId, orgId, chart.ceoAgentId);
      navigate(`/chat/${desk.sessionId}`);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setOpeningDesk(false);
    }
  };

  const title = S.nav.org.overview;
  const info = S.company.overview.info;

  if (detail === null || chart === null) {
    return (
      <OrgPage title={title} info={info}>
        {error !== null ? (
          <EmptyState
            title={error}
            action={<Button onClick={() => void load()}>{S.common.retry}</Button>}
          />
        ) : (
          <OrgPageSkeleton />
        )}
      </OrgPage>
    );
  }

  const counts = employeeCounts(chart.employees);
  const board = boardSummary(detail.board);
  const today = todaySummary(detail.today);
  const spend = spendSummary(detail.spend);
  const steps = firstSteps({
    employeeCount: chart.employees.length,
    boardTotal: board.total,
    ceoDeskOpened: detail.ceoDeskSessionId !== undefined,
    calendarCount: calendarCount ?? 0,
  });
  const rows = pendingRows(detail.pending);
  const names = new Map(chart.employees.map((e) => [e.agentId, e.name]));
  const me = `user:${user?.userId ?? ""}`;
  const ceoName = names.get(chart.ceoAgentId) ?? chart.ceoAgentId;

  const deskButton = (variant: "primary" | "secondary", size: "sm" | "md") => (
    <Button
      size={size}
      variant={variant}
      disabled={openingDesk}
      onClick={() => void openCeoDesk()}
      title={`${ceoName} · ${S.company.openDesk}`}
    >
      {openingDesk ? S.company.openingDesk : S.company.overview.openCeoDesk}
    </Button>
  );

  const stepAction = (step: FirstStep, current: boolean) => {
    const variant = current ? "primary" : "secondary";
    if (step === "ceo") return deskButton(variant, "sm");
    if (step === "hire") {
      return (
        <Button size="sm" variant={variant} onClick={() => page("chart")}>
          {S.company.overview.goToChart}
        </Button>
      );
    }
    return (
      <Button size="sm" variant={variant} onClick={() => page("calendar")}>
        {S.company.overview.goToCalendar}
      </Button>
    );
  };
  const stepText: Record<FirstStep, { title: string; body: string }> = {
    ceo: { title: S.company.overview.stepCeoTitle, body: S.company.overview.stepCeoBody },
    hire: { title: S.company.overview.stepHireTitle, body: S.company.overview.stepHireBody },
    schedule: {
      title: S.company.overview.stepScheduleTitle,
      body: S.company.overview.stepScheduleBody,
    },
  };

  const spendDetail =
    spend.budget === null
      ? S.company.noBudget
      : spend.remaining !== null && spend.remaining < 0
        ? S.company.overview.overBudget(formatMoney(-spend.remaining, currency))
        : S.company.overview.budgetLeft(formatMoney(spend.remaining ?? 0, currency));

  return (
    <OrgPage title={title} info={info} actions={deskButton("secondary", "sm")}>
      {error !== null && (
        <ErrorLine
          message={S.company.overview.refreshFailed}
          detail={error}
          onRetry={() => void load()}
          className="mb-4"
        />
      )}

      {/* Hero: the organization's identity, its state, and the period's spend as a ring. */}
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 border-b border-gray-200 pb-5 dark:border-gray-800">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{detail.name}</h2>
            <OrgStatusPill org={detail} />
          </div>
          <p className="mt-1.5 max-w-3xl text-sm text-gray-600 dark:text-gray-300">
            {detail.mission}
          </p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {S.company.overview.createdBy(detail.createdBy)} ·{" "}
            {S.company.overview.employeesCount(counts.total)} ·{" "}
            {S.company.overview.period(detail.spend.period)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => page("finance")}
          className={`flex items-center ${ICON_GAP.card} rounded-md px-2 py-1 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-900`}
        >
          <SpendRing
            cost={spend.cost}
            currency={currency}
            {...(spend.budget !== null ? { budget: spend.budget } : {})}
            {...(spend.ratio !== null ? { ratio: spend.ratio } : {})}
          />
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {S.company.overview.spend}
            </span>
            <span className="block text-lg font-semibold leading-tight tabular-nums">
              {formatMoney(spend.cost, currency)}
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {spend.budget === null
                ? S.company.noBudget
                : S.company.spendOfBudget(
                    formatMoney(spend.cost, currency),
                    formatMoney(spend.budget, currency),
                  )}
            </span>
          </span>
        </button>
      </header>

      {/* KPI strip: four cells ruled by hairlines, each the link to its page. */}
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-gray-200 bg-gray-200 lg:grid-cols-4 dark:border-gray-800 dark:bg-gray-800">
        <KpiCell
          label={S.company.overview.employees}
          value={counts.total}
          onClick={() => page("chart")}
          detail={
            <>
              <ToneCount tone="success" label={S.company.overview.onDesk} value={counts.onDesk} />
              <ToneCount tone="busy" label={S.company.overview.running} value={counts.running} />
              <ToneCount tone="attention" label={S.company.overview.paused} value={counts.paused} />
            </>
          }
        />
        <KpiCell
          label={S.company.overview.board}
          value={board.open}
          onClick={() => page("tickets")}
          interactive
          detail={
            <span className="block w-full">
              <span
                className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                role="img"
                aria-label={`${S.company.overview.openTickets} ${board.open} · ${S.company.overview.boardTotal(board.total)}`}
              >
                {board.segments
                  .filter((seg) => seg.count > 0)
                  .map((seg) => (
                    <span
                      key={seg.status}
                      title={`${S.company.tickets.columns[seg.status] ?? seg.status} ${seg.count}`}
                      className={`block h-full ${BOARD_FILL[seg.status]}`}
                      style={{ width: `${seg.share * 100}%` }}
                    />
                  ))}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                {board.segments.map((seg) => (
                  <button
                    key={seg.status}
                    type="button"
                    onClick={() => page("tickets", `?column=${seg.status}`)}
                    className={`inline-flex items-center ${ICON_GAP.tight} rounded px-1 text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800`}
                  >
                    <span
                      className={`block h-1.5 w-1.5 rounded-full ${BOARD_FILL[seg.status]}`}
                      aria-hidden
                    />
                    {S.company.tickets.columns[seg.status] ?? seg.status}
                    <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                      {seg.count}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => page("tickets", "?blocked=1")}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    detail.blockedTickets > 0 ? toneSurface.attention : toneSurface.muted
                  }`}
                >
                  {S.company.overview.blocked} {detail.blockedTickets}
                </button>
              </span>
            </span>
          }
        />
        <KpiCell
          label={S.company.overview.today}
          value={today.total}
          onClick={() => page("calendar")}
          detail={
            today.total === 0 ? (
              <span>{S.company.overview.todayEmpty}</span>
            ) : (
              <>
                {today.fired > 0 && (
                  <ToneCount tone="success" label={markLabel("fired")} value={today.fired} />
                )}
                {today.queued > 0 && (
                  <ToneCount tone="attention" label={markLabel("queued")} value={today.queued} />
                )}
                {today.failed > 0 && (
                  <ToneCount tone="danger" label={S.company.overview.failed} value={today.failed} />
                )}
                {today.paused > 0 && (
                  <ToneCount tone="muted" label={markLabel("paused")} value={today.paused} />
                )}
                <ToneCount
                  tone="attention"
                  label={S.company.overview.upcoming}
                  value={today.upcoming}
                />
              </>
            )
          }
        />
        <KpiCell
          label={S.company.overview.spend}
          value={formatMoney(spend.cost, currency)}
          onClick={() => page("finance")}
          detail={
            <span className="block w-full">
              <BudgetBar
                cost={spend.cost}
                currency={currency}
                compact
                {...(spend.budget !== null ? { budget: spend.budget } : {})}
                {...(spend.ratio !== null ? { ratio: spend.ratio } : {})}
              />
              <span className="mt-1.5 block">{spendDetail}</span>
            </span>
          }
        />
      </div>

      {steps.fresh ? (
        <OrgSection
          title={S.company.overview.firstStepsTitle}
          info={S.company.overview.firstStepsInfo}
          className="mt-8"
        >
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {FIRST_STEPS.map((step, i) => (
              <StepCard
                key={step}
                index={i + 1}
                done={steps.done[step]}
                current={steps.next === step}
                title={stepText[step].title}
                body={stepText[step].body}
                action={stepAction(step, steps.next === step)}
              />
            ))}
          </ol>
        </OrgSection>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
            {/* For me: every row is the place the decision is made. */}
            <OrgSection
              title={S.company.overview.pending}
              info={S.company.overview.pendingInfo}
              count={rows.length}
            >
              {rows.length === 0 ? (
                <OrgEmptyLine>{S.company.overview.pendingEmpty}</OrgEmptyLine>
              ) : (
                <ul className="space-y-0.5">
                  {rows.map((row) => {
                    if (row.kind === "mentions") {
                      return (
                        <li key="mentions">
                          <button type="button" onClick={() => page("chat")} className={rowClass}>
                            <span className={`shrink-0 ${toneInk.attention}`}>
                              <GlyphIcon d={NAV_ICONS.orgChat} size={ICON_SIZE.rowLead} />
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {S.company.overview.mentions(row.count)}
                            </span>
                            <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                              {S.company.overview.openMentions} ›
                            </span>
                          </button>
                        </li>
                      );
                    }
                    const t = row.ticket;
                    return (
                      <li key={`${row.kind}/${t.ticketId}`}>
                        <button
                          type="button"
                          onClick={() => openTicket(t.ticketId)}
                          title={
                            row.kind === "review"
                              ? S.company.overview.reviewHint
                              : S.company.overview.blockedHint
                          }
                          className={rowClass}
                        >
                          <PriorityBadge priority={t.priority} />
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          {row.kind === "review" ? (
                            <>
                              {t.owner !== undefined && (
                                <span className="hidden shrink-0 text-xs text-gray-500 sm:inline-flex dark:text-gray-400">
                                  <PrincipalChip principal={t.owner} names={names} />
                                </span>
                              )}
                              <Badge tone="amber">{S.company.tickets.columns.review}</Badge>
                            </>
                          ) : (
                            <>
                              <span className="hidden max-w-40 shrink-0 truncate text-xs text-gray-500 sm:inline dark:text-gray-400">
                                {t.blocked}
                              </span>
                              <Badge tone="amber">{S.company.overview.blockedByMe}</Badge>
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </OrgSection>

            {/* Today's timeline: a dot per instance on a rule, in the tone of its outcome. */}
            <OrgSection
              title={S.company.overview.today}
              count={today.total}
              actions={
                <Button size="sm" onClick={() => page("calendar")}>
                  {S.company.overview.viewAll}
                </Button>
              }
            >
              {today.entries.length === 0 ? (
                <OrgEmptyLine>{S.company.overview.todayEmpty}</OrgEmptyLine>
              ) : (
                <ol className="ml-1.5 border-l border-gray-200 dark:border-gray-800">
                  {today.entries.slice(0, TIMELINE_ROWS).map((entry) => {
                    const tone = TIMELINE_TONE[entry.mark];
                    return (
                      <li key={entry.key} className="relative pl-4">
                        <span
                          aria-hidden
                          className={`absolute -left-1 top-3 block h-1.5 w-1.5 rounded-full ${toneDot[tone]}`}
                        />
                        <button
                          type="button"
                          onClick={() => page("calendar")}
                          className={`${rowClass} px-1.5`}
                        >
                          <span className="w-11 shrink-0 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
                            {entry.at === null ? "—" : timeLabel(entry.at)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                          <span className="hidden shrink-0 text-xs text-gray-500 sm:inline-flex dark:text-gray-400">
                            <PrincipalChip
                              principal={agentPrincipal(entry.agentId)}
                              names={names}
                            />
                          </span>
                          <span className={`shrink-0 text-xs ${toneInk[tone]}`}>
                            {markLabel(entry.mark)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {today.entries.length > TIMELINE_ROWS && (
                    <li className="pl-4 pt-1 text-xs text-gray-400 dark:text-gray-500">
                      {S.company.overview.timelineMore(today.entries.length - TIMELINE_ROWS)}
                    </li>
                  )}
                </ol>
              )}
            </OrgSection>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
            {/* The latest chat: sender, when, the text; a message addressed to the user reads bold. */}
            <OrgSection
              title={S.company.overview.recentChat}
              actions={
                <Button size="sm" onClick={() => page("chat")}>
                  {S.company.overview.openChat}
                </Button>
              }
            >
              {detail.recentChat.length === 0 ? (
                <OrgEmptyLine>{S.company.overview.recentChatEmpty}</OrgEmptyLine>
              ) : (
                <ul className="space-y-0.5">
                  {chatTail(detail.recentChat, CHAT_ROWS).map((m) => {
                    const addressed = m.mentions.includes(me) || m.mentions.includes("all");
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => page("chat")}
                          className={`${rowClass} items-start`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                              <PrincipalChip principal={m.sender} names={names} />
                              <span className="ml-auto shrink-0">
                                {formatRelativeShort(m.time, locale)}
                              </span>
                            </span>
                            <span
                              className={`mt-0.5 line-clamp-2 block ${addressed ? "font-medium" : ""}`}
                            >
                              {m.text}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </OrgSection>

            {/* Budget alerts: who, warned or paused, when. */}
            <OrgSection title={S.company.overview.alerts} count={detail.alerts.length}>
              {detail.alerts.length === 0 ? (
                <OrgEmptyLine>{S.company.overview.alertsEmpty}</OrgEmptyLine>
              ) : (
                <ul className="space-y-0.5">
                  {detail.alerts.map((a) => (
                    <li key={`${a.agentId}/${a.period}`}>
                      <button type="button" onClick={() => page("finance")} className={rowClass}>
                        <span className="min-w-0 flex-1 truncate">
                          <PrincipalChip principal={agentPrincipal(a.agentId)} names={names} />
                        </span>
                        {a.pausedAt !== undefined ? (
                          <Badge tone="red">{S.company.finance.paused}</Badge>
                        ) : (
                          <Badge tone="amber">{S.company.finance.warned}</Badge>
                        )}
                        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                          {formatRelativeShort(a.pausedAt ?? a.warnedAt ?? "", locale)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </OrgSection>
          </div>
        </>
      )}
    </OrgPage>
  );
}
