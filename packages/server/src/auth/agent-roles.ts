/**
 * The Agent auth role templates: the fixed standings a user picks from when granting an Agent
 * access. A role binds a SCOPE over the server's HTTP routes — each route is addressed by its
 * registered route id (`"HttpModule.routes"` entry `id`), and authorization is per route id,
 * which covers HTTP and CLI alike (since CLI commands reach the server over HTTP). Four
 * templates, deliberately not extensible from the outside — a new standing is a code change,
 * so the sets a session can run under are always the ones this file names.
 */

/** The fixed role templates, as stored and as surfaces show them. */
export const AGENT_AUTH_ROLES = [
  "general",
  "system-maintainer",
  "admin",
  "full-permissions",
] as const;

export type AgentAuthRole = (typeof AGENT_AUTH_ROLES)[number];

/** The role a newly created Agent's session runs under, absent an explicit grant. */
export const DEFAULT_AGENT_AUTH_ROLE: AgentAuthRole = "general";

/**
 * The roles whose sessions may reach EVERY route the server registers, the granted set aside.
 * The other roles are bounded to exactly the route ids granted to the Agent.
 */
export const ALL_ENDPOINT_ROLES: readonly AgentAuthRole[] = ["admin", "full-permissions"];

/** Whether the role reaches every route without its granted set naming it. */
export function roleSpansAllEndpoints(role: AgentAuthRole): boolean {
  return ALL_ENDPOINT_ROLES.includes(role);
}

/** Whether the role carries the Agent's own API settings and keys (human-gated endpoints). */
export function roleHasAgentApi(role: AgentAuthRole): boolean {
  return role === "system-maintainer" || role === "full-permissions";
}
