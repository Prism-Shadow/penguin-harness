/**
 * Principal notation — how organization files name a person or an employee:
 * `agent:<agent_id>` / `user:<user_id>`, plus `all` (every employee) and `system` (the
 * scheduler as a message sender). Agent ids and user ids are separate namespaces, which is
 * exactly why the prefix exists: the same id could name both.
 */

export type Principal =
  | { kind: "agent"; id: string }
  | { kind: "user"; id: string }
  | { kind: "all" }
  | { kind: "system" };

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function parsePrincipal(raw: string): Principal | null {
  const value = raw.trim();
  if (value === "all") return { kind: "all" };
  if (value === "system") return { kind: "system" };
  const m = /^(agent|user):(.+)$/.exec(value);
  if (!m || !ID.test(m[2]!)) return null;
  return m[1] === "agent" ? { kind: "agent", id: m[2]! } : { kind: "user", id: m[2]! };
}

export function formatPrincipal(p: Principal): string {
  switch (p.kind) {
    case "agent":
      return `agent:${p.id}`;
    case "user":
      return `user:${p.id}`;
    case "all":
      return "all";
    case "system":
      return "system";
  }
}

export function agentPrincipal(agentId: string): string {
  return `agent:${agentId}`;
}

export function userPrincipal(userId: string): string {
  return `user:${userId}`;
}

/** The agent id behind an `agent:` principal string, or null for anything else. */
export function principalAgentId(raw: string): string | null {
  const p = parsePrincipal(raw);
  return p?.kind === "agent" ? p.id : null;
}

/** The user id behind a `user:` principal string, or null for anything else. */
export function principalUserId(raw: string): string | null {
  const p = parsePrincipal(raw);
  return p?.kind === "user" ? p.id : null;
}

/** Splits a `Notify`-style list: comma separated, blanks dropped, order kept, duplicates removed. */
export function splitPrincipalList(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (v !== "" && !out.includes(v)) out.push(v);
  }
  return out;
}
