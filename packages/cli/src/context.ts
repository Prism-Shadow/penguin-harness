/**
 * The host's `CliContext` implementation: what a contributed command receives — the
 * resolved language, this invocation's data root, the output and table helpers, the API
 * client (connection resolution, auto-start included, auth the host's) and the remembered
 * login session. A thin facade over the CLI's own facilities (client.ts, auth-session.ts,
 * table.ts); contributors never import those, the context is the one host interface they
 * may depend on.
 */
import type { CliApiClient, CliContext } from "@prismshadow/penguin-core/plugin";
import { getMessages } from "./i18n.js";
import { resolveRootOption } from "./root-option.js";
import { renderTable } from "./table.js";
import { ServerClient, resolveConnection } from "./client.js";
import { readSession } from "./auth-session.js";

/** The context handed to a contributed command's register. */
export function cliContext(opts: { root?: string; language: "en" | "zh" }): CliContext {
  const root = resolveRootOption(opts.root);
  const language = opts.language;
  return {
    language,
    root,
    write: (text) => {
      process.stdout.write(`${text}\n`);
    },
    writeErr: (text) => {
      process.stderr.write(`${text}\n`);
    },
    renderTable,
    connect: async (): Promise<CliApiClient> => {
      const conn = await resolveConnection({}, getMessages(language));
      const client = new ServerClient(conn, getMessages(language));
      return {
        baseUrl: client.conn.baseUrl,
        request: (method, apiPath, body) => client.request(method, apiPath, body),
      };
    },
    readSession: () => {
      const stored = readSession(root);
      if (stored === null) return null;
      // The token stays the host's: a contributor reads WHO is signed in, never the
      // credential itself — the API client a context hands out does its own auth.
      return {
        server: stored.server,
        userId: stored.userId,
        ...(stored.expiresAt !== undefined ? { expiresAt: stored.expiresAt } : {}),
      };
    },
  };
}
