/**
 * What a session credential (session-token.ts) reaches: a default-deny route table.
 *
 * The rows are the routes an Agent's own commands call today — the `penguin` CLI inside a
 * Session (`org`, `run`, `input`, `logs`, `ls`, `agent`, `schedule`, `cost`, `telemetry`,
 * `browser`) and
 * the `curl` lines a plugin hands a desk — each with the check that narrows it to the
 * credential's Project, Agent and organization. Anything not in the table is refused, so a
 * route added later is closed to Agents until someone adds its row.
 *
 * "Its own sessions" are the Sessions of the credential's Agent in its Project, plus the ones
 * it created through the API (`penguin run --agent-id <colleague>`), which the HTTP layer
 * remembers for the life of the App.
 */
import type { SessionClaims } from "./session-token.js";

/** How the table sees a Session: which Project and Agent it belongs to. */
export interface SessionOwner {
  projectId: string;
  agentId: string;
}

export interface ScopeLookups {
  /** The Session's owner, or null when no such Session exists. */
  sessionOf(sessionId: string): SessionOwner | null;
  /** The Agent (`<projectId>/<agentId>`) whose credential created this Session, if one did. */
  createdBy(sessionId: string): string | undefined;
}

/** Identity claims a request carries (query `sessionId`/`agentId`, or the same JSON body members). */
export interface CarriedClaims {
  sessionId?: string;
  agentId?: string;
}

export type ScopeDecision =
  | { kind: "deny"; message: string }
  | {
      kind: "allow";
      /** The answer's `sessions` list keeps only the credential's own sessions. */
      filterSessions?: boolean;
      /** A 201 answer's `session.sessionId` becomes one of the credential's own sessions. */
      adoptCreated?: boolean;
      /** The identity claims must be checked against the credential (see {@link checkClaims}). */
      claims?: "caller" | "caller-session";
    };

/** `<projectId>/<agentId>`: the key {@link ScopeLookups.createdBy} answers with. */
export function agentKey(projectId: string, agentId: string): string {
  return `${projectId}/${agentId}`;
}

/** Whether the credential reaches this Session: its Agent's own, or one it created. */
export function reachesSession(
  claims: SessionClaims,
  sessionId: string,
  lookups: ScopeLookups,
): boolean {
  const owner = lookups.sessionOf(sessionId);
  if (owner === null || owner.projectId !== claims.projectId) return false;
  return (
    owner.agentId === claims.agentId ||
    lookups.createdBy(sessionId) === agentKey(claims.projectId, claims.agentId)
  );
}

interface Row {
  methods: readonly string[];
  pattern: RegExp;
  /** The CLI command or plugin line that calls it: the table's own documentation. */
  caller: string;
  check(
    params: string[],
    claims: SessionClaims,
    query: URLSearchParams,
    lookups: ScopeLookups,
    method: string,
  ): ScopeDecision;
}

const READ = ["GET"] as const;
const WRITE = ["POST", "PUT", "PATCH", "DELETE"] as const;
const ANY = [...READ, ...WRITE] as const;
const SEG = "([^/]+)";

const allow: ScopeDecision = { kind: "allow" };

/** Organization writes (the path below `/organizations/:orgId`) whose body `agentId` is not the caller. */
const OTHER_AGENT_WRITES: readonly RegExp[] = [
  /^\/employees$/,
  /^\/calendar$/,
  /^\/tickets\/[^/]+\/start$/,
  /^\/proposals\/[^/]+\/implement$/,
];

function deny(message: string): ScopeDecision {
  return { kind: "deny", message };
}

function sameProject(projectId: string, claims: SessionClaims): ScopeDecision | null {
  return projectId === claims.projectId
    ? null
    : deny(`This session's credential reaches only its own Project (${claims.projectId}).`);
}

