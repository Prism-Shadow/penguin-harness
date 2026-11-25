/**
 * Whom a plugin command runs as when the caller holds the server's local API token.
 *
 * The token stands for the built-in administrator, and every tool subprocess of a server-driven
 * Session holds it as `PENGUIN_API_TOKEN`: an Agent's `penguin <command>` arrives as the
 * administrator, whoever asked the Agent. For most commands that is PRFC-0024 v1.1's rule and
 * stays so. A command whose data half says `tokenCaller: "session-driver"` asks for a person
 * instead: a token call must name a Session, and runs as the person whose run is in progress in
 * it — the signed-in user who started that run (SessionDrivers.runDriverOf; for a subagent's
 * Session, its root's run). It fails closed: no Session named is `session_required`; no run in
 * progress, a run nobody started (the token itself, a schedule nobody signed for, the Agent API,
 * company mode, a goal, a compaction), a run someone else steered, a person since deleted, or one
 * who cannot open the Project is `driver_unknown`. Never the Project's owner, never a past run —
 * and nothing is in progress after a restart.
 *
 * The person's access decides, not the token's: the route skips the token's own Project check
 * for these commands, so a member's own Project — which the administrator cannot open — reaches
 * its Agents. The route still checks that the Session belongs to the named Project.
 *
 * A known limit, until per-Session credentials (design PR #235) land: the Session is whatever
 * the caller names, and `PENGUIN_SESSION_ID` / `PENGUIN_PROJECT_ID` are the Agent's own to set.
 * An Agent can name another Session of a Project it names and borrow the driver of a run in
 * progress there — in a Project the token opens, or whose Session it can name. For a person's own
 * sign-in the rule holds without exception; for an Agent it narrows the token, it is not a
 * boundary (auth/middleware.ts requireHuman).
 */
import type { CliCommandCaller } from "@prismshadow/penguin-core/cli";
import type { Users } from "@prismshadow/penguin-library-auth";
import type { Access } from "@prismshadow/penguin-library-project";
import type { SessionDrivers } from "@prismshadow/penguin-library-session";
import { HttpError } from "@prismshadow/penguin-library-http/errors";

export interface SessionDriverDeps {
  drivers: Pick<SessionDrivers, "runDriverOf">;
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
      "This command runs for the person whose run is in progress in a Session: with the local API token, run it inside that Session (PENGUIN_SESSION_ID).",
    );
  }
  const userId = deps.drivers.runDriverOf(sessionId);
  const user = userId === null ? null : deps.users.findById(userId);
  if (user === null) {
    throw new HttpError(
      403,
      "driver_unknown",
      `No run a person started is in progress in Session ${sessionId}, so this command cannot tell whom it runs for: it runs while a signed-in person's message is being worked on (not for schedules nobody signed for, the Agent API, company mode or goals).`,
    );
  }
  if (!deps.access.canAccess(user.userId, projectId)) {
    throw new HttpError(
      403,
      "driver_unknown",
      `The person whose run is in progress in Session ${sessionId} cannot open Project ${projectId}, so this command does not run for them.`,
    );
  }
  return { ...caller, userId: user.userId, isAdmin: user.isAdmin };
}
