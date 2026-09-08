/**
 * The organization's overview, a calm dashboard: a hero naming the organization (its status
 * pill, the line of metadata and the mission folded to one line), this period's spend against
 * the CEO's budget as a ring beside it, a KPI strip — employees (on desk / running / paused),
 * the board as a segmented bar with its blocked count, today's calendar, the spend — and then
 * three full-width runs, one under the other: the inbox (everything that needs the reader,
 * newest first), today's timeline with each instance's outcome, and the budget alerts. No card
 * is a link: each carries one corner button to the page it summarizes, so the controls inside a
 * card stay clickable and the destination is named rather than guessed. A brand-new
 * organization (nobody hired, empty board) gets the three-step guide in place of the sections.
 *
 * Loading discipline: the skeleton shows only until the first response or the first error;
 * a failed refresh keeps what was last read on screen under one error line with its retry.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
import { formatDateTime, formatMoney, formatRelativeShort } from "../../lib/format";
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
import { Chevron } from "../../components/ui/chevron";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { NAV_ICONS } from "../../components/ui/icons";
import { Segmented } from "../../components/ui/segmented";
import { toastError } from "../../components/ui/toast";
import { STAT_ICONS } from "../../lib/stat-icons";
import { orgChannelPath, orgPagePath } from "./company-nav";
import type { CompanyNavKey } from "./company-nav";
import { CHANNEL_ICON } from "./channel-sidebar";
import { OrgEmptyLine, OrgPage, OrgPageSkeleton, OrgSection, useOrg } from "./org-layout";
import {
  BudgetBar,
  ErrorLine,
  JumpButton,
  OrgStatusPill,
  PrincipalChip,
  SpendRing,
  principalLabel,
} from "./shared";
import { agentPrincipal } from "./principals";
import { timeLabel } from "./calendar-geom";
import {
  BOARD_SEGMENT_TONE,
  FIRST_STEPS,
  INBOX_FILTERS,
  TIMELINE_TONE,
  boardSummary,
  employeeCounts,
  firstSteps,
  inboxCounts,
  inboxMatches,
  inboxRows,
  missionClampedGuess,
  spendSummary,
  todaySummary,
} from "./overview-summary";
import type {
  FirstStep,
  InboxCategory,
  InboxFilter,
  InboxRow,
  InboxTarget,
  TimelineMark,
} from "./overview-summary";

/** How many of today's instances the timeline shows before pointing at the calendar. */
const TIMELINE_ROWS = 6;

/** The mark that leads an inbox row: the channel hash for what was said, the board's glyph for a ticket. */
const INBOX_ICON: Record<InboxCategory, string> = {
  mention: CHANNEL_ICON,
  review: NAV_ICONS.orgTickets,
  blocked: NAV_ICONS.orgTickets,
  message: CHANNEL_ICON,
};

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
 * The label row of a summary block: its name, and the one button that opens the page the
 * block summarizes. Shared by the KPI cells and the hero's spend block so the corner button
 * sits in the same place in all of them.
 */
function SummaryLabel({
  label,
  jump,
  onJump,
}: {
  label: string;
  /** The corner button's name — where it goes, e.g. "Open the org chart". */
  jump: string;
  onJump: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <JumpButton label={jump} onClick={onJump} />
    </div>
  );
}

/**
 * One cell of the KPI strip: its label with the corner button, the headline number, and the
 * detail line under it. The cell is a plain card rather than a link — several cells carry
 * their own controls in the detail, which a card-wide click would swallow, and a card that is
 * silently clickable never says where the click lands.
 */
function KpiCell({
  label,
  value,
  detail,
  jump,
  onJump,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  jump: string;
  onJump: () => void;
}) {
  return (
    <div className="flex min-h-28 flex-col justify-between bg-white px-4 py-3 dark:bg-gray-950">
      <div>
        <SummaryLabel label={label} jump={jump} onJump={onJump} />
        <span className="mt-1 block text-2xl font-semibold leading-none tabular-nums">{value}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        {detail}
      </div>
    </div>
  );
}

