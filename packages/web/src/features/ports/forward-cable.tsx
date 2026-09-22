/**
 * A port forward drawn as what it is: a cable from one end to the other.
 *
 * The two ends are named — the machine on the left, "here" (this server) on the right — and
 * the direction is the cable's own arrow, so a row never has to be decoded: bytes come from
 * the port on the left and arrive at the port on the right. The state lives ON the cable
 * (its ink is the tone, and where connections can be counted the dashes travel while some
 * are open), which
 * is what keeps the row's words for the addresses alone.
 *
 * One drawing for the dock's Ports panel and a machine's Ports page, and for the form that
 * makes a new one — an empty cable with the two ports still to be typed — so the form is a
 * row before it is a record, and reads the same way.
 */
import type { ReactNode } from "react";
import type { PortForwardInfo } from "@prismshadow/penguin-server/api";
import { ICON_GAP } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import { forwardTone, statusLine } from "./port-forward-facts";

/** A name on a plug: the machine's alias, or "here". */
const PLUG =
  "inline-flex h-7 max-w-[10rem] shrink items-center rounded-md border border-gray-200 bg-gray-50 px-2 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200";
const PLUG_NAME = "min-w-0 truncate";
const PLUG_PORT = "ml-1 shrink-0 tabular-nums";

export function Plug({
  name,
  port,
  children,
}: {
  name: string;
  port?: number;
  children?: ReactNode;
}) {
  return (
    <span className={PLUG} title={name}>
      <span className={PLUG_NAME}>{name}</span>
      {port !== undefined && <span className={PLUG_PORT}>:{port}</span>}
      {children}
    </span>
  );
}

/** The cable itself: a line with an arrowhead, in the tone's ink. */
export function Cable({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span
      className={`flex min-w-8 flex-1 items-center ${toneInk[tone]}`}
      role="img"
      aria-label={label}
    >
      {/* No viewBox on the line: its x2 is a percentage of whatever width the row gives it,
          so the cable stretches and the arrowhead beside it keeps its shape. */}
      <svg className="h-3 min-w-0 flex-1" aria-hidden="true">
        <line
          x1="0"
          y1="6"
          x2="100%"
          y2="6"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
      <svg viewBox="0 0 8 12" className="-ml-px h-3 w-2 shrink-0" aria-hidden="true">
        <path
          d="M1 2l5 4-5 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * One forward as a row: the cable line, then its status under it in the cable's ink.
 * `actions` sit at the row's right edge.
 */
export function ForwardRow({
  forward,
  machineName,
  actions,
}: {
  forward: PortForwardInfo;
  machineName: string;
  actions?: ReactNode;
}) {
  const tone = forwardTone(forward);
  const status = statusLine(forward);
  // Bytes go from the left plug to the right one, whichever direction the forward is: an
  // `in` forward starts at the machine, an `out` one starts here.
  const from = <Plug name={machineName} port={forward.remotePort} />;
  const to = <Plug name={S.ports.here} port={forward.localPort} />;
  return (
    <li
      data-testid="port-forward-row"
      data-direction={forward.direction}
      className="rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900/60"
    >
      <div className={`flex items-center ${ICON_GAP.row}`}>
        {forward.direction === "in" ? from : to}
        <Cable tone={tone} label={status} />
        {forward.direction === "in" ? to : from}
        {actions !== undefined && (
          <span className={`ml-1 flex shrink-0 items-center ${ICON_GAP.tight}`}>{actions}</span>
        )}
      </div>
      <div
        className={`mt-1 truncate pl-1 text-[11px] ${tone === "link" ? "text-gray-500 dark:text-gray-400" : toneInk[tone]}`}
      >
        {status}
      </div>
    </li>
  );
}
