/**
 * Hono env: variables injected by the auth middleware. A contract type — the middleware
 * that fills these lives in the server (the request's credential check is assembly, not
 * vocabulary), but every route and middleware on both sides speaks this shape, so it
 * belongs beside the HTTP pieces they share.
 */
import type { SessionVia } from "@prismshadow/penguin-library-auth";
import type { UserRow } from "@prismshadow/penguin-library-auth/repos/users";

export interface AgentRequestAuth {
  projectId: string;
  agentId: string;
  grant: {
    role: string;
    generation: number;
    allEndpoints: boolean;
    crossAgent?: boolean;
    apiIds: readonly string[];
  };
  agentApi: boolean;
}

export type AppEnv = {
  Variables: {
    user: UserRow;
    /** How the current session was established — see {@link SessionVia}. */
    sessionVia: SessionVia;
    /** Present when the request was authenticated via an Agent auth session Bearer token. */
    agentAuth?: AgentRequestAuth;
  };
};
