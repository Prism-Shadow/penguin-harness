/**
 * The organization's overview: four summary blocks — employees (on desk / running / paused),
 * the board (per-column counts and the blocked count, each a link into the ticket page's
 * filter), today's calendar as a timeline with each instance's outcome, and this period's
 * spend against the CEO's budget — then what needs the user (mentions, tickets in review,
 * tickets blocked on them), the latest chat and the budget alerts. Every block opens the
 * page it summarizes.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { OrgChartResponse, OrganizationDetail } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatMoney } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneInk, toneStrip } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useCompany } from "../../state/company";
import { useTheme } from "../../state/theme";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { EmptyState } from "../../components/ui/empty-state";
import { toastError } from "../../components/ui/toast";
import { orgPagePath } from "./company-nav";
import { OrgPage, OrgPageSkeleton, OrgSection, useOrg } from "./org-layout";
import { BudgetBar, CountPill, PrincipalChip, PriorityBadge, Stat } from "./shared";
import { TICKET_COLUMNS } from "./ticket-board";
import { agentPrincipal } from "./principals";
import { timeLabel } from "./calendar-geom";

const OUTCOME_TONE: Record<string, Tone> = {
  fired: "success",
  queued: "attention",
  paused: "muted",
  missed: "danger",
  error: "danger",
};

/** A whole summary block as a button: the block IS the link to its page. */
const blockClass =
  "block w-full rounded-md border border-gray-200 p-3 text-left transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-900/60";

