/**
 * What the extension keeps, and where.
 *
 * `chrome.storage.local` (survives restarts): the paired servers with their tokens, the Pause
 * switch, and the holds a server's close code put on reconnecting. `chrome.storage.session`
 * (survives a worker restart, not a Chrome restart): the driven-tab set and each connection's
 * status, which the pages read and follow.
 *
 * Nothing here is reachable from a web page: the extension has no content scripts and no
 * `externally_connectable`, and session storage keeps its default trusted-contexts access.
 */
import { parseTabSet, type TabSetState } from "./tab-set.js";

export interface PairedServer {
  /** The server's origin as the Web App's window reached it: `https://ph.example.com`. */
  origin: string;
  /** How the extension names the server: its host. */
  label: string;
  token: string;
  /** The server's id for this pairing (what the Web App lists and revokes). */
  extensionId: string;
  /** The server's install id; null when the server could not name its data root. */
  installId: string | null;
  /** Who paired it; `displayName` is null for an account that has none set. */
  user: { userId: string; displayName: string | null };
  serverVersion: string;
  pairedAt: string;
}

/**
 * Why a server is not being dialled: another Chrome replaced this one (until the user
 * reconnects), the server speaks another protocol (until the extension is updated), or the
 * server's administrator turned extensions off (until `until`).
 */
export interface Hold {
  reason: "replaced" | "protocol_mismatch" | "disabled";
  until?: number;
}

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "waiting"
  | "replaced"
  | "revoked"
  | "protocol_mismatch"
  | "disabled"
  | "stopped";

export interface ConnectionState {
  status: ConnectionStatus;
  /** When the next attempt runs, while waiting or disabled. */
  retryAt?: number;
  closeCode?: number;
  closeReason?: string;
}

export interface ServerStatus extends ConnectionState {
  label: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseServer(value: unknown): PairedServer | null {
  if (!isRecord(value) || !isRecord(value.user)) return null;
  const { origin, label, token, extensionId, installId, serverVersion, pairedAt } = value;
  const { userId, displayName } = value.user;
  for (const field of [origin, label, token, extensionId, serverVersion, pairedAt, userId]) {
    if (typeof field !== "string") return null;
  }
  if (installId !== null && typeof installId !== "string") return null;
  if (displayName !== null && typeof displayName !== "string") return null;
  return {
    origin: origin as string,
    label: label as string,
    token: token as string,
    extensionId: extensionId as string,
    installId,
    serverVersion: serverVersion as string,
    pairedAt: pairedAt as string,
    user: { userId: userId as string, displayName },
  };
}

export async function readServers(): Promise<PairedServer[]> {
  const { servers } = await chrome.storage.local.get("servers");
  if (!Array.isArray(servers)) return [];
  return servers.map(parseServer).filter((server): server is PairedServer => server !== null);
}

/** Adds a server, or replaces the one with the same origin (a re-pairing). */
export async function upsertServer(server: PairedServer): Promise<void> {
  // The hold goes first: the worker reconnects as soon as it sees the new server list.
  await clearHold(server.origin);
  const servers = (await readServers()).filter((s) => s.origin !== server.origin);
  await chrome.storage.local.set({ servers: [...servers, server] });
}

export async function removeServer(origin: string): Promise<void> {
  await clearHold(origin);
  const servers = await readServers();
  await chrome.storage.local.set({ servers: servers.filter((s) => s.origin !== origin) });
}

export async function readPaused(): Promise<boolean> {
  const { paused } = await chrome.storage.local.get("paused");
  return paused === true;
}

export async function setPaused(paused: boolean): Promise<void> {
  await chrome.storage.local.set({ paused });
}

export async function readHolds(): Promise<Record<string, Hold>> {
  const { holds } = await chrome.storage.local.get("holds");
  const out: Record<string, Hold> = {};
  if (!isRecord(holds)) return out;
  for (const [origin, hold] of Object.entries(holds)) {
    if (!isRecord(hold)) continue;
    const { reason, until } = hold;
    if (reason !== "replaced" && reason !== "protocol_mismatch" && reason !== "disabled") continue;
    out[origin] = { reason, ...(typeof until === "number" ? { until } : {}) };
  }
  return out;
}

export async function setHold(origin: string, hold: Hold): Promise<void> {
  const holds = await readHolds();
  await chrome.storage.local.set({ holds: { ...holds, [origin]: hold } });
}

export async function clearHold(origin: string): Promise<void> {
  const holds = await readHolds();
  if (!(origin in holds)) return;
  delete holds[origin];
  await chrome.storage.local.set({ holds });
}

export async function readTabSet(): Promise<TabSetState> {
  const { tabSet } = await chrome.storage.session.get("tabSet");
  return parseTabSet(tabSet);
}

export async function writeTabSet(tabSet: TabSetState): Promise<void> {
  await chrome.storage.session.set({ tabSet });
}

export async function readStatus(): Promise<Record<string, ServerStatus>> {
  const { status } = await chrome.storage.session.get("status");
  return isRecord(status) ? (status as Record<string, ServerStatus>) : {};
}

export async function writeStatus(status: Record<string, ServerStatus>): Promise<void> {
  await chrome.storage.session.set({ status });
}
