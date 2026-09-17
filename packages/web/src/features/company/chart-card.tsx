/**
 * One employee card on the org chart, plus the state-dot legend shown beside the chart.
 *
 * The face carries no primary action: it is a plain card that reads, and the personnel menu —
 * opening the desk session and every personnel action — is the one thing it can do. A
 * whole-card link would promise one of those many actions and steal the click from the rest.
 * Three rows: avatar with the name and title; the live state dot and its label, the workspace
 * tail, this period's spend against the budget; a thin ratio bar. The CEO's card carries no mark of
 * its own: the CEO is the tree's root, and an organization is created with the CEO titled "CEO".
 * The state the dot draws is passed in rather than read off the employee: the chart is a
 * snapshot re-read on organization events, and no event says a run ended (org-sessions.ts,
 * liveEmployeeStates).
 * Every status colour is a tone picked by meaning; running and on-desk share emerald and
 * are told apart by motion (the running dot pulses) and by their labels.
 *
 * Three ways into that one menu, all of them the same panel: the kebab in the top-right
 * corner (the only focusable thing on the card, and the pointer's discoverable route), a
 * secondary click anywhere on the card, and Shift+F10 from the focused kebab. The sidebar's
 * `useRowContextMenu` drives them, so the panel hangs off the point the gesture landed on and
 * inherits the Dropdown's dismiss stack, focus handling and viewport clamping. The card owns
 * that state: which card's menu is open is decided by the panel itself, since opening one is
 * an outside press on any other.
 *
 * The card sits on a pan/zoom canvas (org-chart-page.tsx), which is why the kebab names its
 * own cursor: the canvas wears `grab` over the whole surface, the card included — pressing
 * the inert face drags the canvas — and the one control on it has to say it is not that. A
 * secondary click never starts that pan: usePointerDrag refuses any button but the primary.
 *
 * That pan is also why press-and-hold is NOT one of the three, though the hook offers it: the
 * canvas takes pointer capture on press, so every later pointer event for that gesture is
 * retargeted to the canvas and the card never sees the move or the lift that would cancel a
 * hold. The timer would then fire on a finger that has been dragging for half a second. Touch
 * reaches the menu through the kebab, which is drawn on every card rather than revealed on
 * hover for exactly this reason.
 */
import { useEffect } from "react";
import type { ReactNode } from "react";
import type { OrgEmployeeItem, OrgEmployeeState } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { useRowContextMenu } from "../../components/ui/context-menu";
import { formatMoney, formatPercent } from "../../lib/format";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneDot, toneInk } from "../../lib/tone";
import type { Currency } from "../../state/theme";
import { AgentAvatar } from "../../components/ui/agent-avatar";
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
  state,
  currency,
  x,
  y,
  detached = false,
  viewEpoch,
  menu,
}: {
  employee: OrgEmployeeItem;
  /** The state the dot draws — the live one, which the chart's own `state` cannot be. */
  state: OrgEmployeeState;
  currency: Currency;
  /** Top-left corner inside the drawing. */
  x: number;
  y: number;
  /** In the detached row: its reporting line does not reach the CEO. */
  detached?: boolean;
  /**
   * Moves whenever the canvas pans or zooms under the cards, which closes an open menu: the
   * panel hangs off a viewport point, and a transform carries the card out from under it
   * without being either of the two things the panel can detect on its own (a scroll of a
   * container it sits in, or a resize of the window).
   */
  viewEpoch: number;
  /**
   * The personnel menu's rows, built against the panel's own close: a row runs after the
   * panel has gone, and the menu is the only keyboard route to these actions.
   */
  menu: (close: () => void) => ReactNode;
}) {
  const ctx = useRowContextMenu();
  const { close } = ctx;
  useEffect(() => {
    close();
  }, [viewEpoch, close]);
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
      ref={ctx.rowRef}
      // Secondary click and Shift+F10 open the card's menu (not the hook's press-and-hold —
      // see the header). The native menu is suppressed inside that handler only, so the rest
      // of the app keeps the browser's own.
      onContextMenu={ctx.rowProps.onContextMenu}
      onKeyDown={ctx.rowProps.onKeyDown}
      className="group absolute"
      style={{ left: x, top: y, width: CHART_NODE_W, height: CHART_NODE_H }}
    >
      {/* The tooltip carries what the two truncating lines may have cut, and nothing else:
          the face has no click of its own, so it must not promise one either. */}
      <div
        title={
          flag !== undefined ? `${employee.name} · ${flag}` : `${employee.name} · ${employee.title}`
        }
        className={`absolute inset-0 flex flex-col rounded-lg border bg-white px-3 py-2.5 shadow-sm dark:bg-gray-900 ${
          flagged ? "border-red-300 dark:border-red-800" : "border-gray-200 dark:border-gray-700"
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
            <span className="block truncate text-[13px] leading-4 font-semibold text-gray-900 dark:text-gray-100">
              {employee.name}
            </span>
            <span className="block truncate text-[11px] leading-4 text-gray-500 dark:text-gray-400">
              {employee.title}
            </span>
          </span>
        </span>
        <span className="mt-2 flex items-center gap-1.5 text-[11px] leading-4 text-gray-600 dark:text-gray-300">
          <ChartStateDot state={state} />
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
      </div>
      {/* The personnel menu. Its own wrapper positions it — Dropdown's root is `relative` and
          would otherwise sit in flow. The kebab is the Dropdown's own trigger rather than a
          sibling of it, because the panel dismisses on any mousedown landing outside that
          root: a trigger beside it would close the menu on press and reopen it on the click
          that follows, instead of toggling. Placement comes from the gesture's anchor, not
          from the wrapper — a secondary click hangs the same panel off the pointer. */}
      <div className="absolute top-1.5 right-1.5">
        <Dropdown
          open={ctx.open}
          setOpen={ctx.setOpen}
          portal={{ direction: "down", align: "left" }}
          anchorRect={ctx.anchor}
          anchorOwner={ctx.anchorOwner}
          returnFocus={ctx.returnFocus}
          menuClass="w-48"
          button={
            <button
              type="button"
              title={S.company.chart.nodeMenu}
              aria-label={`${employee.name} · ${S.company.chart.nodeMenu}`}
              aria-haspopup="menu"
              aria-expanded={ctx.open}
              onClick={(e) => {
                if (ctx.open) {
                  ctx.close();
                  return;
                }
                const r = e.currentTarget.getBoundingClientRect();
                ctx.openAt({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
              }}
              className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-gray-400 transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-700 focus-visible:opacity-100 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200 ${
                ctx.open ? "opacity-100" : "opacity-70"
              }`}
            >
              <GlyphIcon d={ELLIPSIS_ICON} size={ICON_SIZE.groupHeaderAction} filled />
            </button>
          }
        >
          {menu(() => {
            ctx.returnFocus()?.focus();
            ctx.close();
          })}
        </Dropdown>
      </div>
    </div>
  );
}
