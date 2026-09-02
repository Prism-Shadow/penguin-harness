/**
 * Finance: budgets and spend for one period. The KPI row puts the organization's total
 * against the CEO's budget (the ring), the ratio in its threshold tone, the head count and
 * the alert count; the spend tree walks the reporting line with own / cumulative / budget /
 * ratio per employee and edits a budget in place (written straight to the employee); the
 * ticket table rolls costs up along parent tickets; the daily costs draw on the cost
 * center's trend chart; and the period's warnings and pauses are listed by state with how a
 * pause is lifted. `?period=yyyy-mm` switches between this period and the previous one.
 *
 * Loading discipline: the skeleton stands only until the first response; a failed first
 * fetch is an error with a retry; a failed refetch keeps the last good data on screen and
 * says so in a strip above it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { OrgBudgetAlert, OrgFinanceResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatMoney, formatPercent } from "../../lib/format";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { STAT_ICONS } from "../../lib/stat-icons";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneDot, toneInk, toneStrip } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { useTheme } from "../../state/theme";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CloseIcon } from "../../components/ui/icons";
import { InfoPopover } from "../../components/ui/info-popover";
import { noAutofill } from "../../components/ui/input";
import { Segmented } from "../../components/ui/segmented";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { TrendChart } from "../usage/trend-chart";
import { orgPagePath } from "./company-nav";
import { OrgPage, OrgPageSkeleton, OrgSection, useOrg } from "./org-layout";
import { BudgetBar, PrincipalChip, Stat, TicketStatusBadge } from "./shared";
import { FinanceGauge } from "./finance-gauge";
import {
  budgetTone,
  dailyBreaks,
  financeKpis,
  financeSeries,
  groupAlerts,
  shiftPeriod,
  spendTreeRows,
  ticketTreeRows,
} from "./finance-tree";
import { agentPrincipal } from "./principals";

/** Pencil (lucide): the budget cell's edit affordance. */
const PENCIL_ICON =
  "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4";

const cellClass = "px-2 py-2 text-right tabular-nums";
const headClass = "px-2 py-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400";
const iconButtonClass =
  "inline-flex items-center justify-center rounded p-0.5 text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200";

/** The tree's indentation step per reporting depth, and the elbow that joins a child to the row above. */
const INDENT_PX = 20;

function TreeElbow() {
  return (
    <span
      aria-hidden
      className="mt-0.5 h-2.5 w-2.5 shrink-0 self-start rounded-bl-sm border-b border-l border-gray-300 dark:border-gray-700"
    />
  );
}

/** A tone dot with its meaning beside it: the row marks for a paused or warned employee. */
function StateMark({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center ${ICON_GAP.tight} text-[11px] ${toneInk[tone]}`}
    >
      <span className={`block h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} />
      {children}
    </span>
  );
}

/**
 * The budget cell while it is being typed: a number box (empty = unbounded, said beneath it
 * while typing), save and cancel. Enter saves, Escape cancels, and focus leaving the editor
 * saves too — the two buttons keep focus on mousedown so clicking cancel never saves first.
 */
function BudgetEditor({
  initial,
  name,
  busy,
  onSave,
  onCancel,
}: {
  initial: number | undefined;
  name: string;
  busy: boolean;
  onSave: (value: number | null) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial === undefined ? "" : String(initial));
  const wrapRef = useRef<HTMLSpanElement>(null);
  const commit = () => {
    const t = text.trim();
    if (t === "") {
      onSave(null);
      return;
    }
    const v = Number(t);
    if (!Number.isFinite(v) || v < 0) {
      toastError(S.company.chart.budgetHint);
      return;
    }
    onSave(v);
  };
  return (
    <span
      ref={wrapRef}
      className="inline-flex flex-col items-end gap-0.5"
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) commit();
      }}
    >
      <span className={`inline-flex items-center ${ICON_GAP.tight}`}>
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={text}
          placeholder={S.company.finance.budgetPlaceholder}
          aria-label={S.company.finance.editBudgetOf(name)}
          disabled={busy}
          {...noAutofill}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="w-24 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/30 dark:border-gray-700 dark:bg-gray-900"
        />
        <button
          type="button"
          title={S.company.finance.saveBudget}
          aria-label={S.company.finance.saveBudget}
          disabled={busy}
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          className={iconButtonClass}
        >
          <GlyphIcon d={STAT_ICONS.check} size={ICON_SIZE.inlineGlyph} />
        </button>
        <button
          type="button"
          title={S.company.finance.cancelEdit}
          aria-label={S.company.finance.cancelEdit}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCancel}
          className={iconButtonClass}
        >
          <CloseIcon />
        </button>
      </span>
      <span className="text-[10px] text-gray-400 dark:text-gray-500">
        {S.company.finance.budgetEmptyHint}
      </span>
    </span>
  );
}

