/**
 * Principal notation as organization files use it (pure): `agent:<id>` / `user:<id>`, plus
 * `all` and `system`. Mirrors the server's organization/principal.ts, which the browser
 * bundle cannot import; the two must keep spelling principals identically.
 */
export type ParsedPrincipal =
  | { kind: "agent"; id: string }
  | { kind: "user"; id: string }
  | { kind: "all" }
  | { kind: "system" }
  | { kind: "unknown"; raw: string };

export function parsePrincipal(raw: string): ParsedPrincipal {
  const value = raw.trim();
  if (value === "all") return { kind: "all" };
  if (value === "system") return { kind: "system" };
  const m = /^(agent|user):(.+)$/.exec(value);
  if (!m) return { kind: "unknown", raw: value };
  return m[1] === "agent" ? { kind: "agent", id: m[2]! } : { kind: "user", id: m[2]! };
}

export const agentPrincipal = (agentId: string): string => `agent:${agentId}`;

/** The agent id behind an `agent:` principal, or null for anything else. */
export function principalAgentId(raw: string): string | null {
  const p = parsePrincipal(raw);
  return p.kind === "agent" ? p.id : null;
}

/** Splits a `Notify`-style input: comma separated, blanks dropped, order kept, duplicates removed. */
export function splitPrincipalList(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (v !== "" && !out.includes(v)) out.push(v);
  }
  return out;
}
