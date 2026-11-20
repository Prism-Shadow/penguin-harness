/**
 * The host message groups the face's own code words its errors with, and the part of the CLI
 * host's bundle a command module may count on.
 *
 * The texts are the host's: the CLI's message table (`@prismshadow/penguin-server/cli`'s
 * `Messages`) carries every group below, in each language it speaks, and hands the bundle to a
 * command's register through its context. This package declares the shapes, so the code here —
 * the connection, the client — can take the host's bundle without knowing the rest of it, and a
 * shipped plugin's CLI module can type what it reads from the host.
 */
import type { CliCommandMessages } from "@prismshadow/penguin-core/cli";

/** Server-connection layer: resolution, auto-start, tokens, streams. */
export interface ClientText {
  invalidServerUrl(value: string): string;
  /** --server names a non-loopback URL and no PENGUIN_API_TOKEN is set (the local token file must not travel). */
  remoteNeedsToken(url: string): string;
  /** No server reachable and auto-start was disabled by the caller. */
  noServer(): string;
  /** Auto-start impossible: the CLI entry is not plain-node runnable (tsx dev run). */
  autoStartUnavailable(): string;
  autoStartFailed(logPath: string): string;
  /** Printed to stderr when a server was auto-started for this invocation. */
  autoStarted(url: string, logPath: string): string;
  /** 401 with no token found anywhere (env or file). */
  noToken(url: string, tokenPath: string): string;
  /** 401 despite presenting a token. */
  authFailed(url: string): string;
  httpError(status: number, code: string, message: string): string;
  sessionNotFound(ref: string, projectId: string): string;
  sessionAmbiguous(ref: string, candidates: string[]): string;
  /** The SSE stream dropped and reconnecting gave up. */
  streamLost(detail: string): string;
  /** resync_required: the reconnect fell off the server's replay buffer (a display gap, not data loss). */
  streamResynced(): string;
  /** Invalid --timeout value (names the accepted shapes). */
  timeoutInvalid(value: string): string;
  /** Soft-yield detach: the wait budget expired, the task keeps running server-side. */
  stillRunning(shortId: string): string;
  /** Caller-context lookup failed (PENGUIN_SESSION_ID names a session this server cannot answer for): plain defaults apply. */
  callerDefaultsFailed(sessionId: string): string;
  /** Dim stderr note naming the session a bare `session log` / `input` / `rename` resolved to (the agent's most recent). */
  latestSession(sessionId: string): string;
  /** Bare `session log` / `input` / `rename` when the agent has no session at all: what to run to get one. */
  noSessionsYet(agentId: string, projectId: string): string;
}

/** What the connection and the client read from a bundle: the server-connection group. */
export interface ClientMessages {
  client: ClientText;
}

/**
 * The CLI host's bundle as a command module sees it: the locale the host resolved, the
 * server-connection group, and the descriptions of the options every server-backed command
 * shares. The host's full table is wider; a module types its bundle as this plus its own groups.
 */
export interface CliHostMessages extends CliCommandMessages, ClientMessages {
  common: {
    /** Machine-readable output (raw JSON instead of the rendered/tabular form). */
    json: string;
    /** --server: explicit server URL (overrides PENGUIN_API_URL, the local lock and auto-start). */
    server: string;
  };
}
