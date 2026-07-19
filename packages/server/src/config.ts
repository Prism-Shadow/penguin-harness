/**
 * Server runtime config (ServerConfig) — parsed from environment variables.
 *
 * The data root directory is shared with the SDK / CLI (`resolveRoot()`:
 * PENGUIN_HOME or ~/.penguin/data); the SQLite index database defaults to
 * `<root>/web.db` (overridable via PENGUIN_WEB_DB, tests use ":memory:").
 * In production, the SPA is served statically once the frontend build output
 * directory (PENGUIN_WEB_DIST, the bundled web-dist/, or ../web/dist) is
 * detected to exist.
 * Docs: /docs/configuration § "Environment variables".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRoot } from "@prismshadow/penguin-core";

export interface ServerConfig {
  /** Local data root directory (shared with the SDK/CLI). */
  root: string;
  /** HTTP listen address and port (defaults to 127.0.0.1:7364, deliberately avoiding common ports like 3000/8080). */
  host: string;
  port: number;
  /** SQLite database path; ":memory:" for test injection. */
  dbPath: string;
  /** Frontend static assets directory; whether it's enabled is decided by checking existence when the app is assembled. */
  webDist: string;
  /** Login session validity period (7 days). */
  authSessionTtlMs: number;
  /** Sliding renewal threshold: if the remaining validity is below this value when validation succeeds, it's renewed to the full TTL (renews under 6 days). */
  authSessionRenewMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Default frontend build output directory, first match wins:
 * - `<this package>/web-dist`: npm package layout — the release workflow copies the built
 *   web assets into the published package, so an `npm install` gets the Web UI too;
 * - `<this package>/../web/dist`: monorepo layout (resolves the same whether running
 *   from src or dist), also the fallback when neither exists.
 */
function defaultWebDist(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.resolve(here, "..", "web-dist");
  if (fs.existsSync(bundled)) return bundled;
  return path.resolve(here, "..", "..", "web", "dist");
}

/** Parses server config from environment variables (PORT / HOST / PENGUIN_HOME / PENGUIN_WEB_DIST / PENGUIN_WEB_DB). */
export function resolveServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const root = env.PENGUIN_HOME ?? resolveRoot();
  // An empty PORT string is treated as unset (the common `.env` case of an empty
  // `PORT=`): Number("") === 0 would pass the range check and bind to a random
  // port; this matches the CLI's resolvePort convention.
  const port = Number(env.PORT || 7364);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`非法端口配置 PORT=${env.PORT}`);
  }
  return {
    root,
    host: env.HOST ?? "127.0.0.1",
    port,
    dbPath: env.PENGUIN_WEB_DB ?? path.join(root, "web.db"),
    webDist: env.PENGUIN_WEB_DIST ?? defaultWebDist(),
    authSessionTtlMs: 7 * DAY_MS,
    authSessionRenewMs: 6 * DAY_MS,
  };
}
