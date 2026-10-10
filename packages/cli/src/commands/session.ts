/**
 * `penguin session` — the group that works with the project's sessions.
 *
 *   penguin session ls [options]                    list them (ls.ts)
 *   penguin session log [session_id] [options]      render one's history (log.ts)
 *   penguin session input [session_id] [options]    message it or poll its reply (input.ts)
 *   penguin session rename [session_id] -t <title>
 *                          [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
 *
 * `rename` is the manual rename the Web App's "Rename chat" does (PATCH /api/sessions),
 * surfaced for the terminal and for agents running inside a Session. The target follows
 * the `input [session_id] -m` shape: an explicit session_id (full id or unique fragment)
 * always wins; omitted, it is the calling session (PENGUIN_SESSION_ID, the default
 * `penguin org … --session` carries too), and only when that is unset the agent's most
 * recent session (resolveSessionTarget's fallback, announced as a dim `[latest]` line on
 * stderr). The title is a required option, so a missing one is a usage error rather than
 * a rename of whichever session the default lands on.
 *
 * The title is checked client-side (checkSessionTitle, the server's own rule) so a bad
 * one fails before any request. A manual rename is a first-class value: the auto-title
 * generator never overwrites one.
 * Docs: /docs/cli § "penguin session".
 */
import type { Command } from "commander";
import {
  resolveAgentId,
  resolveConnection,
  resolveProjectId,
  ServerClient,
  shortSessionId,
} from "../client.js";
import { checkSessionTitle, renameSession, resolveSessionTarget } from "../server-session.js";
import { registerInputCommand } from "./input.js";
import { registerLogCommand } from "./log.js";
import { registerLsCommand } from "./ls.js";
import type { Messages } from "../i18n.js";

export function registerSessionCommand(program: Command, t: Messages): void {
  const session = program.command("session").description(t.session.desc);
  registerLsCommand(session, t);
  registerLogCommand(session, t);
  registerInputCommand(session, t);
  session
    .command("rename")
    .description(t.session.renameDesc)
    .argument("[sessionId]", t.session.renameSessionId)
    .requiredOption("-t, --title <title>", t.session.renameTitle)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.latestAgentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (sessionIdArg: string | undefined, opts) => {
      const title = checkSessionTitle(String(opts.title), t);
      if (title === null) return;
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      // An explicit session_id always wins; the calling session (PENGUIN_SESSION_ID)
      // is the default, and only with neither set does the latest-session fallback
      // engage — the agent's most recent session may be a different, parallel one,
      // so it is a floor rather than a preference.
      const ref = sessionIdArg ?? (process.env.PENGUIN_SESSION_ID?.trim() || undefined);
      const sessionId = await resolveSessionTarget(
        client,
        { ref, projectId: resolveProjectId(opts.projectId), agentId: resolveAgentId(opts.agentId) },
        t,
      );
      if (sessionId === null) return; // no session to act on; the hint is already printed
      const stored = (await renameSession(client, sessionId, title)).title ?? title;
      process.stdout.write(
        opts.json === true
          ? `${JSON.stringify({ sessionId, title: stored })}\n`
          : `${t.session.renamed(shortSessionId(sessionId), stored)}\n`,
      );
    });
}
