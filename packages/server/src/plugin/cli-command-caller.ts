/**
 * Whom a plugin command runs as when the caller holds the server's local API token.
 *
 * The token stands for the built-in administrator, and every tool subprocess of a server-driven
 * Session holds it as `PENGUIN_API_TOKEN`: an Agent's `penguin <command>` arrives as the
 * administrator, whoever asked the Agent. For most commands that is PRFC-0024 v1.1's rule and
 * stays so. A command whose data half says `tokenCaller: "session-driver"` asks for the person
 * instead: a token call must name a Session, and runs as the person who last started a run in it
 * — the `driven_by` the Session index records (SessionDriverRegistry.note), so the answer is the
 * same before and after a restart. It fails closed: no Session named is `session_required`; a
 * Session that records nobody, a person since deleted, or one who can no longer open the
 * Project is `driver_unknown`. It never falls back to the Project's owner.
 *
 * The route has already checked that the Session belongs to the named Project, so the person
 * borrowed is always one who drove a Session of that Project. A person's own sign-in (a cookie,
 * a Remote session) is never replaced.
 *
 * This narrows the token; it is not a boundary (auth/middleware.ts requireHuman): a process
 * outside the sandbox can mint a sign-in of its own. A per-Session credential (design PR #235)
 * is the structural fix.
 */
import type { CliCommandCaller } from "@prismshadow/penguin-core/cli";
import type { Users } from "@prismshadow/penguin-library-auth";
import type { Access } from "@prismshadow/penguin-library-project";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import { HttpError } from "../http/errors.js";

export interface SessionDriverDeps {
  sessions: Pick<SessionIndex, "findById">;
  users: Pick<Users, "findById">;
  access: Pick<Access, "canAccess">;
}

/** The caller a `session-driver` command runs as for a token call; throws the refusal. */
export function sessionDriverCaller(
  caller: CliCommandCaller,
  deps: SessionDriverDeps,
): CliCommandCaller {
  const { sessionId, projectId } = caller;
  if (sessionId === undefined || projectId === undefined) {
    throw new HttpError(
      403,
      "session_required",
      "This command runs for the person driving a Session: with the local API token, run it inside a Session (PENGUIN_SESSION_ID), or sign in (penguin auth login) to run it as yourself.",
    );
  }
  const userId = deps.sessions.findById(sessionId)?.drivenBy ?? null;
  const user = userId === null ? null : deps.users.findById(userId);
  if (user === null) {
    throw new HttpError(
      403,
      "driver_unknown",
      `Session ${sessionId} records no person who started a run in it, so this command cannot tell whom it runs for: start a run in it from the Web App or a signed-in CLI first.`,
    );
  }
  if (!deps.access.canAccess(user.userId, projectId)) {
    throw new HttpError(
      403,
      "driver_unknown",
      `The person who last started a run in Session ${sessionId} can no longer open Project ${projectId}, so this command does not run for them.`,
    );
  }
  return { ...caller, userId: user.userId, isAdmin: user.isAdmin };
}
