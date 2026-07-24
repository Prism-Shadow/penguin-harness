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
import { DEFAULT_SERVER_PORT, resolveRoot } from "@prismshadow/penguin-core";

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
  /**
   * Origin that serves Workspace HTML previews (PENGUIN_PREVIEW_ORIGIN), e.g.
   * `https://preview.example.com`. It must differ from the App origin by **hostname** —
   * cookies ignore ports, so a second port would still share the session cookie. Unset
   * is the norm locally: the loopback counterpart (`127.0.0.1` <-> `localhost`) is
   * derived per request instead. See design § "Workspace 文件预览".
   */
  previewOrigin: string | null;
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

/**
 * Validates PENGUIN_PREVIEW_ORIGIN into a bare origin, or throws. An unparseable value
 * is a hard failure rather than a silent fallback: falling back would quietly serve
 * previews same-origin, which is the configuration this variable exists to avoid.
 */
function normalizePreviewOrigin(raw: string | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`Invalid PENGUIN_PREVIEW_ORIGIN=${raw} (expected an absolute origin)`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid PENGUIN_PREVIEW_ORIGIN=${raw} (only http/https are supported)`);
  }
  return url.origin;
}

/** Parses server config from environment variables (PORT / HOST / PENGUIN_HOME / PENGUIN_WEB_DIST / PENGUIN_WEB_DB / PENGUIN_PREVIEW_ORIGIN). */
export function resolveServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const root = env.PENGUIN_HOME ?? resolveRoot();
  // An empty PORT string is treated as unset (the common `.env` case of an empty
  // `PORT=`): Number("") === 0 would pass the range check and bind to a random
  // port; this matches the CLI's resolvePort convention.
  const port = Number(env.PORT || DEFAULT_SERVER_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port configuration PORT=${env.PORT}`);
  }
  return {
    root,
    host: env.HOST ?? "127.0.0.1",
    port,
    dbPath: env.PENGUIN_WEB_DB ?? path.join(root, "web.db"),
    webDist: env.PENGUIN_WEB_DIST ?? defaultWebDist(),
    previewOrigin: normalizePreviewOrigin(env.PENGUIN_PREVIEW_ORIGIN),
    authSessionTtlMs: 7 * DAY_MS,
    authSessionRenewMs: 6 * DAY_MS,
  };
}