/** The table, in match order. Exported so a test can walk it against the CLI's calls. */
export const SESSION_ROUTES: readonly Row[] = [
  {
    methods: READ,
    pattern: /^\/api\/me$/,
    caller: "penguin (who am I)",
    check: () => allow,
  },
  {
    methods: ["GET", "POST"],
    pattern: new RegExp(`^/api/projects/${SEG}/organizations$`),
    caller: "penguin org ls / penguin org create",
    check: ([p], claims) => sameProject(p!, claims) ?? allow,
  },
  {
    methods: ANY,
    pattern: new RegExp(`^/api/projects/${SEG}/organizations/${SEG}(/.*)?$`),
    caller:
      "penguin org … (tickets, channels, calendar, handbook, proposals, roadmaps, claude-code)",
    check: ([p, o, rest], claims, _q, _l, method) => {
      const project = sameProject(p!, claims);
      if (project !== null) return project;
      // A desk or ticket session reaches its own organization only. A Session that works for
      // none reaches the Project's organizations: setting one up is how company-setup works.
      if (claims.orgId !== undefined && o !== claims.orgId) {
        return deny(
          `This session's credential reaches only its own organization (${claims.orgId}).`,
        );
      }
      // A few writes name in `agentId` someone other than the caller — the employee a ticket
      // session runs as, the Agent a hire takes on, whose calendar an event goes into, a
      // proposal's implementer; there the caller is its session, or `callerAgentId`.
      const other = method === "POST" && OTHER_AGENT_WRITES.some((re) => re.test(rest ?? ""));
      return { kind: "allow", claims: other ? "caller-session" : "caller" };
    },
  },
  {
    methods: ["GET", "POST"],
    pattern: new RegExp(`^/api/projects/${SEG}/agents$`),
    caller: "penguin agent ls / penguin agent create / penguin run",
    check: ([p], claims) => sameProject(p!, claims) ?? allow,
  },
  {
    methods: READ,
    pattern: new RegExp(`^/api/projects/${SEG}/agents/${SEG}/sessions$`),
    caller: "penguin ls / penguin logs / penguin input (latest session)",
    check: ([p], claims) => sameProject(p!, claims) ?? { kind: "allow", filterSessions: true },
  },
  {
    methods: ["POST"],
    pattern: new RegExp(`^/api/projects/${SEG}/agents/${SEG}/sessions$`),
    caller: "penguin run",
    check: ([p], claims) => sameProject(p!, claims) ?? { kind: "allow", adoptCreated: true },
  },
  {
    methods: ANY,
    pattern: new RegExp(`^/api/projects/${SEG}/agents/${SEG}/schedules(/.*)?$`),
    caller: "penguin schedule",
    check: ([p, a], claims) =>
      sameProject(p!, claims) ??
      (a === claims.agentId
        ? allow
        : deny(`This session's credential reaches only its own Agent's schedules.`)),
  },
  {
    methods: READ,
    pattern: new RegExp(`^/api/projects/${SEG}/usage$`),
    caller: "penguin cost",
    check: ([p], claims) => sameProject(p!, claims) ?? allow,
  },
  {
    methods: ANY,
    pattern: new RegExp(`^/api/sessions/${SEG}(/.*)?$`),
    caller: "penguin run / input / logs / chat (tasks, stream, messages, steer, abort, approvals)",
    check: ([s], claims, _q, lookups) =>
      reachesSession(claims, decodeURIComponent(s!), lookups)
        ? allow
        : deny(`This session's credential reaches only its own Agent's sessions.`),
  },
  {
    // The desktop's built-in browser is there for Agents to drive (`penguin browser`); it is
    // the signed-in user's own window, with nothing in it scoped to a Project or an Agent.
    methods: ANY,
    pattern: /^\/api\/builtin-browser(\/.*)?$/,
    caller: "penguin browser (open, read, run script, close)",
    check: () => allow,
  },
  {
    methods: READ,
    pattern: /^\/api\/telemetry$/,
    caller: "penguin telemetry",
    check: (_p, claims, query, lookups) => {
      const session = query.get("session");
      if (session === null || session === "") {
        return deny(
          "This session's credential reads telemetry of its own sessions only: name one with --session (the default inside a session).",
        );
      }
      return reachesSession(claims, session, lookups)
        ? allow
        : deny(`This session's credential reaches only its own Agent's sessions.`);
    },
  },
];

/** The table's verdict on one request. */
export function sessionScope(
  method: string,
  path: string,
  query: URLSearchParams,
  claims: SessionClaims,
  lookups: ScopeLookups,
): ScopeDecision {
  for (const row of SESSION_ROUTES) {
    if (!row.methods.includes(method)) continue;
    const m = row.pattern.exec(path);
    if (m === null) continue;
    return row.check(m.slice(1), claims, query, lookups, method);
  }
  return deny(`This session's credential does not reach ${method} ${path}.`);
}

/** The identity claims in a query or a JSON body: `sessionId`, and the Agent under `field`. */
function claimOf(
  source: URLSearchParams | Record<string, unknown>,
  field: "agentId" | "callerAgentId",
): CarriedClaims {
  const get = (k: string): unknown =>
    source instanceof URLSearchParams ? source.get(k) : source[k];
  const out: CarriedClaims = {};
  const sessionId = get("sessionId");
  const agentId = get(field);
  if (typeof sessionId === "string" && sessionId !== "") out.sessionId = sessionId;
  if (typeof agentId === "string" && agentId !== "") out.agentId = agentId;
  return out;
}

/**
 * The identity a request carries under a row's `claims` mode: the query's, then the JSON
 * body's on top (pass `null` when there is none). Exported so the CLI's tests can hold each
 * of its writes to the same reading.
 */
export function carriedClaims(
  mode: "caller" | "caller-session",
  query: URLSearchParams,
  body: unknown,
): CarriedClaims {
  const field = mode === "caller" ? "agentId" : "callerAgentId";
  const carried = claimOf(query, field);
  if (body !== null && typeof body === "object") {
    Object.assign(carried, claimOf(body as Record<string, unknown>, field));
  }
  return carried;
}

/**
 * The identity a request claims must be the credential's own: the claimed Agent is the
 * credential's Agent and the claimed session one of its sessions. A write that claims neither
 * is refused, because without a claim the routes attribute it to the person behind the
 * credential, and a session credential never speaks as a person. The caller reads the claimed
 * Agent from `agentId` (mode `caller`) or, where `agentId` names someone else, from
 * `callerAgentId` (mode `caller-session`).
 */
export function checkClaims(
  carried: CarriedClaims,
  claims: SessionClaims,
  lookups: ScopeLookups,
  write: boolean,
): string | null {
  if (carried.agentId !== undefined && carried.agentId !== claims.agentId) {
    return `This session's credential speaks for ${claims.agentId}, not ${carried.agentId}.`;
  }
  if (carried.sessionId !== undefined && !reachesSession(claims, carried.sessionId, lookups)) {
    return `This session's credential speaks for its own sessions, not ${carried.sessionId}.`;
  }
  if (write && carried.agentId === undefined && carried.sessionId === undefined) {
    return "A write with a session credential must carry the caller's sessionId and agentId.";
  }
  return null;
}
