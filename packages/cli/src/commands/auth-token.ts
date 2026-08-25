/**
 * `penguin server auth-token` — mints a short-lived API session on THIS machine, for whoever
 * already has an account on it.
 *
 * It exists for a controller reaching this machine's API over an ssh tunnel. That controller
 * has ssh here, which is already read access to the whole data root — every credential, every
 * trace. What it lacked was a way to turn that access into an API session without a password:
 * the old path read this machine's SEEDED admin password off disk, which stops working the
 * moment somebody sets a real one, and never starts again.
 *
 * A token is the better shape anyway. It expires within the hour, it is one row to delete, and
 * it leaves the admin password where it belongs — on this machine, unsent.
 *
 * Printed with a marker line rather than bare, so a caller reading it over ssh takes the token
 * and not a shell banner that happened to land on the same stream.
 * Docs: /docs/cli § "penguin server".
 */
import { resolveRoot } from "@prismshadow/penguin-core";
import { mintApiToken } from "@prismshadow/penguin-server/auth-token";
import type { Command } from "commander";
import type { Messages } from "../i18n.js";

/** Precedes the token on its own line; the reading side matches this exactly. */
export const TOKEN_MARK = "---penguin-auth-token---";

/** Attaches the subcommand to the `penguin server` command (see registerServeCommands). */
export function registerAuthTokenCommand(server: Command, t: Messages): void {
  server
    .command("auth-token")
    .description(t.authToken.desc)
    .option("--user-id <id>", t.authToken.userId, "admin")
    .option("--ttl-seconds <n>", t.authToken.ttlSeconds, (raw: string) => Number.parseInt(raw, 10))
    .action((opts: { userId: string; ttlSeconds?: number }) => {
      const ttl = opts.ttlSeconds;
      if (ttl !== undefined && (!Number.isFinite(ttl) || ttl <= 0)) {
        process.stderr.write(t.authToken.badTtl + "\n");
        process.exitCode = 1;
        return;
      }
      const root = resolveRoot();
      // Stateless: signed against the root's key (auth/token-codec.ts) — no database open,
      // nothing racing the live server, and a never-booted root mints for the admin its
      // first boot will seed.
      const result = mintApiToken(root, {
        userId: opts.userId,
        ...(ttl === undefined ? {} : { ttlMs: ttl * 1000 }),
      });
      if (result.outcome === "no_user") {
        process.stderr.write(t.authToken.noUser(result.userId) + "\n");
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`${TOKEN_MARK}\n${result.token}\n`);
    });
}
