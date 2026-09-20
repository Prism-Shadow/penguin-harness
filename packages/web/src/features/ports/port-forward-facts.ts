/**
 * How a forward's facts read: the dot's tone, and one line per layer. Shared by the dock's
 * Ports panel and a machine's Ports page, so the same forward never reads two ways.
 *
 * The facts stay apart on purpose. A listener that is up says nothing about the machine
 * behind it, and the page debugging a dead port needs to see which layer is the dead one —
 * so the tone is the worst layer's, and the lines name each.
 */
import type { PortForwardInfo } from "@prismshadow/penguin-server/api";
import { formatRelativeShort } from "../../lib/format";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";

/** Red: nothing can connect. Amber: they can, and the last one got nowhere. Blue: in contact, or nothing said otherwise yet. */
export function forwardTone(forward: PortForwardInfo): Tone {
  if ("error" in forward.listener) return "danger";
  if (forward.dial !== null && "failedAt" in forward.dial) return "attention";
  return "link";
}

export function listenerLine(forward: PortForwardInfo): string {
  return "error" in forward.listener
    ? S.ports.listenerError(forward.listener.error)
    : S.ports.listenerUp;
}

export function dialLine(forward: PortForwardInfo, locale: "zh" | "en"): string {
  if (forward.dial === null) return S.ports.neverDialled;
  return "failedAt" in forward.dial
    ? S.ports.dialFailed(forward.dial.detail, formatRelativeShort(forward.dial.failedAt, locale))
    : S.ports.dialOk(formatRelativeShort(forward.dial.answeredAt, locale));
}

/** A port as typed: whole, in range — or null. Empty is the caller's to read as "not given". */
export function parsePort(text: string, min = 1): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const port = Number(trimmed);
  return port >= min && port <= 65535 ? port : null;
}

/** The forwards of each Workspace, Workspaces in path order, rows in the order they were made. */
export function groupByWorkspace(forwards: PortForwardInfo[]): [string, PortForwardInfo[]][] {
  const groups = new Map<string, PortForwardInfo[]>();
  for (const forward of forwards) {
    const group = groups.get(forward.workspace);
    if (group === undefined) groups.set(forward.workspace, [forward]);
    else group.push(forward);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
