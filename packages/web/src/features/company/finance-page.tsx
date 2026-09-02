/**
 * Finance: budgets and spend for one period. The spend tree walks the reporting line — every
 * employee a row with own spend, cumulative spend, budget (edited in place, written straight
 * to the employee) and ratio — the ticket table rolls costs up along parent tickets, the
 * daily costs draw on the cost center's trend chart, and the period's warnings and pauses
 * are listed with how a pause is lifted. `?period=yyyy-mm` switches between this period and
 * the previous one.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { OrgFinanceResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatMoney, formatPercent } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneInk } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { useTheme } from "../../state/theme";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Segmented } from "../../components/ui/segmented";
import { EmptyState } from "../../components/ui/empty-state";
import { noAutofill } from "../../components/ui/input";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { TrendChart } from "../usage/trend-chart";
import { OrgPage, OrgPageSkeleton, OrgSection, useOrg } from "./org-layout";
import { BudgetBar, PrincipalChip, TicketStatusBadge } from "./shared";
import {
  budgetTone,
  financeSeries,
  shiftPeriod,
  spendTreeRows,
  ticketTreeRows,
} from "./finance-tree";
import { agentPrincipal } from "./principals";

export function FinancePage() {
  const { projectId, orgId, org } = useOrg();
  const company = useCompany();
  const { currency } = useTheme();
  const [params, setParams] = useSearchParams();
  useDocumentTitle(org ? `${org.name} · ${S.nav.org.finance}` : S.nav.org.finance);
  const [data, setData] = useState<OrgFinanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The row whose budget is being typed, and the draft text. */
  const [editing, setEditing] = useState<{ agentId: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const requested = params.get("period");

  const load = useCallback(async () => {
    try {
      setData(await api.getOrgFinance(projectId, orgId, requested ?? undefined));
      setError(null);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId, requested]);
  const { budget: budgetVersion, runs } = company.versions;
  useEffect(() => {
    void load();
  }, [load, budgetVersion, runs]);

  const names = new Map((data?.employees ?? []).map((e) => [e.agentId, e.name]));
  const currentPeriod = org?.spend.period ?? data?.period ?? "";
  const previous = currentPeriod === "" ? null : shiftPeriod(currentPeriod, -1);
  const shown = data?.period ?? requested ?? currentPeriod;
  const setPeriod = (p: string) => {
    const next = new URLSearchParams(params);
    if (p === currentPeriod) next.delete("period");
    else next.set("period", p);
    setParams(next, { replace: true });
  };

  const commitBudget = async () => {
    if (editing === null || data === null) return;
    const row = data.employees.find((e) => e.agentId === editing.agentId);
    const text = editing.text.trim();
    const value = text === "" ? null : Number(text);
    if (value !== null && !(value >= 0)) {
      toastError(S.company.chart.budgetHint);
      return;
    }
    if (row !== undefined && (row.budget ?? null) === value) {
      setEditing(null);
      return;
    }
    setBusy(true);
    try {
      await api.patchOrgEmployee(projectId, orgId, editing.agentId, { budget: value });
      toastSuccess(S.company.finance.budgetSaved);
      setEditing(null);
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
          { value: previous, label: S.company.finance.prevPeriod },
          { value: currentPeriod, label: S.company.finance.thisPeriod },
        ]}
        value={shown === previous ? previous : currentPeriod}
        onChange={setPeriod}
        cols={2}
      />
    ) : undefined;

  if (error !== null && data === null) {
    return (
      <OrgPage title={S.nav.org.finance} info={S.company.finance.info}>
        <EmptyState
          title={error}
          action={<Button onClick={() => void load()}>{S.common.retry}</Button>}
        />
      </OrgPage>
    );
  }
  if (data === null) {
    return (
      <OrgPage title={S.nav.org.finance} info={S.company.finance.info}>
        <OrgPageSkeleton />
      </OrgPage>
    );
  }

  const rows = spendTreeRows(data.employees);
  const ticketRows = ticketTreeRows(data.tickets);
  const cellClass = "px-2 py-1.5 text-right tabular-nums";

  return (
    <OrgPage title={S.nav.org.finance} info={S.company.finance.info} actions={periodSwitch}>
      {/* Period line: which month, the total, and the unpriced note when it applies. */}
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-sm text-gray-500 dark:text-gray-400">{data.period}</span>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {S.company.finance.total}{" "}
          <span className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
            {formatMoney(data.total, currency)}
          </span>
        </span>
        {data.unpriced && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {S.company.finance.unpriced}
          </span>
        )}
      </div>

      <OrgSection title={S.company.finance.spendTree} info={S.company.finance.spendTreeInfo}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-xs">
            <thead>
              <tr className="text-[11px] text-gray-500 dark:text-gray-400">
                <th className="px-2 py-1.5 text-left font-medium">
                  {S.company.overview.employees}
                </th>
                <th className={`${cellClass} font-medium`}>{S.company.finance.own}</th>
                <th className={`${cellClass} font-medium`}>{S.company.finance.cumulative}</th>
                <th className={`${cellClass} font-medium`}>{S.company.finance.budget}</th>
                <th className="px-2 py-1.5 text-left font-medium">{S.company.finance.ratio}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
              {rows.map(({ employee, depth }) => {
                const tone = budgetTone(employee.ratio);
                const isEditing = editing?.agentId === employee.agentId;
                return (
                  <tr key={employee.agentId}>
                    <td className="px-2 py-1.5" style={{ paddingLeft: 8 + depth * 18 }}>
                      <span className="flex items-center gap-2">
                        <PrincipalChip principal={agentPrincipal(employee.agentId)} names={names} />
                        <span className="truncate text-gray-400 dark:text-gray-500">
                          {employee.title}
                        </span>
                        {employee.paused ? (
                          <Badge tone="red">{S.company.finance.paused}</Badge>
                        ) : employee.warned ? (
                          <Badge tone="amber">{S.company.finance.warned}</Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className={cellClass}>{formatMoney(employee.own, currency)}</td>
                    <td className={`${cellClass} font-semibold`}>
                      {formatMoney(employee.cumulative, currency)}
                    </td>
                    <td className={cellClass}>
                      {isEditing ? (
                        <input
                          autoFocus
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={editing.text}
                          placeholder={S.company.finance.budgetPlaceholder}
                          aria-label={S.company.finance.editBudget}
                          disabled={busy}
                          {...noAutofill}
                          onChange={(e) =>
                            setEditing({ agentId: employee.agentId, text: e.target.value })
                          }
                          onBlur={() => void commitBudget()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitBudget();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="w-24 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums focus:outline-none dark:border-gray-700 dark:bg-gray-900"
                        />
                      ) : (
                        <button
                          type="button"
                          title={S.company.finance.editBudget}
                          onClick={() =>
                            setEditing({
                              agentId: employee.agentId,
                              text: employee.budget === undefined ? "" : String(employee.budget),
                            })
                          }
                          className="rounded px-1.5 py-0.5 tabular-nums underline decoration-dotted underline-offset-2 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          {employee.budget === undefined
                            ? S.company.noBudget
                            : formatMoney(employee.budget, currency)}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-24">
                          <BudgetBar
                            compact
                            cost={employee.cumulative}
                            currency={currency}
                            {...(employee.budget !== undefined ? { budget: employee.budget } : {})}
                            {...(employee.ratio !== undefined ? { ratio: employee.ratio } : {})}
                          />
                        </div>
                        <span
                          className={`tabular-nums ${tone === "muted" ? "text-gray-400" : toneInk[tone]}`}
                        >
                          {formatPercent(employee.ratio)}
                        </span>
                      </div>
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
        className="mt-6"
      >
        {ticketRows.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {S.company.finance.ticketsEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-xs">
              <thead>
                <tr className="text-[11px] text-gray-500 dark:text-gray-400">
                  <th className="px-2 py-1.5 text-left font-medium">{S.nav.org.tickets}</th>
                  <th className="px-2 py-1.5 text-left font-medium">{S.company.status}</th>
                  <th className={`${cellClass} font-medium`}>{S.company.tickets.cost}</th>
                  <th className={`${cellClass} font-medium`}>{S.company.finance.rolledUp}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {ticketRows.map(({ ticket, depth }) => (
                  <tr key={ticket.ticketId}>
                    <td className="px-2 py-1.5" style={{ paddingLeft: 8 + depth * 18 }}>
                      <span className="mr-2 font-mono text-gray-400">{ticket.ticketId}</span>
                      {ticket.title}
                    </td>
                    <td className="px-2 py-1.5">
                      <TicketStatusBadge status={ticket.status} />
                    </td>
                    <td className={cellClass}>{formatMoney(ticket.cost, currency)}</td>
                    <td className={`${cellClass} font-semibold`}>
                      {formatMoney(ticket.rolledUp, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </OrgSection>

      <OrgSection title={S.company.finance.trend} className="mt-6">
        <TrendChart series={financeSeries(data.daily)} granularity="day" currency={currency} />
      </OrgSection>

      <OrgSection title={S.company.finance.alerts} className="mt-6">
        {data.alerts.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {S.company.finance.alertsEmpty}
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.alerts.map((a) => (
              <li
                key={`${a.agentId}/${a.period}`}
                className={a.pausedAt !== undefined ? toneInk.danger : toneInk.attention}
              >
                {a.pausedAt !== undefined
                  ? S.company.finance.alertPaused(
                      names.get(a.agentId) ?? a.agentId,
                      formatDateTime(a.pausedAt),
                    )
                  : S.company.finance.alertWarned(
                      names.get(a.agentId) ?? a.agentId,
                      formatDateTime(a.warnedAt ?? ""),
                    )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
          {S.company.finance.alertsHint}
        </p>
      </OrgSection>
    </OrgPage>
  );
}
