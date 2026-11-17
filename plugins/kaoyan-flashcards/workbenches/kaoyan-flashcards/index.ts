/**
 * Kaoyan Flashcards: the workbench handler.
 *
 * The page (ui/index.html) does the work in the browser: the question bank and the recitation
 * documents are static files under ui/data/, and progress lives in three localStorage keys
 * (kmc:state, kmc:docs, kmc:imported). ui/storage-bridge.js sends those keys here, and this
 * handler keeps them in the workbench's own document (`host.setState`), so progress follows
 * the Agent across browsers and is deleted with the workbench.
 *
 *   GET  /health       -> { ok: true }
 *   GET  /saves        -> { saves: { <key>: { value: string | null, at: number } } }
 *   POST /saves        <- { saves: { … } }  a key is taken when its `at` is newer
 *   POST /saves/reset  -> clears every save
 *
 * No network access, no files: web-standard code only.
 */
import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

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

/** Copied from the shared saves handler (a workbench has no package to import from). */
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

export default {
  modules: {
    Workbench: {
      create({ use }) {
        const saves = createSaves(use.host);
        return {
          api: {
            main: {
              async handle(req): Promise<WorkbenchResponse> {
                if (req.path === "/health" && req.method === "GET") {
                  return { body: { ok: true, app: "kaoyan-flashcards" } };
                }
                const answer = await saves.handle(req.method, req.path, req.body);
                if (answer) return answer;
                return { status: 404, body: { error: `no such route: ${req.path}` } };
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
