/**
 * How a forward's status reads: the cable's tone, and the line under it. Shared by the
 * dock's Ports panel and a machine's Ports page, so the same forward never reads two ways.
 * The status names which layer spoke — the session, ssh, this server's own listener — and
 * what it said, so the page debugging a dead port sees where it died.
 */
import type { PortForwardInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { Tone } from "../../lib/tone";

/** Red: whoever carries it said no. Amber: the machine's session is down. Muted: ssh has not answered yet. Blue: carried. */
export function forwardTone(forward: PortForwardInfo): Tone {
  switch (forward.status.kind) {
    case "failed":
      return "danger";
    case "not-connected":
      return "attention";
    case "pending":
      return "muted";
    case "active":
      return "link";
  }
}

/** The status in words: which layer speaks, and what it said. */
export function statusLine(forward: PortForwardInfo): string {
  switch (forward.status.kind) {
    case "failed":
      return S.ports.statusFailed(forward.status.detail);
    case "not-connected":
      return S.ports.statusNotConnected;
    case "pending":
      return S.ports.statusPending;
    case "active":
      return S.ports.statusOnSession;
  }
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
