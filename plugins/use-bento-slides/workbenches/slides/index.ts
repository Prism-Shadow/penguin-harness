/**
 * Slides: the handler of the AI Slides workbench.
 *
 * A deck is one JSON file, `decks/<id>.bento.json`, in the folder of files this workbench shares
 * with its Agent (`host.listFiles` and friends). The page edits it through the routes below; the
 * Agent edits it with its own file tools. Nothing here decides between the two: a save names the
 * revision it was made from and is refused when the file has moved on (the page then replays the
 * person's edits on the newer file), and a stream tells an open page when the file changed under
 * it. A version one side replaced is kept under `history/<id>/`, the last twenty of them.
 *
 *   GET    /info                 whether this server offers shared files, and where they are
 *   GET    /decks                the decks, newest first
 *   POST   /decks                { id?, text } creates one; answers its id and revision
 *   GET    /decks/:id            { id, rev, text }
 *   PUT    /decks/:id            { text, base } -> { rev }, or 409 { rev, text } when not made from the file's revision
 *   DELETE /decks/:id            the deck file and its history
 *   GET    /decks/:id/history    { versions: { name, at, by, size }[] }, newest first
 *   GET    /decks/:id/history/:name  { name, text }: one version a save replaced
 *   GET    /events               server-sent events: `decks` whenever a deck file changed
 *   GET    /ask?deck=:id         the deck's Session and whether it is running
 *   POST   /ask                  { deck, text, slide?, selection? } runs one request of the Agent on the deck
 *   POST   /ask/reset            { deck } forgets the deck's Session; the next request opens a new one
 *   POST   /export?name=…        stashes a file the page built; answers the link that downloads it
 *   GET    /export/:token
 */
import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

