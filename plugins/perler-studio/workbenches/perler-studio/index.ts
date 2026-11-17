import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

/**
 * Perler Studio's handler. The pattern is computed in the browser; the server side does two
 * things for the page:
 *
 * - Exports (`POST /stash`, then `GET /file/<id>` or `GET /page/<id>`): the page hands over a
 *   file it generated (the PNG pattern, the CSV, the JSON or the print page) and gets back a
 *   same-origin link, which downloads more reliably inside the app's frame than a Blob link.
 *   Exports are held in memory only, each for 15 minutes, and the stash is bounded in count
 *   and in bytes: a new export pushes out the oldest ones until it fits.
 * - Saves (`/saves`): the page's settings and palettes, which `ui/storage-bridge.js` sends
 *   from `localStorage`, kept in the workbench's own state by `createSaves`.
 */

// ---------------------------------------------------------------------------------------------
// Saves: copied from the shared saves-handler.ts (a workbench has no package to import from).
// ---------------------------------------------------------------------------------------------

interface Save {
  value: string | null;
  at: number;
}
type Saves = Record<string, Save>;

/** Keys a page may store: its own short names, never a path or a prototype member. */
const KEY_RX = /^[A-Za-z0-9_.:@-]{1,96}$/;
const MAX_VALUE = 512 * 1024;
const MAX_KEYS = 200;

function asSaves(value: unknown): Saves {
  const saves: Saves = {};
  const doc = value as { saves?: unknown } | null | undefined;
  if (!doc || typeof doc !== "object" || !doc.saves || typeof doc.saves !== "object") return saves;
  for (const [key, raw] of Object.entries(doc.saves as Record<string, unknown>)) {
    const save = raw as Partial<Save> | null;
    if (!KEY_RX.test(key) || !save || typeof save.at !== "number") continue;
    if (save.value !== null && typeof save.value !== "string") continue;
    saves[key] = { value: save.value, at: save.at };
  }
  return saves;
}

function createSaves(host: {
  getState(): unknown;
  setState(state: unknown): Promise<void>;
  log(message: string): void;
}) {
  // Read-modify-write runs one at a time: two tabs saving together must not drop a key.
  let queue: Promise<unknown> = Promise.resolve();
  const update = (change: (saves: Saves) => boolean): Promise<void> => {
    const run = queue.then(async () => {
      const state = (host.getState() ?? {}) as Record<string, unknown>;
      const saves = asSaves(state);
      if (change(saves)) await host.setState({ ...state, saves });
    });
    queue = run.catch((err) => host.log(`saves: ${String(err)}`));
    return run;
  };

  return {
    /** Answers a `/saves` request, or null when the path is not one of its routes. */
    async handle(method: string, path: string, body: unknown): Promise<WorkbenchResponse | null> {
      if (path === "/saves" && method === "GET") {
        return { body: { saves: asSaves(host.getState()) } };
      }
      if (path === "/saves" && method === "POST") {
        const incoming = asSaves(body);
        let taken = 0;
        await update((saves) => {
          for (const [key, save] of Object.entries(incoming)) {
            if (save.value !== null && save.value.length > MAX_VALUE) continue;
            const current = saves[key];
            if (current !== undefined && current.at >= save.at) continue;
            if (current === undefined && Object.keys(saves).length >= MAX_KEYS) continue;
            saves[key] = save;
            taken += 1;
          }
          return taken > 0;
        });
        return { body: { ok: true, taken } };
      }
      if (path === "/saves/reset" && method === "POST") {
        await update((saves) => {
          for (const key of Object.keys(saves)) delete saves[key];
          return true;
        });
        return { body: { ok: true } };
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Exports: a short-lived, bounded stash in memory.
// ---------------------------------------------------------------------------------------------

type Stashed = { name: string; type: string; bytes: Uint8Array; at: number };

/** How long an export stays downloadable. */
const TTL_MS = 15 * 60 * 1000;
/** The largest single export; a 200 x 200 pattern's PNG is a few MB. */
const MAX_EXPORT_BYTES = 24 * 1024 * 1024;
/** How many exports are held at once. */
const MAX_EXPORTS = 16;
/** How many bytes all held exports may take together. */
const MAX_STASH_BYTES = 48 * 1024 * 1024;

/** A download name a header carries as is: ASCII letters, digits, `_`, `.` and `-`. */
function safeName(raw: string): string {
  const base =
    String(raw || "export")
      .split(/[\\/]/)
      .pop() || "export";
  const clean = base.replace(/[^\w.-]/g, "_").slice(0, 120);
  return clean || "export";
}

function createStash() {
  // A Map iterates in insertion order, so its first entry is always the oldest export.
  const items = new Map<string, Stashed>();
  let bytes = 0;
  const drop = (id: string) => {
    const item = items.get(id);
    if (!item) return;
    bytes -= item.bytes.length;
    items.delete(id);
  };
  return {
    get size() {
      return items.size;
    },
    get: (id: string) => items.get(id),
    /** Forgets every export older than the TTL. */
    prune(now: number) {
      for (const [id, item] of items) if (now - item.at > TTL_MS) drop(id);
    },
    /** Holds `item`, first letting the oldest exports go until it fits both bounds. */
    put(item: Stashed): string {
      for (const id of items.keys()) {
        if (items.size < MAX_EXPORTS && bytes + item.bytes.length <= MAX_STASH_BYTES) break;
        drop(id);
      }
      const id = crypto.randomUUID();
      items.set(id, item);
      bytes += item.bytes.length;
      return id;
    },
  };
}

export default {
  modules: {
    Workbench: {
      create({ use }) {
        const host = use.host;
        const saves = createSaves(host);
        const stash = createStash();
        return {
          api: {
            main: {
              async handle(req): Promise<WorkbenchResponse> {
                const method = String(req.method || "GET").toUpperCase();
                const path = req.path || "/";

                const saved = await saves.handle(method, path, req.body);
                if (saved) return saved;

                stash.prune(Date.now());

                if (method === "GET" && path === "/info") {
                  return { body: { ok: true, stashed: stash.size } };
                }

                if (method === "POST" && path === "/stash") {
                  const bytes = req.bytes;
                  if (!bytes || bytes.length === 0) {
                    return { status: 400, body: { error: "empty body" } };
                  }
                  if (bytes.length > MAX_EXPORT_BYTES) {
                    return { status: 413, body: { error: "too large" } };
                  }
                  const name = safeName(req.query && req.query.name ? req.query.name : "export");
                  const rawType =
                    (req.headers && req.headers["content-type"]) || "application/octet-stream";
                  const type = String(rawType).split(";")[0] || "application/octet-stream";
                  const id = stash.put({ name, type, bytes, at: Date.now() });
                  host.log(`perler-studio: stashed ${name} (${bytes.length} bytes)`);
                  return {
                    body: {
                      id,
                      name,
                      href: "../api/file/" + id,
                      page: "../api/page/" + id,
                    },
                  };
                }

                if (method === "GET" && (path.startsWith("/file/") || path.startsWith("/page/"))) {
                  const inline = path.startsWith("/page/");
                  const id = path.slice(6);
                  const item = stash.get(id);
                  if (!item) return { status: 404, body: { error: "not found or expired" } };
                  return {
                    headers: {
                      "content-type": item.type,
                      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${item.name}"`,
                      "cache-control": "no-store",
                      "x-content-type-options": "nosniff",
                    },
                    bytes: item.bytes,
                  };
                }

                return { status: 404, body: { error: "no such route" } };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
