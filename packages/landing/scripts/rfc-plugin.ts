/**
 * The Vite plugin behind the RFC index's GitHub PR status records (`virtual:penguin-rfc-prs`).
 *
 * At build time, `loadRfcPrStatuses()` reads the local cache (seeded from
 * `src/lib/rfc-pr-status.json`), refreshes open `request-for-comments` PRs at most once per 24
 * hours in a single batched GraphQL query (merged PRs are never fetched again), and falls back to
 * the offline snapshot when unauthenticated or offline.
 */
import type { Plugin } from "vite";
import { loadRfcPrStatuses, SEED_FILE } from "./rfcs/pr-status.mjs";

const VIRTUAL_ID = "virtual:penguin-rfc-prs";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export function rfcPrStatus(options?: { offline?: boolean }): Plugin {
  let cache: ReturnType<typeof loadRfcPrStatuses> | undefined;
  return {
    name: "penguin:rfc-prs",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      this.addWatchFile?.(SEED_FILE);
      cache ??= loadRfcPrStatuses({ offline: options?.offline ?? false });
      return [
        `export const updatedAt = ${JSON.stringify(cache.updatedAt)};`,
        `export const prs = ${JSON.stringify(cache.prs)};`,
      ].join("\n");
    },
    handleHotUpdate({ file, server }) {
      if (file === SEED_FILE) {
        cache = undefined;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      }
    },
  };
}