interface FileInfo {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * The host's shared files as this handler uses them. A server from before them has no such
 * methods and its types do not name them, so the handler reads them through this shape and says
 * plainly, on `/info`, when they are missing.
 */
interface SharedFiles {
  listFiles(): Promise<FileInfo[]>;
  readFile(path: string): Promise<Uint8Array | null>;
  writeFile(path: string, data: Uint8Array | string): Promise<FileInfo>;
  removeFile(path: string): Promise<void>;
  filePath(path?: string): string;
}

type Message = { role: "user" | "assistant" | "error"; text: string; at: string };
type State = { sessions?: Record<string, string>; talks?: Record<string, Message[]> };
/** Messages kept per deck: the rail shows the recent exchange, the Session holds all of it. */
const TALK_KEPT = 40;

const DECK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DECK_FILE = /^decks\/([a-z0-9][a-z0-9-]{0,63})\.bento\.json$/;
const deckPath = (id: string) => `decks/${id}.bento.json`;
/** A version one side replaced: `history/<deck>/<ms>-<by>.bento.json`, `by` the side that wrote it. */
const HISTORY_FILE = /^history\/([a-z0-9][a-z0-9-]{0,63})\/(\d{1,16})-(editor|agent)\.bento\.json$/;
const VERSION_NAME = /^\d{1,16}-(?:editor|agent)$/;
/** A deck file larger than this is not read into a page. */
const MAX_DECK_BYTES = 40 * 1024 * 1024;
/** How often the deck files are looked at while a page is listening. */
const WATCH_MS = 700;
const HEARTBEAT_MS = 15_000;
const HISTORY_KEPT = 20;
const EXPORT_TTL_MS = 10 * 60 * 1000;
const EXPORT_KEPT = 4;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function revisionOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const slug = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "deck";

const json = (body: unknown, status?: number): WorkbenchResponse =>
  status === undefined ? { body } : { status, body };

export default {
  modules: {
    Workbench: {
      create({ use, effect }) {
        const host = use.host;
        const shared = host as unknown as Partial<SharedFiles>;
        const files: SharedFiles | null =
          typeof shared.listFiles === "function" &&
          typeof shared.readFile === "function" &&
          typeof shared.writeFile === "function" &&
          typeof shared.removeFile === "function" &&
          typeof shared.filePath === "function"
            ? (shared as SharedFiles)
            : null;

        // ---- decks ------------------------------------------------------------------------

        const readText = async (path: string): Promise<string | null> => {
          const bytes = await files!.readFile(path);
          return bytes === null ? null : decoder.decode(bytes);
        };

        /** A deck's title and slide count, read once per version of its file. */
        const summaries = new Map<string, { stamp: string; title: string; slides: number }>();
        const summarize = async (file: FileInfo, id: string) => {
          const stamp = `${file.mtimeMs}:${file.size}`;
          const known = summaries.get(id);
          if (known?.stamp === stamp) return known;
          let title = id;
          let slides = 0;
          if (file.size <= MAX_DECK_BYTES) {
            try {
              const doc = JSON.parse((await readText(file.path)) ?? "null") as {
                title?: unknown;
                slides?: unknown;
              } | null;
              if (typeof doc?.title === "string" && doc.title.trim() !== "") title = doc.title;
              if (Array.isArray(doc?.slides)) slides = doc.slides.length;
            } catch {
              // Half-written or not JSON: listed by its id until the next write.
            }
          }
          const summary = { stamp, title, slides };
          summaries.set(id, summary);
          return summary;
        };

        const deckFiles = async (): Promise<Array<FileInfo & { id: string }>> =>
          (await files!.listFiles()).flatMap((file) => {
            const id = DECK_FILE.exec(file.path)?.[1];
            return id === undefined ? [] : [{ ...file, id }];
          });

        /** One write at a time per deck: a save is a read, a comparison and a write. */
        const queues = new Map<string, Promise<unknown>>();
        const locked = <T>(id: string, work: () => Promise<T>): Promise<T> => {
          const run = (queues.get(id) ?? Promise.resolve()).then(work, work);
          queues.set(
            id,
            run.catch(() => undefined),
          );
          return run;
        };

        /** The text this handler last wrote for a deck: what an outside write replaces. */
        const written = new Map<string, { rev: string; text: string }>();

        const keep = async (id: string, text: string, by: "editor" | "agent") => {
          try {
            await files!.writeFile(`history/${id}/${Date.now()}-${by}.bento.json`, text);
            const old = (await files!.listFiles())
              .filter((file) => file.path.startsWith(`history/${id}/`))
              .sort((a, b) => (a.path < b.path ? 1 : -1))
              .slice(HISTORY_KEPT);
            for (const file of old) await files!.removeFile(file.path);
          } catch (err) {
            host.log(`history of ${id}: ${String(err)}`);
          }
        };

        /** The versions of a deck the history holds, newest first. */
        const versionsOf = async (id: string) =>
          (await files!.listFiles())
            .flatMap((file) => {
              const match = HISTORY_FILE.exec(file.path);
              if (match === null || match[1] !== id) return [];
              const at = Number(match[2]);
              return [{ name: `${at}-${match[3]}`, at, by: match[3] ?? "", size: file.size }];
            })
            .sort((a, b) => b.at - a.at);

        // ---- watching ---------------------------------------------------------------------

        type Listener = (chunk: string) => void;
        const listeners = new Set<Listener>();
        let seen: Map<string, string> | null = null;
        let watching: ReturnType<typeof setInterval> | null = null;
        const stamps = async () =>
          new Map((await deckFiles()).map((file) => [file.id, `${file.mtimeMs}:${file.size}`]));
        const look = async () => {
          let now: Map<string, string>;
          try {
            now = await stamps();
          } catch {
            return;
          }
          const before = seen;
          seen = now;
          if (before === null) return;
          const changed = [...now]
            .filter(([id, stamp]) => before.get(id) !== stamp)
            .map(([id]) => id);
          const removed = [...before.keys()].filter((id) => !now.has(id));
          if (changed.length === 0 && removed.length === 0) return;
          // The version this handler wrote and something else has now replaced is kept.
          for (const id of changed) {
            const mine = written.get(id);
            if (mine === undefined) continue;
            const text = await readText(deckPath(id)).catch(() => null);
            if (text !== null && (await revisionOf(text)) !== mine.rev) {
              await keep(id, mine.text, "editor");
              written.delete(id);
            }
          }
          const data = JSON.stringify({ changed, removed });
          for (const send of listeners) send(`event: decks\ndata: ${data}\n\n`);
        };
        const listen = (send: Listener) => {
          listeners.add(send);
          if (watching === null) {
            seen = null;
            void look();
            watching = setInterval(() => void look(), WATCH_MS);
          }
          return () => {
            listeners.delete(send);
            if (listeners.size === 0 && watching !== null) {
              clearInterval(watching);
              watching = null;
            }
          };
        };
        effect(() => {
          if (watching !== null) clearInterval(watching);
          listeners.clear();
        });

        // ---- the Agent ---------------------------------------------------------------------

        let stateQueue: Promise<unknown> = Promise.resolve();
        const sessions = (): Record<string, string> => ({
          ...(((host.getState() ?? {}) as State).sessions ?? {}),
        });
        const talkOf = (deck: string): Message[] => [
          ...(((host.getState() ?? {}) as State).talks?.[deck] ?? []),
        ];
        /** Changes the state document under one queue: a session id and a message never race. */
        const change = (edit: (state: Required<State>) => void) => {
          const run = stateQueue.then(async () => {
            const state = (host.getState() ?? {}) as State;
            const next = {
              ...state,
              sessions: { ...(state.sessions ?? {}) },
              talks: { ...(state.talks ?? {}) },
            };
            edit(next);
            await host.setState(next);
          });
          stateQueue = run.catch(() => undefined);
          return run;
        };
        const setSession = (deck: string, sessionId: string | null) =>
          change((state) => {
            if (sessionId === null) {
              delete state.sessions[deck];
              delete state.talks[deck];
            } else state.sessions[deck] = sessionId;
          });
        const say = (
          deck: string,
          role: Message["role"],
          text: string,
          after?: { sessionId: string; at: string },
        ) =>
          change((state) => {
            if (after) {
              const last = state.talks[deck]?.at(-1);
              if (
                state.sessions[deck] !== after.sessionId ||
                last?.role !== "user" ||
                last.at !== after.at
              )
                return;
            }
            const at = new Date().toISOString();
            state.talks[deck] = [...(state.talks[deck] ?? []), { role, text, at }].slice(
              -TALK_KEPT,
            );
          });
        const statusOf = (sessionId: string): string | null => {
          try {
            return host.sessionStatus(sessionId);
          } catch {
            return null; // The Session is gone: the next request opens a new one.
          }
        };

        // ---- downloads --------------------------------------------------------------------

        const exports = new Map<
          string,
          { name: string; type: string; bytes: Uint8Array; at: number }
        >();
        const pruneExports = () => {
          const now = Date.now();
          for (const [token, item] of exports)
            if (now - item.at > EXPORT_TTL_MS) exports.delete(token);
          while (exports.size > EXPORT_KEPT) exports.delete(exports.keys().next().value as string);
        };

        return {
          api: {
            main: {
              async handle(req): Promise<WorkbenchResponse> {
                const method = req.method.toUpperCase();
                const path = req.path.replace(/\/+$/, "") || "/";
                const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
                  string,
                  unknown
                >;

                if (path === "/info" && method === "GET") {
                  return json({
                    supported: files !== null,
                    decksDir: files === null ? null : files.filePath("decks"),
                  });
                }

                if (path.startsWith("/export")) {
                  pruneExports();
                  if (path === "/export" && method === "POST") {
                    if (!req.bytes || req.bytes.length === 0) return json({ error: "empty" }, 400);
                    const name =
                      String(req.query.name ?? "deck.bento.html")
                        .split(/[\\/]/)
                        .pop()!
                        .replace(/[^\w.\- 一-鿿]/g, "_")
                        .slice(0, 120) || "deck.bento.html";
                    const token = crypto.randomUUID();
                    exports.set(token, {
                      name,
                      type: name.endsWith(".pptx")
                        ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                        : "text/html; charset=utf-8",
                      bytes: req.bytes,
                      at: Date.now(),
                    });
                    pruneExports();
                    return json({ href: `export/${token}` });
                  }
                  const item =
                    method === "GET" ? exports.get(path.slice("/export/".length)) : undefined;
                  if (item === undefined) return json({ error: "not found or expired" }, 404);
                  return {
                    headers: {
                      "content-type": item.type,
                      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
                      "cache-control": "no-store",
                    },
                    bytes: item.bytes,
                  };
                }

                if (files === null) {
                  return json(
                    {
                      error: "unsupported",
                      message: "This server does not offer workbench files; update PenguinHarness.",
                    },
                    501,
                  );
                }

                if (path === "/decks" && method === "GET") {
                  const decks = [];
                  for (const file of await deckFiles()) {
                    const { title, slides } = await summarize(file, file.id);
                    decks.push({
                      id: file.id,
                      title,
                      slides,
                      mtimeMs: file.mtimeMs,
                      size: file.size,
                    });
                  }
                  decks.sort((a, b) => b.mtimeMs - a.mtimeMs);
                  return json({ decks });
                }

                if (path === "/decks" && method === "POST") {
                  const text = typeof body.text === "string" ? body.text : "";
                  if (text === "") return json({ error: "text is required" }, 400);
                  const wanted = typeof body.id === "string" ? body.id : "";
                  const taken = new Set((await deckFiles()).map((file) => file.id));
                  let id = DECK_ID.test(wanted) ? wanted : slug(wanted);
                  for (let n = 2; taken.has(id); n++) id = `${slug(wanted).slice(0, 44)}-${n}`;
                  await files.writeFile(deckPath(id), text);
                  const rev = await revisionOf(text);
                  written.set(id, { rev, text });
                  return json({ id, rev }, 201);
                }

                const past = /^\/decks\/([^/]+)\/history(?:\/([^/]+))?$/.exec(path);
                if (past !== null && method === "GET") {
                  const [, id = "", name] = past;
                  if (!DECK_ID.test(id)) return json({ error: "no such deck" }, 404);
                  if (name === undefined) return json({ versions: await versionsOf(id) });
                  const text = VERSION_NAME.test(name)
                    ? await readText(`history/${id}/${name}.bento.json`)
                    : null;
                  if (text === null) return json({ error: "no such version" }, 404);
                  return json({ name, text });
                }

                const deck = /^\/decks\/([^/]+)$/.exec(path)?.[1];
                if (deck !== undefined) {
                  if (!DECK_ID.test(deck)) return json({ error: "no such deck" }, 404);
                  if (method === "GET") {
                    const text = await readText(deckPath(deck));
                    if (text === null) return json({ error: "no such deck" }, 404);
                    return json({ id: deck, rev: await revisionOf(text), text });
                  }
                  if (method === "PUT") {
                    const text = typeof body.text === "string" ? body.text : "";
                    if (text === "") return json({ error: "text is required" }, 400);
                    return locked(deck, async () => {
                      const current = await readText(deckPath(deck));
                      if (current === null) return json({ error: "no such deck" }, 404);
                      const rev = await revisionOf(current);
                      if (rev !== body.base) return json({ rev, text: current }, 409);
                      const next = await revisionOf(text);
                      if (next === rev) return json({ rev });
                      // A version the Agent wrote is kept before the editor's replaces it.
                      if (written.get(deck)?.rev !== rev) await keep(deck, current, "agent");
                      await files.writeFile(deckPath(deck), text);
                      written.set(deck, { rev: next, text });
                      // The stream is about what others wrote: this write is not news to the page.
                      if (seen !== null) seen = await stamps().catch(() => seen);
                      return json({ rev: next });
                    });
                  }
                  if (method === "DELETE") {
                    await locked(deck, async () => {
                      await files.removeFile(deckPath(deck));
                      for (const version of await versionsOf(deck)) {
                        await files.removeFile(`history/${deck}/${version.name}.bento.json`);
                      }
                    });
                    written.delete(deck);
                    await setSession(deck, null);
                    return json({ ok: true });
                  }
                }

                if (path === "/events" && method === "GET") {
                  const queue: string[] = [": open\n\n"];
                  let wake: (() => void) | null = null;
                  const stop = listen((chunk) => {
                    queue.push(chunk);
                    wake?.();
                  });
                  const beat = setInterval(() => {
                    queue.push(": beat\n\n");
                    wake?.();
                  }, HEARTBEAT_MS);
                  const stream = (async function* () {
                    try {
                      for (;;) {
                        while (queue.length > 0) yield queue.shift()!;
                        await new Promise<void>((resolve) => (wake = resolve));
                        wake = null;
                      }
                    } finally {
                      clearInterval(beat);
                      stop();
                    }
                  })();
                  return {
                    headers: {
                      "content-type": "text/event-stream; charset=utf-8",
                      "cache-control": "no-store",
                      "x-accel-buffering": "no",
                    },
                    stream,
                  };
                }

                if (path === "/ask" && method === "GET") {
                  const id = String(req.query.deck ?? "");
                  const sessionId = sessions()[id] ?? null;
                  const status = sessionId === null ? null : statusOf(sessionId);
                  // The answer of a request that has ended is taken up here, once: the page
                  // asks when its stream says the task ended, and again when it loads.
                  const messages = talkOf(id);
                  if (sessionId !== null && status === "idle" && messages.at(-1)?.role === "user") {
                    const after = { sessionId, at: messages.at(-1)!.at };
                    const result = await host.sessionResult(sessionId);
                    if (result.status === "completed")
                      await say(id, "assistant", result.text, after);
                    else if (result.status === "failed") {
                      await say(
                        id,
                        "error",
                        result.error ?? "The Agent stopped without an answer.",
                        after,
                      );
                    }
                  }
                  return json({
                    sessionId: status === null ? null : sessionId,
                    status,
                    messages: talkOf(id),
                  });
                }

                if (path === "/ask/reset" && method === "POST") {
                  await setSession(String(body.deck ?? ""), null);
                  return json({ ok: true });
                }

                if (path === "/ask" && method === "POST") {
                  const id = String(body.deck ?? "");
                  const text = typeof body.text === "string" ? body.text.trim() : "";
                  if (!DECK_ID.test(id) || text === "") {
                    return json({ error: "deck and text are required" }, 400);
                  }
                  if (text.length > 20_000) return json({ error: "text is too long" }, 400);
                  let sessionId: string | null = sessions()[id] ?? null;
                  if (sessionId !== null && statusOf(sessionId) === null) sessionId = null;
                  if (sessionId === null) {
                    sessionId = (await host.createSession()).sessionId;
                    await setSession(id, sessionId);
                  }
                  const slide = (body.slide ?? null) as { id?: unknown; number?: unknown } | null;
                  const selection = Array.isArray(body.selection)
                    ? body.selection.filter((s): s is string => typeof s === "string").slice(0, 40)
                    : [];
                  const where =
                    slide !== null && typeof slide.id === "string"
                      ? `They are looking at slide ${Number(slide.number) || "?"} (id ${JSON.stringify(slide.id)})` +
                        (selection.length > 0
                          ? `, with these elements selected: ${selection.map((s) => JSON.stringify(s)).join(", ")}.`
                          : ".")
                      : "";
                  const prompt = [
                    "The user has a Bento slide deck open in the Slides workbench. They see every change you save, live, and they keep editing the same deck while you work.",
                    `Deck file: ${files.filePath(deckPath(id))}`,
                    where,
                    `Their request: ${text}`,
                    "Use the bento-slides skill. Change the deck by editing that JSON file, then answer in one or two sentences with what you changed.",
                  ]
                    .filter((line) => line !== "")
                    .join("\n");
                  await say(id, "user", text);
                  const at = talkOf(id).at(-1)!.at;
                  try {
                    const run = await host.run(sessionId, [{ text: prompt }]);
                    return json({ sessionId, queued: run.queued });
                  } catch (err) {
                    const error = err instanceof Error ? err.message : String(err);
                    await say(id, "error", error, { sessionId, at });
                    return json({ error }, 503);
                  }
                }

                return json({ error: `no such route: ${method} ${path}` }, 404);
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
