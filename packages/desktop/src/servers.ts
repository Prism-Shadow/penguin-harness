/**
 * Server registry: the shell's list of servers to run the UI against — the
 * same schema the dev watch-push tool consumes (scripts/watch-push.mjs), so
 * the node and electron sides of the "UI without a server" model speak one
 * language:
 *
 *   { "servers": [
 *     { "id": "local", "type": "local", "label": "This machine" },
 *     { "id": "lab",   "type": "ssh",   "host": "user@box",
 *       "home": "~/.penguin/data", "remotePort": 7364 }
 *   ] }
 *
 * - `local`: fork the embedded server on this machine (optional `home`
 *   overrides the data root) — today's behavior.
 * - `ssh`: reach a server running on a remote machine through an ssh port
 *   forward (`ssh -N -L`); the remote server stays loopback-only, nothing is
 *   exposed on the network. `remotePort` defaults to 7364.
 *
 * File resolution: $PENGUIN_SERVERS_FILE, else <userData>/servers.json. A
 * missing or empty file means the single implicit local server — the shell
 * boots exactly as before. Two or more entries (or PENGUIN_DESKTOP_PICKER=1)
 * bring up the picker page first: the UI starts WITHOUT a server and the user
 * chooses where to deploy/connect.
 *
 * Pure functions only (fs injected via file path): unit-tested alongside the
 * launcher/util modules; the electron wiring lives in main.ts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface LocalServerEntry {
  id: string;
  type: "local";
  label?: string;
  /** Data root override; defaults to the shell's resolved root. */
  home?: string;
}

export interface SshServerEntry {
  id: string;
  type: "ssh";
  label?: string;
  /** ssh destination, anything `ssh` accepts (user@host, a Host alias, …). */
  host: string;
  /** Remote data root (informational; the push tool uses it). */
  home?: string;
  /** Remote server port to forward to (loopback on the remote side). */
  remotePort?: number;
}

export type ServerEntry = LocalServerEntry | SshServerEntry;

export const DEFAULT_REMOTE_PORT = 7364;

/** The implicit registry when no servers file exists: one local server. */
export const IMPLICIT_LOCAL: ServerEntry = { id: "local", type: "local", label: "This machine" };

export function serversFilePath(userDataDir: string, env = process.env): string {
  return env.PENGUIN_SERVERS_FILE ?? path.join(userDataDir, "servers.json");
}

/** Parses a servers file's content; returns null for anything unusable. */
export function parseServersFile(content: string): ServerEntry[] | null {
  try {
    const doc = JSON.parse(content) as { servers?: unknown };
    if (!Array.isArray(doc.servers)) return null;
    const entries: ServerEntry[] = [];
    for (const raw of doc.servers) {
      const e = raw as Record<string, unknown>;
      if (typeof e.id !== "string" || e.id === "") return null;
      const label = typeof e.label === "string" ? e.label : undefined;
      const home = typeof e.home === "string" ? e.home : undefined;
      if (e.type === "local") {
        entries.push({ id: e.id, type: "local", label, home });
      } else if (e.type === "ssh" && typeof e.host === "string" && e.host !== "") {
        entries.push({
          id: e.id,
          type: "ssh",
          label,
          host: e.host,
          home,
          remotePort: typeof e.remotePort === "number" ? e.remotePort : DEFAULT_REMOTE_PORT,
        });
      } else {
        return null;
      }
    }
    return entries;
  } catch {
    return null;
  }
}

/** Loads the registry; a missing/invalid file yields the implicit local server. */
export function loadServers(file: string): ServerEntry[] {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return [IMPLICIT_LOCAL];
  }
  const entries = parseServersFile(content);
  return entries === null || entries.length === 0 ? [IMPLICIT_LOCAL] : entries;
}

/** The picker shows when there is a real choice (or when forced for testing). */
export function shouldShowPicker(entries: ServerEntry[], env = process.env): boolean {
  if (env.PENGUIN_DESKTOP_PICKER === "1") return true;
  return entries.length > 1 || entries.some((e) => e.type === "ssh");
}

/** ssh argv for the tunnel: local loopback port → the remote server's loopback port. */
export function sshTunnelArgs(entry: SshServerEntry, localPort: number): string[] {
  const remotePort = entry.remotePort ?? DEFAULT_REMOTE_PORT;
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-N",
    "-L",
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    entry.host,
  ];
}

export function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/**
 * The picker page, shell-owned static HTML served from a data: URL. No
 * preload and no IPC: choices are plain links with the penguin-pick://
 * scheme, intercepted by main.ts via will-navigate — the window stays a plain
 * browser environment, same as the app itself.
 */
export function pickerHtml(entries: ServerEntry[], serversFile: string): string {
  const rows = entries
    .map((e) => {
      const label = escapeHtml(e.label ?? e.id);
      const detail = e.type === "ssh" ? `ssh ${escapeHtml(e.host)}` : "local";
      return `<li><a href="penguin-pick://${encodeURIComponent(e.id)}">${label}</a> <small>(${detail})</small></li>`;
    })
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>PenguinHarness — choose a server</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 4rem auto; }
  li { margin: 0.5rem 0; } a { font-size: 1.1rem; } small { color: #888; }
</style></head><body>
<h1>Choose a server</h1>
<p>The UI started without a server. Pick where to run one:</p>
<ul>
${rows}
</ul>
<p><small>Servers are configured in <code>${escapeHtml(serversFile)}</code> —
local entries fork the embedded server; ssh entries tunnel to a server already
running on that machine.</small></p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
