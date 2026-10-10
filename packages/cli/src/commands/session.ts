/**
 * `penguin session` — session-level management commands.
 *
 *   penguin session rename <title> [session_id]
 *                 [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
 *
 * `rename` is the manual rename the Web App's "Rename chat" does (PATCH /api/sessions),
 * surfaced for the terminal and for agents running inside a Session: the target
 * defaults to the calling session (PENGUIN_SESSION_ID, the same default
 * `penguin org ... --session` carries), and only when that is unset to the agent's
 * most recent session (resolveSessionTarget's fallback, announced as a dim `[latest]`
 * line on stderr). An explicit session_id — full id or unique fragment — always wins.
 *
 * The title is checked client-side (1–120 characters after trimming, the server's own
 * rule) so a bad title fails before any request. A manual rename is a first-class
 * value: the auto-title generator never overwrites one.
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
import { renameSession, resolveSessionTarget } from "../server-session.js";
import type { Messages } from "../i18n.js";

export function registerSessionCommand(program: Command, t: Messages): void {
  const session = program.command("session").description(t.session.desc);
  session
    .command("rename")
    .description(t.session.renameDesc)
    .argument("<title>", t.session.renameTitle)
    .argument("[sessionId]", t.session.renameSessionId)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.latestAgentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (title: string, sessionIdArg: string | undefined, opts) => {
      const trimmed = String(title).trim();
      if (trimmed.length === 0 || trimmed.length > 120) {
        process.stderr.write(`${t.error(t.session.titleInvalid(trimmed.length))}\n`);
        process.exitCode = 1;
        return;
      }
      const json = opts.json === true;
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      // An explicit session_id always wins; the calling session (PENGUIN_SESSION_ID)
      // is the default, and only with neither set does the latest-session fallback
      // engage — the caller's agent's most recent session may be a different,
      // parallel session, so it is a floor rather than a preference.
      const ref = sessionIdArg ?? (process.env.PENGUIN_SESSION_ID?.trim() || undefined);
      const sessionId = await resolveSessionTarget(
        client,
        { ref, projectId, agentId: resolveAgentId(opts.agentId) },
        t,
      );
      if (sessionId === null) return; // no session to act on; the hint is already printed
      const info = await renameSession(client, sessionId, trimmed);
      if (json) {
        process.stdout.write(`${JSON.stringify({ sessionId, title: info.title ?? trimmed })}\n`);
      } else {
        process.stdout.write(
          `${t.session.renamed(shortSessionId(sessionId), info.title ?? trimmed)}\n`,
        );
      }
    });
}