export function OverviewPage() {
  const { projectId, orgId, org } = useOrg();
  const navigate = useNavigate();
  const company = useCompany();
  const { user } = useAuth();
  const { currency } = useTheme();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.overview}` : S.nav.org.overview);
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [chart, setChart] = useState<OrgChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingDesk, setOpeningDesk] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([
        api.getOrganization(projectId, orgId),
        api.getOrgChart(projectId, orgId),
      ]);
      setDetail(d);
      setChart(c);
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId]);

  // Every event family moves something on this page: reload on any of them.
  const { chat, tickets, runs, budget } = company.versions;
  useEffect(() => {
    void load();
  }, [load, chat, tickets, runs, budget]);

  const page = (key: Parameters<typeof orgPagePath>[2], query = "") =>
    navigate(`${orgPagePath(projectId, orgId, key)}${query}`);

  const names = new Map((chart?.employees ?? []).map((e) => [e.agentId, e.name]));

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

  if (error !== null && detail === null) {
    return (
      <OrgPage title={S.nav.org.overview} info={S.company.overview.info}>
        <EmptyState
          title={error}
          action={<Button onClick={() => void load()}>{S.common.retry}</Button>}
        />
      </OrgPage>
    );
  }
  if (detail === null || chart === null) {
    return (
      <OrgPage title={S.nav.org.overview} info={S.company.overview.info}>
        <OrgPageSkeleton />
      </OrgPage>
    );
  }

  const employees = chart.employees;
  const onDesk = employees.filter((e) => e.desk !== undefined).length;
  const running = employees.filter((e) => e.state === "running").length;
  const paused = employees.filter((e) => e.state === "paused").length;
  const boardTotal = TICKET_COLUMNS.reduce((n, c) => n + (detail.board[c] ?? 0), 0);
  const fresh = employees.length <= 1 && boardTotal === 0 && detail.today.length === 0;
  const me = user?.userId ?? "";

  return (
    <OrgPage title={S.nav.org.overview} info={S.company.overview.info}>
      {fresh && (
        <div
          className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs ${toneStrip.muted}`}
        >
          <span>{S.company.overview.firstStep}</span>
          <Button
            size="sm"
            variant="primary"
            disabled={openingDesk}
            onClick={() => void openCeoDesk()}
          >
            {openingDesk ? S.company.openingDesk : S.company.openDesk}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* Employees */}
        <button type="button" className={blockClass} onClick={() => page("chart")}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {S.company.overview.employees}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={S.company.overview.onDesk} value={onDesk} />
            <Stat
              label={S.company.overview.running}
              value={running}
              tone={running > 0 ? "busy" : undefined}
            />
            <Stat
              label={S.company.overview.paused}
              value={paused}
              tone={paused > 0 ? "attention" : undefined}
            />
          </div>
        </button>

        {/* Board */}
        <div
          className={`${blockClass} cursor-default hover:border-gray-200 hover:bg-transparent dark:hover:border-gray-800 dark:hover:bg-transparent`}
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {S.company.overview.board}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TICKET_COLUMNS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => page("tickets", `?column=${c}`)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-gray-600 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {S.company.tickets.columns[c] ?? c}
                <span className="font-semibold tabular-nums">{detail.board[c] ?? 0}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => page("tickets", "?blocked=1")}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <CountPill tone={detail.blockedTickets > 0 ? "attention" : "muted"}>
                {S.company.overview.blocked} {detail.blockedTickets}
              </CountPill>
            </button>
          </div>
        </div>

        {/* Today */}
        <button type="button" className={blockClass} onClick={() => page("calendar")}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {S.company.overview.today}
          </p>
          {detail.today.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {S.company.overview.todayEmpty}
            </p>
          ) : (
            <ul className="space-y-1">
              {detail.today.slice(0, 5).map((ev) => {
                const at = ev.lastFiredAt ?? ev.nextFireAt;
                const outcome = ev.lastOutcome ?? null;
                return (
                  <li key={`${ev.agentId}/${ev.name}`} className="flex items-center gap-2 text-xs">
                    <span className="w-11 shrink-0 font-mono tabular-nums text-gray-500 dark:text-gray-400">
                      {at !== undefined ? timeLabel(Date.parse(at)) : "—"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{ev.title ?? ev.name}</span>
                    <span className="shrink-0 truncate text-gray-400 dark:text-gray-500">
                      {names.get(ev.agentId) ?? ev.agentId}
                    </span>
                    {outcome !== null && (
                      <span className={`shrink-0 ${toneInk[OUTCOME_TONE[outcome] ?? "muted"]}`}>
                        {S.company.calendarOutcomes[outcome] ?? outcome}
                      </span>
                    )}
                  </li>
                );
              })}
              {detail.today.length > 5 && (
                <li className="text-xs text-gray-400">
                  {S.company.calendar.moreEvents(detail.today.length - 5)}
                </li>
              )}
            </ul>
          )}
        </button>

        {/* Spend */}
        <button type="button" className={blockClass} onClick={() => page("finance")}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {S.company.overview.spend} · {detail.spend.period}
          </p>
          <BudgetBar
            cost={detail.spend.cost}
            currency={currency}
            {...(detail.spend.budget !== undefined ? { budget: detail.spend.budget } : {})}
            {...(detail.spend.ratio !== undefined ? { ratio: detail.spend.ratio } : {})}
          />
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OrgSection title={S.company.overview.pending} info={S.company.overview.pendingInfo}>
          {detail.pending.mentions === 0 &&
          detail.pending.reviewTickets.length === 0 &&
          detail.pending.blockedByMe.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {S.company.overview.pendingEmpty}
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              {detail.pending.mentions > 0 && (
                <button
                  type="button"
                  onClick={() => page("chat")}
                  className={`flex items-center gap-2 ${toneInk.attention} hover:underline`}
                >
                  {S.company.overview.mentions(detail.pending.mentions)}
                </button>
              )}
              {detail.pending.reviewTickets.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                    {S.company.overview.reviewTickets}
                  </p>
                  <ul className="space-y-1">
                    {detail.pending.reviewTickets.map((t) => (
                      <li key={t.ticketId}>
                        <button
                          type="button"
                          onClick={() =>
                            page("tickets", `?ticket=${encodeURIComponent(t.ticketId)}`)
                          }
                          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <PriorityBadge priority={t.priority} />
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          {t.owner !== undefined && (
                            <span className="shrink-0 text-xs text-gray-400">
                              <PrincipalChip principal={t.owner} names={names} />
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detail.pending.blockedByMe.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                    {S.company.overview.blockedByMe}
                  </p>
                  <ul className="space-y-1">
                    {detail.pending.blockedByMe.map((t) => (
                      <li key={t.ticketId}>
                        <button
                          type="button"
                          onClick={() =>
                            page("tickets", `?ticket=${encodeURIComponent(t.ticketId)}`)
                          }
                          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          <span className="shrink-0 truncate text-xs text-gray-400">
                            {t.blocked}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </OrgSection>

        <OrgSection
          title={S.company.overview.recentChat}
          actions={
            <Button size="sm" onClick={() => page("chat")}>
              {S.company.overview.openChat}
            </Button>
          }
        >
          {detail.recentChat.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {S.company.overview.recentChatEmpty}
            </p>
          ) : (
            <ul className="space-y-2">
              {detail.recentChat.slice(-6).map((m) => (
                <li key={m.id} className="text-sm">
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <PrincipalChip principal={m.sender} names={names} />
                    <span className="ml-auto shrink-0">{formatDateTime(m.time)}</span>
                  </div>
                  <p
                    className={`mt-0.5 line-clamp-2 ${m.mentions.includes(`user:${me}`) || m.mentions.includes("all") ? "font-medium" : ""}`}
                  >
                    {m.text}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </OrgSection>
      </div>

      <OrgSection title={S.company.overview.alerts} className="mt-6">
        {detail.alerts.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {S.company.overview.alertsEmpty}
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {detail.alerts.map((a) => (
              <li key={`${a.agentId}/${a.period}`} className="flex flex-wrap items-center gap-2">
                <PrincipalChip principal={agentPrincipal(a.agentId)} names={names} />
                {a.pausedAt !== undefined ? (
                  <Badge tone="red">{S.company.finance.paused}</Badge>
                ) : (
                  <Badge tone="amber">{S.company.finance.warned}</Badge>
                )}
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDateTime(a.pausedAt ?? a.warnedAt ?? "")}
                </span>
                <span className="text-xs text-gray-400">{a.period}</span>
              </li>
            ))}
          </ul>
        )}
        {detail.spend.budget !== undefined && (
          <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
            {S.company.spendOfBudget(
              formatMoney(detail.spend.cost, currency),
              formatMoney(detail.spend.budget, currency),
            )}
          </p>
        )}
      </OrgSection>
    </OrgPage>
  );
}
