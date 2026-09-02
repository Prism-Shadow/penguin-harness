/**
 * One employee card on the org chart, plus the state-dot legend shown beside the chart.
 *
 * The card's face is one real button — clicking anywhere on it opens the desk session —
 * with the personnel menu's kebab in the corner as a sibling (buttons do not nest). Three
 * rows: avatar with the name and title (the CEO wears a chip); the live state dot and its
 * label, the workspace tail, this period's spend against the budget; a thin ratio bar.
 * Every status colour is a tone picked by meaning; running and on-desk share emerald and
 * are told apart by motion (the running dot pulses) and by their labels.
 */
import type { ReactNode } from "react";
import type { OrgEmployeeItem, OrgEmployeeState } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatMoney, formatPercent } from "../../lib/format";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneDot, toneInk } from "../../lib/tone";
import type { Currency } from "../../state/theme";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Badge } from "../../components/ui/badge";
import { Dropdown } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ELLIPSIS_ICON } from "../../components/ui/session-row-menu";
import { FOLDER_ICON } from "../../components/ui/group-list";
import { budgetTone } from "./finance-tree";
import { INVALID_ICON } from "./shared";
import { CHART_NODE_H, CHART_NODE_W, workspaceTail } from "./org-chart-tree";
import { employeeStateTone } from "./chart-view";

/** The legend's order: the states a reader is most likely to be looking for first. */
const LEGEND_STATES: readonly OrgEmployeeState[] = ["running", "idle", "paused"];

/** A 6px state dot with its label beside it; the running dot carries a pulsing halo (transform-only, so reduced motion leaves a plain dot). */
export function ChartStateDot({ state }: { state: OrgEmployeeState }) {
  const tone = employeeStateTone(state);
  const label = S.company.employeeStates[state] ?? state;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
        {state === "running" && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${toneDot[tone]}`}
          />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} />
      </span>
      <span>{label}</span>
    </span>
  );
}

export function ChartLegend() {
  return (
    <ul
      aria-label={S.company.chart.legend}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400"
    >
      {LEGEND_STATES.map((state) => (
        <li key={state} className="flex items-center">
          <ChartStateDot state={state} />
        </li>
      ))}
    </ul>
  );
}

export function ChartCard({
  employee,
  isCeo,
  currency,
  x,
  y,
  detached = false,
  menuOpen,
  setMenuOpen,
  menu,
  onOpen,
}: {
  employee: OrgEmployeeItem;
  isCeo: boolean;
  currency: Currency;
  /** Top-left corner inside the drawing. */
  x: number;
  y: number;
  /** In the detached row: its reporting line does not reach the CEO. */
  detached?: boolean;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  /** The personnel menu's rows. */
  menu: ReactNode;
  onOpen: () => void;
}) {
  const tone = budgetTone(employee.spend.ratio);
  const spent = formatMoney(employee.spend.cumulative, currency);
  const spend =
    employee.budget === undefined
      ? spent
      : S.company.spendOfBudget(spent, formatMoney(employee.budget, currency));
  const spendTitle = `${S.company.chart.spend}: ${spend} · ${
    employee.spend.ratio === undefined ? S.company.noBudget : formatPercent(employee.spend.ratio)
  }`;
  const fill =
    employee.spend.ratio === undefined ? 0 : Math.min(100, Math.max(0, employee.spend.ratio * 100));
  const flagged = employee.invalid !== undefined || detached;
  const flag = employee.invalid ?? (detached ? S.company.chart.detached : undefined);
  return (
    <div
      className="group absolute"
      style={{ left: x, top: y, width: CHART_NODE_W, height: CHART_NODE_H }}
    >
      <button
        type="button"
        title={
          flag !== undefined
            ? `${employee.name} · ${flag}`
            : `${employee.name} · ${S.company.openDesk}`
        }
        onClick={onOpen}
        className={`absolute inset-0 flex flex-col rounded-lg border bg-white px-3 py-2.5 text-left shadow-sm transition-[box-shadow,border-color] duration-150 hover:shadow-md dark:bg-gray-900 ${
          flagged
            ? "border-red-300 hover:border-red-400 dark:border-red-800 dark:hover:border-red-700"
            : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
        }`}
      >
        <span className="flex items-center gap-2.5 pr-6">
          <AgentAvatar
            id={employee.agentId}
            name={employee.name}
            size={28}
            className="shrink-0 rounded-md"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-[13px] leading-4 font-semibold text-gray-900 dark:text-gray-100">
                {employee.name}
              </span>
              {isCeo && <Badge tone="brand">{S.company.ceo}</Badge>}
            </span>
            <span className="block truncate text-[11px] leading-4 text-gray-500 dark:text-gray-400">
              {employee.title}
            </span>
          </span>
        </span>
        <span className="mt-2 flex items-center gap-1.5 text-[11px] leading-4 text-gray-600 dark:text-gray-300">
          <ChartStateDot state={employee.state} />
          <span
            className="flex min-w-0 flex-1 items-center gap-1 font-mono text-[10px] text-gray-400 dark:text-gray-500"
            title={flag ?? employee.resolvedWorkspace ?? employee.workspace}
          >
            {flag !== undefined ? (
              <span className={toneInk.danger}>
                <GlyphIcon d={INVALID_ICON} size={10} />
              </span>
            ) : (
              <GlyphIcon d={FOLDER_ICON} size={10} />
            )}
            <span className="truncate">{workspaceTail(employee.workspace)}</span>
          </span>
          <span
            className={`shrink-0 tabular-nums ${
              tone === "attention" || tone === "danger" ? `font-medium ${toneInk[tone]}` : ""
            }`}
            title={spendTitle}
          >
            {spend}
          </span>
        </span>
        {/* The ratio bar: emerald under 80%, amber from 80%, red from 100%; an empty track without a budget. */}
        <span
          className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
          aria-hidden
        >
          <span
            className={`block h-full rounded-full ${toneDot[tone]}`}
            style={{ width: `${fill}%` }}
          />
        </span>
      </button>
      {/* The personnel menu: the overflow-menu style of the session rows, anchored at the card's
          corner. Its own wrapper positions it — Dropdown's root is `relative` and would sit in flow. */}
      <div className="absolute top-1.5 right-1.5">
        <Dropdown
          open={menuOpen}
          setOpen={setMenuOpen}
          portal={{ direction: "down", align: "right" }}
          menuClass="w-48"
          button={
            <button
              type="button"
              title={S.company.chart.nodeMenu}
              aria-label={`${employee.name} · ${S.company.chart.nodeMenu}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
              className={`flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-700 focus-visible:opacity-100 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200 ${
                menuOpen ? "opacity-100" : "opacity-70"
              }`}
            >
              <GlyphIcon d={ELLIPSIS_ICON} size={ICON_SIZE.groupHeaderAction} filled />
            </button>
          }
        >
          {menu}
        </Dropdown>
      </div>
    </div>
  );
}