/** One alert line: the employee, and when it crossed the threshold. */
function AlertRow({
  alert,
  tone,
  names,
}: {
  alert: OrgBudgetAlert;
  tone: Tone;
  names: ReadonlyMap<string, string>;
}) {
  const at = tone === "danger" ? alert.pausedAt : alert.warnedAt;
  const when = at === undefined ? "" : formatDateTime(at);
  return (
    <li className={`flex flex-wrap items-center ${ICON_GAP.menu} py-1 text-xs`}>
      <span className={`block h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[tone]}`} />
      <PrincipalChip
        principal={agentPrincipal(alert.agentId)}
        names={names}
        size={ICON_SIZE.rowLead}
      />
      <span className="text-gray-500 dark:text-gray-400">
        {tone === "danger" ? S.company.finance.pausedAt(when) : S.company.finance.warnedAt(when)}
      </span>
    </li>
  );
}

export function FinancePage() {
  const { projectId, orgId, org } = useOrg();
  const navigate = useNavigate();
  const company = useCompany();
  const { currency } = useTheme();
  const [params, setParams] = useSearchParams();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.finance}` : S.nav.org.finance);
  const [data, setData] = useState<OrgFinanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Ticket owners, joined from the board (best effort: the finance rows carry none). */
  const [owners, setOwners] = useState<ReadonlyMap<string, string>>(new Map());
  /** The employee whose budget is being typed. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requested = params.get("period");
  /** Sequence of the newest request: a slower, older response must not overwrite a newer one. */
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    void api
      .listOrgTickets(projectId, orgId)
      .then((res) => {
        if (my !== seq.current) return;
        const map = new Map<string, string>();
        for (const column of Object.values(res.columns)) {
          for (const t of column) if (t.owner !== undefined) map.set(t.ticketId, t.owner);
        }
        setOwners(map);
      })
      .catch(() => undefined);
    try {
      const res = await api.getOrgFinance(projectId, orgId, requested ?? undefined);
      if (my !== seq.current) return;
      setData(res);
      setError(null);
    } catch (e) {
      if (my !== seq.current) return;
      setError(apiErrorText(e));
    }
  }, [projectId, orgId, requested]);
  const { budget: budgetVersion, runs } = company.versions;
  useEffect(() => {
    void load();
  }, [load, budgetVersion, runs]);

  const names = new Map((data?.employees ?? []).map((e) => [e.agentId, e.name]));
  // The current period is the organization's (its summary is computed in its timezone); the
  // response's period only stands in before the summary is known.
  const currentPeriod = org?.spend.period ?? (requested === null ? (data?.period ?? "") : "");
  const previous = currentPeriod === "" ? null : shiftPeriod(currentPeriod, -1);
  const target = requested ?? currentPeriod;
  const setPeriod = (p: string) => {
    const next = new URLSearchParams(params);
    if (p === currentPeriod) next.delete("period");
    else next.set("period", p);
    setParams(next, { replace: true });
  };

  const saveBudget = async (agentId: string, value: number | null) => {
    const row = data?.employees.find((e) => e.agentId === agentId);
    if (row !== undefined && (row.budget ?? null) === value) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    try {
      await api.patchOrgEmployee(projectId, orgId, agentId, { budget: value });
      toastSuccess(S.company.finance.budgetSaved);
      setEditingId(null);
      void load();
      void company.reloadOrganizations();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const periodSwitch =
    previous !== null ? (
      <Segmented
        options={[
          { value: previous, label: `${S.company.finance.prevPeriod} ${previous}` },
          { value: currentPeriod, label: `${S.company.finance.thisPeriod} ${currentPeriod}` },
        ]}
        value={target === previous ? previous : currentPeriod}
        onChange={setPeriod}
        cols={2}
      />
    ) : undefined;

  if (data === null) {
    return (
      <OrgPage title={S.nav.org.finance} info={S.company.finance.info} actions={periodSwitch}>
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

  const kpis = financeKpis(data);
  const ratioTone = budgetTone(kpis.ratio);
  const gaugeLabel =
    kpis.budget === undefined
      ? `${formatMoney(kpis.total, currency)} · ${S.company.noBudget}`
      : `${S.company.spendOfBudget(formatMoney(kpis.total, currency), formatMoney(kpis.budget, currency))} · ${formatPercent(kpis.ratio)}`;
  const rows = spendTreeRows(data.employees);
  const ticketRows = ticketTreeRows(data.tickets);
  const series = financeSeries(data.daily);
  const alerts = groupAlerts(data.alerts);
  // A period switch keeps the last data on screen, dimmed, until the new one lands.
  const stale = target !== "" && data.period !== target;
  const openTicket = (ticketId: string) =>
    navigate(`${orgPagePath(projectId, orgId, "tickets")}?ticket=${encodeURIComponent(ticketId)}`);

  return (
    <OrgPage title={S.nav.org.finance} info={S.company.finance.info} actions={periodSwitch}>
      {error !== null && (
        <div
          className={`mb-4 flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs ${toneStrip.danger}`}
        >
          <span>
            {S.company.finance.refreshFailed} · {error}
          </span>
          <Button size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        </div>
      )}
      <div className={stale ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {/* KPI row: the organization's total against the CEO's budget, then the counts. */}
        <div className="mb-2 flex flex-wrap items-center gap-x-10 gap-y-4">
          <div className={`flex items-center ${ICON_GAP.card}`}>
            <FinanceGauge ratio={kpis.ratio} label={gaugeLabel} />
            <div>
              <Stat label={S.company.finance.kpiTotal} value={formatMoney(kpis.total, currency)} />
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {S.company.finance.orgBudget} ·{" "}
                {kpis.budget === undefined
                  ? S.company.noBudget
                  : formatMoney(kpis.budget, currency)}
              </p>
            </div>
          </div>
          <div>
            <Stat
              label={S.company.finance.ratio}
              value={formatPercent(kpis.ratio)}
              {...(ratioTone === "muted" ? {} : { tone: ratioTone })}
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {S.company.finance.thresholds}
            </p>
          </div>
          <div>
            <Stat label={S.company.finance.kpiEmployees} value={kpis.employees} />
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {S.company.finance.budgetsSet(kpis.budgeted)}
            </p>
          </div>
          <div>
            <Stat
              label={S.company.finance.kpiAlerts}
              value={data.alerts.length}
              {...(kpis.paused > 0
                ? { tone: "danger" as const }
                : kpis.warned > 0
                  ? { tone: "attention" as const }
                  : {})}
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {S.company.finance.alertsSummary(kpis.warned, kpis.paused)}
            </p>
          </div>
        </div>
        {data.unpriced && (
          <p className="mb-2 text-xs text-gray-400 dark:text-gray-500">
            {S.company.finance.unpriced}
          </p>
        )}

        <OrgSection
          title={S.company.finance.spendTree}
          info={S.company.finance.spendTreeInfo}
          className="mt-6"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-xs">
              <thead>
                <tr>
                  <th className={`${headClass} text-left`}>{S.company.overview.employees}</th>
                  <th className={`${headClass} text-right`}>{S.company.finance.own}</th>
                  <th className={`${headClass} text-right`}>
                    <span className={`inline-flex items-center ${ICON_GAP.tight}`}>
                      {S.company.finance.cumulative}
                      <InfoPopover label={S.company.finance.cumulative}>
                        {S.company.finance.cumulativeInfo}
                      </InfoPopover>
                    </span>
                  </th>
                  <th className={`${headClass} text-right`}>{S.company.finance.budget}</th>
                  <th className={`${headClass} w-44 text-left`}>{S.company.finance.ratio}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {rows.map(({ employee, depth }) => {
                  const tone = budgetTone(employee.ratio);
                  const editing = editingId === employee.agentId;
                  return (
                    <tr key={employee.agentId}>
                      <td className="px-2 py-2" style={{ paddingLeft: 8 + depth * INDENT_PX }}>
                        <span className={`flex min-w-0 items-center ${ICON_GAP.row}`}>
                          {depth > 0 && <TreeElbow />}
                          <AgentAvatar
                            id={employee.agentId}
                            name={employee.name}
                            size={ICON_SIZE.navRow}
                            className="shrink-0 rounded"
                          />
                          <span className="truncate font-medium text-gray-900 dark:text-gray-100">
                            {employee.name}
                          </span>
                          {employee.reportsTo === null &&
                            employee.title.trim().toLowerCase() !== "ceo" && (
                              <Badge tone="gray">{S.company.ceo}</Badge>
                            )}
                          <span className="truncate text-gray-400 dark:text-gray-500">
                            {employee.title}
                          </span>
                          {employee.paused ? (
                            <StateMark tone="danger">{S.company.finance.paused}</StateMark>
                          ) : employee.warned ? (
                            <StateMark tone="attention">{S.company.finance.warned}</StateMark>
                          ) : null}
                        </span>
                      </td>
                      <td className={`${cellClass} text-gray-600 dark:text-gray-300`}>
                        {formatMoney(employee.own, currency)}
                      </td>
                      <td className={`${cellClass} font-semibold text-gray-900 dark:text-gray-100`}>
                        {formatMoney(employee.cumulative, currency)}
                      </td>
                      <td className={cellClass}>
                        {editing ? (
                          <BudgetEditor
                            initial={employee.budget}
                            name={employee.name}
                            busy={busy}
                            onSave={(value) => void saveBudget(employee.agentId, value)}
                            onCancel={() => setEditingId(null)}
                          />
                        ) : (
                          <button
                            type="button"
                            title={S.company.finance.editBudget}
                            aria-label={S.company.finance.editBudgetOf(employee.name)}
                            onClick={() => setEditingId(employee.agentId)}
                            className={`group inline-flex items-center ${ICON_GAP.tight} rounded px-1.5 py-0.5 tabular-nums transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800`}
                          >
                            <span
                              className={
                                employee.budget === undefined
                                  ? "text-gray-400 dark:text-gray-500"
                                  : "text-gray-900 dark:text-gray-100"
                              }
                            >
                              {employee.budget === undefined
                                ? S.company.noBudget
                                : formatMoney(employee.budget, currency)}
                            </span>
                            <GlyphIcon
                              d={PENCIL_ICON}
                              size={ICON_SIZE.inlineGlyph}
                              className="text-gray-300 transition-colors duration-150 group-hover:text-gray-600 dark:text-gray-600 dark:group-hover:text-gray-300"
                            />
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {employee.budget === undefined ? (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        ) : (
                          <span className={`flex items-center ${ICON_GAP.menu}`}>
                            <span className="w-24">
                              <BudgetBar
                                compact
                                cost={employee.cumulative}
                                currency={currency}
                                budget={employee.budget}
                                {...(employee.ratio !== undefined ? { ratio: employee.ratio } : {})}
                              />
                            </span>
                            <span
                              className={`w-12 text-right font-medium tabular-nums ${tone === "muted" ? "text-gray-400" : toneInk[tone]}`}
                            >
                              {formatPercent(employee.ratio)}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </OrgSection>

        <OrgSection
          title={S.company.finance.ticketsTable}
          info={S.company.finance.ticketsInfo}
          className="mt-8"
        >
          {ticketRows.length === 0 ? (
            <p className="py-2 text-xs text-gray-400 dark:text-gray-500">
              {S.company.finance.ticketsEmpty}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-xs">
                <thead>
                  <tr>
                    <th className={`${headClass} text-left`}>{S.nav.org.tickets}</th>
                    <th className={`${headClass} text-left`}>{S.company.status}</th>
                    <th className={`${headClass} text-left`}>{S.company.tickets.owner}</th>
                    <th className={`${headClass} text-right`}>{S.company.tickets.cost}</th>
                    <th className={`${headClass} text-right`}>
                      <span className={`inline-flex items-center ${ICON_GAP.tight}`}>
                        {S.company.finance.rolledUp}
                        <InfoPopover label={S.company.finance.rolledUp}>
                          {S.company.finance.rolledUpInfo}
                        </InfoPopover>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {ticketRows.map(({ ticket, depth }) => {
                    const owner = owners.get(ticket.ticketId);
                    return (
                      <tr key={ticket.ticketId}>
                        <td className="px-2 py-2" style={{ paddingLeft: 8 + depth * INDENT_PX }}>
                          <span className={`flex min-w-0 items-center ${ICON_GAP.row}`}>
                            {depth > 0 && <TreeElbow />}
                            <button
                              type="button"
                              title={S.company.finance.openTicket}
                              onClick={() => openTicket(ticket.ticketId)}
                              className="truncate text-left font-medium text-gray-900 hover:underline dark:text-gray-100"
                            >
                              {ticket.title}
                            </button>
                            <span className="shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500">
                              {ticket.ticketId}
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <TicketStatusBadge status={ticket.status} />
                        </td>
                        <td className="px-2 py-2">
                          {owner === undefined ? (
                            <span className="text-gray-400 dark:text-gray-500">
                              {S.company.tickets.noOwner}
                            </span>
                          ) : (
                            <PrincipalChip principal={owner} names={names} />
                          )}
                        </td>
                        <td className={`${cellClass} text-gray-600 dark:text-gray-300`}>
                          {formatMoney(ticket.cost, currency)}
                        </td>
                        <td
                          className={`${cellClass} font-semibold text-gray-900 dark:text-gray-100`}
                        >
                          {formatMoney(ticket.rolledUp, currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </OrgSection>

        <OrgSection
          title={S.company.finance.trend}
          info={S.company.finance.trendInfo}
          className="mt-8"
        >
          {series.length === 0 ? (
            <p className="py-2 text-xs text-gray-400 dark:text-gray-500">
              {S.company.finance.trendEmpty}
            </p>
          ) : (
            <TrendChart
              series={series}
              granularity="day"
              currency={currency}
              breaks={dailyBreaks(data.daily)}
            />
          )}
        </OrgSection>

        <OrgSection
          title={S.company.finance.alerts}
          info={S.company.finance.alertsInfo}
          className="mt-8"
        >
          {data.alerts.length === 0 ? (
            <p className="py-2 text-xs text-gray-400 dark:text-gray-500">
              {S.company.finance.alertsEmpty}
            </p>
          ) : (
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <AlertGroup
                title={S.company.finance.pausedGroup}
                tone="danger"
                alerts={alerts.paused}
                names={names}
              />
              <AlertGroup
                title={S.company.finance.warnedGroup}
                tone="attention"
                alerts={alerts.warned}
                names={names}
              />
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
            {S.company.finance.alertsHint}
          </p>
        </OrgSection>
      </div>
    </OrgPage>
  );
}

/** One state's alerts: a small title with the count, then the rows; nothing when the group is empty. */
function AlertGroup({
  title,
  tone,
  alerts,
  names,
}: {
  title: string;
  tone: Tone;
  alerts: readonly OrgBudgetAlert[];
  names: ReadonlyMap<string, string>;
}) {
  if (alerts.length === 0) return null;
  return (
    <div>
      <p className={`text-[11px] font-medium ${toneInk[tone]}`}>
        {title} · {alerts.length}
      </p>
      <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-800/60">
        {alerts.map((a) => (
          <AlertRow key={`${a.agentId}/${a.period}`} alert={a} tone={tone} names={names} />
        ))}
      </ul>
    </div>
  );
}
