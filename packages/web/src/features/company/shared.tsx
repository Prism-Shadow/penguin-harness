/**
 * Small pieces every organization page shares: the employee state dot, the budget bar, the
 * ticket status and priority pills, the blocked badge, and principal naming. Every status
 * colour here is a tone from lib/tone.ts, picked by meaning.
 */
import type { ReactNode } from "react";
import type {
  OrgEmployeeState,
  OrgTicketPriority,
  OrgTicketStatus,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatMoney, formatPercent } from "../../lib/format";
import { toneDot, toneInk, toneSurface } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import type { Currency } from "../../state/theme";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Badge } from "../../components/ui/badge";
import type { BadgeTone } from "../../components/ui/badge";
import { budgetTone } from "./finance-tree";
import { parsePrincipal } from "./principals";

/** Circled exclamation (lucide circle-alert): the danger mark of an invalid chart entry or ticket file. */
export const INVALID_ICON = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v4m0 4h.01";

/** An employee's live state as a 6px dot: busy while running, success on the desk, attention when its budget paused it. The name rides in the tooltip and sr text. */
export function EmployeeStateDot({ state }: { state: OrgEmployeeState }) {
  const tone: Tone = state === "running" ? "busy" : state === "paused" ? "attention" : "success";
  const label = S.company.employeeStates[state] ?? state;
  return (
    <span title={label} className="inline-flex shrink-0 items-center">
      <span className={`block h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Spend against a budget as a bar: attention from 80%, danger from 100%; a muted rule when there is no budget. */
export function BudgetBar({
  cost,
  budget,
  ratio,
  currency,
  compact = false,
}: {
  cost: number;
  budget?: number;
  ratio?: number;
  currency: Currency;
  compact?: boolean;
}) {
  const tone = budgetTone(ratio);
  const fill =
    tone === "danger"
      ? "bg-red-500"
      : tone === "attention"
        ? "bg-amber-500"
        : tone === "success"
          ? "bg-emerald-500"
          : "bg-gray-300 dark:bg-gray-600";
  const width = ratio === undefined ? 0 : Math.min(100, Math.max(0, ratio * 100));
  const label =
    budget === undefined
      ? `${formatMoney(cost, currency)} · ${S.company.noBudget}`
      : `${S.company.spendOfBudget(formatMoney(cost, currency), formatMoney(budget, currency))} · ${formatPercent(ratio)}`;
  return (
    <div className={compact ? "min-w-24" : ""}>
      {!compact && (
        <p
          className={`mb-1 text-xs font-medium ${tone === "muted" ? "text-gray-500 dark:text-gray-400" : toneInk[tone]}`}
        >
          {label}
        </p>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        title={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
      >
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

const STATUS_TONE: Record<OrgTicketStatus, BadgeTone> = {
  proposed: "gray",
  in_progress: "green",
  review: "amber",
  done: "brand",
  rejected: "red",
};

export function TicketStatusBadge({ status }: { status: OrgTicketStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{S.company.tickets.columns[status] ?? status}</Badge>;
}

const PRIORITY_TONE: Record<OrgTicketPriority, BadgeTone> = { P0: "red", P1: "amber", P2: "gray" };

export function PriorityBadge({ priority }: { priority: OrgTicketPriority }) {
  return <Badge tone={PRIORITY_TONE[priority] ?? "gray"}>{priority}</Badge>;
}

/** The blocked mark: an attention pill whose tooltip carries the reason and who it waits on. */
export function BlockedBadge({ reason, by }: { reason: string; by?: string }) {
  return (
    <span title={S.company.tickets.blockedTooltip(reason, by ?? "—")} className="inline-flex">
      <Badge tone="amber">{S.company.tickets.blocked}</Badge>
    </span>
  );
}

/** A principal's display name: an employee's name (or its id), a member's user id, "System", "Everyone". */
export function principalLabel(principal: string, names: ReadonlyMap<string, string>): string {
  const p = parsePrincipal(principal);
  switch (p.kind) {
    case "agent":
      return names.get(p.id) ?? p.id;
    case "user":
      return p.id;
    case "all":
      return S.company.principalAll;
    case "system":
      return S.company.principalSystem;
    default:
      return p.raw;
  }
}

/** A principal as an avatar plus its name (agents get their tile; people a plain initial disc). */
export function PrincipalChip({
  principal,
  names,
  size = 14,
}: {
  principal: string;
  names: ReadonlyMap<string, string>;
  size?: number;
}) {
  const p = parsePrincipal(principal);
  const label = principalLabel(principal, names);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {p.kind === "agent" ? (
        <AgentAvatar id={p.id} name={label} size={size} className="shrink-0 rounded" />
      ) : (
        <span
          aria-hidden
          style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
          className="flex shrink-0 items-center justify-center rounded-full bg-gray-900 font-bold text-white dark:bg-gray-200 dark:text-gray-900"
        >
          {label.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** A labelled value in a stat block: the name small above, the value bold beneath. */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{label}</p>
      <p
        className={`truncate text-lg font-semibold tabular-nums ${tone !== undefined ? toneInk[tone] : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

/** A tinted count pill (the overview's board block): the count in the status's own surface. */
export function CountPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneSurface[tone]}`}
    >
      {children}
    </span>
  );
}