/**
 * The organization's mission under the hero's metadata line: a label, one clamped line, and
 * the chevron that opens it. Missions run to paragraphs, and a hero that prints one whole
 * pushes the dashboard itself below the fold. Collapsed on every visit — the mission is read
 * once, not tracked — so nothing is persisted.
 *
 * Whether the toggle is offered at all is a measurement (`scrollHeight > clientHeight` on the
 * clamped paragraph, re-taken on resize), seeded by a guess from the text so the toggle does
 * not flicker in after the first paint. The measurement only holds while collapsed: unclamped,
 * the two heights are equal and re-measuring would take the toggle away mid-read.
 */
function MissionFold({ mission }: { mission: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(() => missionClampedGuess(mission));
  const textRef = useRef<HTMLParagraphElement>(null);
  const bodyId = useId();
  useLayoutEffect(() => {
    if (expanded) return;
    const el = textRef.current;
    if (el === null) return;
    // A sub-pixel line height leaves the two heights a fraction apart on a text that fits.
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [expanded, mission]);
  if (mission.trim() === "") return null;
  const toggle = expanded ? S.company.overview.collapse : S.company.overview.expand;
  return (
    <div className="mt-3 max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {S.company.overview.mission}
      </p>
      <div className="mt-0.5 flex items-baseline gap-3">
        <p
          ref={textRef}
          id={bodyId}
          className={`min-w-0 flex-1 text-sm text-gray-600 dark:text-gray-300 ${
            expanded ? "whitespace-pre-line" : "line-clamp-1"
          }`}
        >
          {mission}
        </p>
        {overflows && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={toggle}
            aria-expanded={expanded}
            aria-controls={bodyId}
            className={`inline-flex shrink-0 items-center ${ICON_GAP.tight} rounded text-xs text-gray-500 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200`}
          >
            {toggle}
            <Chevron open={expanded} size={ICON_SIZE.chevronDense} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * An inbox row's state dot: attention while the row needs the reader, muted once it is only
 * news. The one case where the colour would carry alone — a channel message that names the
 * reader, whose category chip says only "message" — spells itself out for a screen reader.
 */
function InboxDot({ row }: { row: InboxRow }) {
  const addressed = row.category === "message" && row.tone === "attention";
  return (
    <span className="flex shrink-0 items-center">
      <span aria-hidden className={`block h-1.5 w-1.5 rounded-full ${toneDot[row.tone]}`} />
      {addressed && <span className="sr-only">{S.company.overview.inboxCategories.mention}</span>}
    </span>
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
  /** The inbox chip in force; local to the visit, as a filter over one section should be. */
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("all");

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
  const { messages, tickets, runs, budget } = company.versions;
  useEffect(() => {
    void load();
  }, [load, messages, tickets, runs, budget]);

  const page = (key: CompanyNavKey, query = "") =>
    navigate(`${orgPagePath(projectId, orgId, key)}${query}`);
  const openTicket = (ticketId: string) =>
    page("tickets", `?ticket=${encodeURIComponent(ticketId)}`);
  /** Where an inbox row leads: the channel it was said in, or the ticket it is about. */
  const openInboxRow = (target: InboxTarget) => {
    if (target.kind === "ticket") openTicket(target.ticketId);
    else navigate(orgChannelPath(projectId, orgId, target.channelId));
  };

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
  const names = new Map(chart.employees.map((e) => [e.agentId, e.name]));
  const me = `user:${user?.userId ?? ""}`;
  const inbox = inboxRows({
    pending: detail.pending,
    recentMessages: detail.recentMessages,
    me,
    names: (principal) => principalLabel(principal, names),
    mentionsTitle: S.company.overview.mentions,
  });
  const inboxTotals = inboxCounts(inbox);
  const visibleInbox = inbox.filter((row) => inboxMatches(row, inboxFilter));
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

      {/* Hero: name and state, the metadata line, the mission folded, and the period's spend. */}
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 border-b border-gray-200 pb-5 dark:border-gray-800">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{detail.name}</h2>
            <OrgStatusPill org={detail} />
          </div>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {S.company.overview.createdBy(detail.createdBy)} ·{" "}
            {S.company.overview.employeesCount(counts.total)} ·{" "}
            {S.company.overview.period(detail.spend.period)}
          </p>
          <MissionFold mission={detail.mission} />
        </div>
        <div className="min-w-56 shrink-0">
          <SummaryLabel
            label={S.company.overview.spend}
            jump={S.company.overview.openFinance}
            onJump={() => page("finance")}
          />
          <div className={`mt-1.5 flex items-center ${ICON_GAP.card}`}>
            <SpendRing
              cost={spend.cost}
              currency={currency}
              {...(spend.budget !== null ? { budget: spend.budget } : {})}
              {...(spend.ratio !== null ? { ratio: spend.ratio } : {})}
            />
            <span className="min-w-0">
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
          </div>
        </div>
      </header>

      {/* KPI strip: four cells ruled by hairlines, each with the button that opens its page. */}
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-gray-200 bg-gray-200 lg:grid-cols-4 dark:border-gray-800 dark:bg-gray-800">
        <KpiCell
          label={S.company.overview.employees}
          value={counts.total}
          jump={S.company.overview.openChart}
          onJump={() => page("chart")}
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
          jump={S.company.overview.openBoard}
          onJump={() => page("tickets")}
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
          jump={S.company.overview.openCalendar}
          onJump={() => page("calendar")}
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
          jump={S.company.overview.openFinance}
          onJump={() => page("finance")}
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
          {/* The inbox: everything that needs the reader, newest first. */}
          <OrgSection
            title={S.company.overview.inbox}
            info={S.company.overview.inboxInfo}
            count={inbox.length}
            className="mt-8"
            actions={
              <div role="group" aria-label={S.company.overview.inbox}>
                <Segmented
                  cols={4}
                  value={inboxFilter}
                  onChange={setInboxFilter}
                  options={INBOX_FILTERS.map((f) => ({
                    value: f,
                    label: `${S.company.overview.inboxFilters[f]} ${inboxTotals[f]}`,
                  }))}
                />
              </div>
            }
          >
            {visibleInbox.length === 0 ? (
              <OrgEmptyLine>{S.company.overview.inboxEmpty}</OrgEmptyLine>
            ) : (
              <ul className="space-y-0.5">
                {visibleInbox.map((row) => (
                  <li key={row.key}>
                    <button
                      type="button"
                      onClick={() => openInboxRow(row.target)}
                      className={rowClass}
                    >
                      <span
                        className={`flex w-20 shrink-0 items-center ${ICON_GAP.tight} text-xs text-gray-500 dark:text-gray-400`}
                      >
                        <GlyphIcon d={INBOX_ICON[row.category]} size={ICON_SIZE.rowLead} />
                        <span className="truncate">
                          {S.company.overview.inboxCategories[row.category]}
                        </span>
                      </span>
                      <InboxDot row={row} />
                      <span className="min-w-0 flex-1 truncate">{row.title}</span>
                      {row.detail !== undefined && (
                        <span className="hidden max-w-40 shrink-0 truncate text-xs text-gray-500 sm:inline dark:text-gray-400">
                          {row.detail}
                        </span>
                      )}
                      <span
                        className="w-20 shrink-0 text-right text-xs tabular-nums text-gray-400 dark:text-gray-500"
                        {...(row.time !== null ? { title: formatDateTime(row.time) } : {})}
                      >
                        {row.time === null ? "—" : formatRelativeShort(row.time, locale)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </OrgSection>

          {/* Today's timeline: a dot per instance on a rule, in the tone of its outcome. */}
          <OrgSection
            title={S.company.overview.today}
            count={today.total}
            className="mt-8"
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
                          <PrincipalChip principal={agentPrincipal(entry.agentId)} names={names} />
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

          {/* Budget alerts: who, warned or paused, when. */}
          <OrgSection
            title={S.company.overview.alerts}
            count={detail.alerts.length}
            className="mt-8"
          >
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
        </>
      )}
    </OrgPage>
  );
}
