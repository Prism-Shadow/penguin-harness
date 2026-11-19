/**
 * Refuses the local API token, presented as a Bearer header, on a write that only a person may
 * make: 403 `human_required`. Every cookie session passes as the person's sign-in — from the Web
 * App, `penguin auth login` or `penguin auth token`, and the Penguin Remote session exchanged
 * from the token itself. Every tool subprocess of a server-driven Session holds that token as
 * `PENGUIN_API_TOKEN`, so these are the writes an Agent must not make from its own shell:
 *
 * - who can reach an Agent from outside — its API switch, keyless access and approval mode, its
 *   keys, the API tab's Try it, and the admin's `agentApiEnabled` (http/routes/agent-api.ts,
 *   amsp/try-route.ts, http/routes/admin-settings.ts);
 * - the person's own browser — choosing the agent browser's backend, minting a pairing code
 *   (builtin-browser/routes.ts).
 *
 * This narrows the credential the harness hands an Agent; it is not a boundary. A process that
 * runs as the data root's OS user outside the sandbox can mint a sign-in of its own
 * (`penguin auth token`), or reset a password with the token and sign in; and an Agent holding
 * the token can exchange it for a Remote session (POST /api/remote/session) that passes here.
 * The sandbox is the boundary. A per-Session credential (design PR #235) is the structural fix:
 * when it lands, this check becomes "a Session's credential is refused, a person's login is
 * not", and the routes calling it do not change.
 *
 * Its own module, beside the middleware that re-exports it: code plugins reach it through
 * `@prismshadow/penguin-server/plugin`, and bundling it must not bring the whole middleware along.
 */
import type { SessionVia } from "@prismshadow/penguin-library-auth";
import { HttpError } from "../http/errors.js";

export function requireHuman(c: { var: { sessionVia: SessionVia } }): void {
  if (c.var.sessionVia === "token") {
    throw new HttpError(
      403,
      "human_required",
      "This takes a person's sign-in; the local API token cannot do it.",
    );
  }
}
