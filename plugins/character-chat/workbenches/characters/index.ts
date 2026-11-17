import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";
import {
  MEMORY_LIMIT,
  afterExchange,
  isCharacterId,
  levelOf,
  memoryItems,
  memoryLine,
  newBond,
  openingMessage,
  parseCard,
  parseReply,
  turnMessage,
} from "./stage.js";
import type { Bond, CardMeta, Mood } from "./stage.js";
import { STARTERS, TEMPLATE } from "./starters.js";

// The browser matches these original looks even when a card has been renamed or imported.
const illustratedLooks = Object.entries(STARTERS).flatMap(([id, text]) => {
  const card = parseCard(text, id);
  return "meta" in card ? [{ id, kind: card.meta.kind, look: card.meta.look }] : [];
});

type Line = { role: "user" | "character" | "note"; text: string; at: string; mood?: Mood };
type Character = {
  sessionId: string | null;
  /** The Session has had its opening message (the card and the memory). */
  opened: boolean;
  running: boolean;
  bond: Bond;
  mood: Mood;
  scene: string | null;
  lastTalkAt: string | null;
  lines: Line[];
  choices: string[];
  /** Memories the person removed since the character last heard from them. */
  forget: string[];
  error: string | null;
};
type Compose = {
  sessionId: string;
  id: string;
  idea: string;
  status: "running" | "done" | "failed";
  error: string | null;
};
type State = {
  settings: { lang: "zh" | "en" | null; userName: string; readAloud: boolean };
  characters: Record<string, Character>;
  compose: Compose | null;
};

/** The abort codes of a person interrupting a reply; the turn cap's `max_turns` is not one. */
const STOP_CODES: ReadonlySet<unknown> = new Set([
  "user_abort",
  "backoff_interrupted",
  "compaction_interrupted",
]);

const KEPT_LINES = 80;
const MAX_TEXT = 4000;
const MAX_CARD = 24_000;
const IDLE_CHECK_MS = 50;
const IDLE_CHECKS = 40;
const NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;
/** How often the characters' files are listed while a page listens, and the stream's heartbeat. */
const WATCH_MS = 700;
const HEARTBEAT_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const decode = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : "");
const cardPath = (id: string) => `characters/${id}/card.md`;
const memoryPath = (id: string) => `characters/${id}/memory.md`;
const newCharacter = (): Character => ({
  sessionId: null,
  opened: false,
  running: false,
  bond: newBond(),
  mood: "neutral",
  scene: null,
  lastTalkAt: null,
  lines: [],
  choices: [],
  forget: [],
  error: null,
});

export default {
  modules: {
    Workbench: {
      create({ use, effect }) {
        const host = use.host;
        // A server from before workbench files has no such members: the page says it needs a newer one.
        const files = typeof host.listFiles === "function" ? host : null;

        let pending: Promise<unknown> = Promise.resolve();
        const locked = <T>(fn: () => Promise<T>): Promise<T> => {
          const result = pending.then(fn);
          pending = result.catch(() => undefined);
          return result;
        };
        const read = (): State => {
          const state = host.getState() as Partial<State> | null;
          return {
            settings: { lang: null, userName: "", readAloud: false, ...(state?.settings ?? {}) },
            characters: structuredClone(state?.characters ?? {}),
            compose: state?.compose ? { ...state.compose } : null,
          };
        };
        const save = (state: State) => host.setState(state);

        // The starters are cards like any other: copied in once, then the copy is the character.
        let seeded: Promise<void> | null = null;
        const seed = () =>
          (seeded ??= (async () => {
            if (!files) return;
            const have = new Set((await files.listFiles()).map((f) => f.path));
            for (const [id, card] of Object.entries(STARTERS))
              if (!have.has(cardPath(id))) await files.writeFile(cardPath(id), card);
          })());

        const cards = async (): Promise<
          Map<string, { text: string; meta: CardMeta | null; error: string | null }>
        > => {
          const out = new Map<
            string,
            { text: string; meta: CardMeta | null; error: string | null }
          >();
          if (!files) return out;
          for (const file of await files.listFiles()) {
            const match = /^characters\/([^/]+)\/card\.md$/.exec(file.path);
            if (!match || !isCharacterId(match[1]!)) continue;
            const text = decode(await files.readFile(file.path));
            const parsed = parseCard(text, match[1]!);
            out.set(
              match[1]!,
              "error" in parsed
                ? { text, meta: null, error: parsed.error }
                : { text, meta: parsed.meta, error: null },
            );
          }
          return out;
        };

        const following = new Map<string, () => void>();
        /** Sessions whose current reply a person stopped, until that reply is reconciled. */
        const stopped = new Set<string>();
        const unfollow = (sessionId: string) => {
          following.get(sessionId)?.();
          following.delete(sessionId);
        };
        const idle = (sessionId: string) => {
          try {
            return host.sessionStatus(sessionId) === "idle";
          } catch {
            return true;
          }
        };

        /** Takes a finished turn into the character's state; false while it still runs. */
        const reconcile = async (id: string, character: Character): Promise<boolean> => {
          if (!character.sessionId) return true;
          const at = new Date().toISOString();
          try {
            const result = await host.sessionResult(character.sessionId);
            if (result.status === "running") return false;
            character.running = false;
            if (result.status === "failed") {
              // A person's stop is not a failure: their line stays and nothing is said.
              character.error = stopped.has(character.sessionId)
                ? null
                : (result.error ?? "The reply did not arrive.");
            } else {
              const reply = parseReply(result.text);
              const before = levelOf(character.bond.points);
              const day = character.lastTalkAt?.slice(0, 10) ?? at.slice(0, 10);
              character.bond = afterExchange(character.bond, day, reply.bond);
              character.mood = reply.mood ?? "neutral";
              if (reply.scene) character.scene = reply.scene;
              character.choices = reply.choices;
              character.error = null;
              character.lines.push({
                role: "character",
                text: reply.text,
                at,
                mood: character.mood,
              });
              if (levelOf(character.bond.points) > before)
                character.lines.push({
                  role: "note",
                  text: `level:${levelOf(character.bond.points)}`,
                  at,
                });
              if (files && reply.remember.length > 0) {
                const kept = memoryItems(decode(await files.readFile(memoryPath(id))));
                for (const fact of reply.remember) kept.push(memoryLine(day, fact).slice(2));
                await files.writeFile(
                  memoryPath(id),
                  kept
                    .slice(-MEMORY_LIMIT)
                    .map((item) => `- ${item}`)
                    .join("\n") + "\n",
                );
              }
            }
          } catch (e) {
            character.running = false;
            character.error = e instanceof Error ? e.message : String(e);
          }
          character.lines = character.lines.slice(-KEPT_LINES);
          stopped.delete(character.sessionId);
          unfollow(character.sessionId);
          return true;
        };
        const settle = async (sessionId: string) => {
          for (let i = 0; i < IDLE_CHECKS && !idle(sessionId); i++) await sleep(IDLE_CHECK_MS);
          await locked(async () => {
            const state = read();
            const entry = Object.entries(state.characters).find(
              ([, c]) => c.sessionId === sessionId && c.running,
            );
            if (!entry) unfollow(sessionId);
            else if (await reconcile(entry[0], entry[1])) await save(state);
          });
        };
        const follow = (sessionId: string) => {
          if (following.has(sessionId)) return;
          try {
            const stop = host.subscribe(sessionId, (record) => {
              // Only the stage Session's own records decide; a subagent's carry `origin`.
              if (record.origin?.length) return;
              const { type, error_code } = record.payload;
              if (type === "abort" && STOP_CODES.has(error_code)) stopped.add(sessionId);
              if (type !== "task_end") return;
              settle(sessionId).catch((e) =>
                host.log(`Could not save the reply of ${sessionId}: ${String(e)}`),
              );
            });
            following.set(sessionId, stop);
          } catch {
            // The Session is gone: the next read reports it on the character.
          }
        };
        for (const character of Object.values(read().characters))
          if (character.running && character.sessionId) follow(character.sessionId);

        // A stage Session only talks: every tool call in it is denied, so neither a line nor a
        // card can run anything. The opening message says so too, so the model does not try.
        const openSession = async () =>
          (await host.createSession({ approvalMode: "deny-all" })).sessionId;

        // ---- telling open pages that a character's files changed (the Agent writes them too) ----
        type Listener = (chunk: string) => void;
        const listeners = new Set<Listener>();
        let watching: ReturnType<typeof setInterval> | null = null;
        let seen: Map<string, string> | null = null;
        const stamps = async () => {
          const out = new Map<string, string>();
          for (const file of (await files?.listFiles()) ?? []) {
            const match = /^characters\/([^/]+)\/(card|memory)\.md$/.exec(file.path);
            if (!match) continue;
            out.set(
              match[1]!,
              `${out.get(match[1]!) ?? ""}${match[2]}:${file.mtimeMs}:${file.size};`,
            );
          }
          return out;
        };
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
          const data = JSON.stringify({ changed, removed });
          for (const send of listeners) send(`event: characters\ndata: ${data}\n\n`);
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
        const events = (): WorkbenchResponse => {
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
        };

        const summary = (
          id: string,
          card: { meta: CardMeta | null; error: string | null },
          c: Character,
        ) => ({
          id,
          meta: card.meta,
          error: card.error,
          starter: Object.hasOwn(STARTERS, id),
          bond: {
            points: c.bond.points,
            days: c.bond.days,
            level: levelOf(c.bond.points),
          },
          mood: c.mood,
          scene: c.scene ?? card.meta?.scene ?? "plain",
          lastTalkAt: c.lastTalkAt,
          running: c.running,
          sessionId: c.sessionId,
        });

        const json = (status: number, body: unknown): WorkbenchResponse => ({ status, body });

        return {
          api: {
            main: {
              async handle(req): Promise<WorkbenchResponse> {
                return locked(async () => {
                  await seed();
                  const state = read();
                  const body = (req.body ?? {}) as Record<string, unknown>;
                  const text = typeof body.text === "string" ? body.text.trim() : "";

                  if (req.path === "/info" && req.method === "GET")
                    return {
                      body: {
                        supported: files !== null,
                        illustratedLooks,
                        settings: state.settings,
                        filesDir: files ? files.filePath("characters") : null,
                      },
                    };
                  if (req.path === "/settings" && req.method === "PUT") {
                    if (body.lang === "zh" || body.lang === "en") state.settings.lang = body.lang;
                    if (typeof body.userName === "string")
                      state.settings.userName = body.userName.trim().slice(0, 40);
                    if (typeof body.readAloud === "boolean")
                      state.settings.readAloud = body.readAloud;
                    await save(state);
                    return { body: { settings: state.settings } };
                  }
                  if (!files) return json(409, { error: "This server has no workbench files." });
                  if (req.path === "/events" && req.method === "GET") return events();

                  const all = await cards();
                  if (req.path === "/characters" && req.method === "GET") {
                    let changed = false;
                    for (const [id, c] of Object.entries(state.characters))
                      if (c.running && (await reconcile(id, c))) changed = true;
                    if (state.compose?.status === "running") {
                      const result = await host
                        .sessionResult(state.compose.sessionId)
                        .catch(() => null);
                      if (result && result.status !== "running") {
                        state.compose.status = all.has(state.compose.id) ? "done" : "failed";
                        state.compose.error = result.error;
                        changed = true;
                      }
                    }
                    if (changed) await save(state);
                    return {
                      body: {
                        characters: [...all].map(([id, card]) =>
                          summary(id, card, state.characters[id] ?? newCharacter()),
                        ),
                        compose: state.compose,
                      },
                    };
                  }
                  if (req.path === "/characters" && req.method === "POST") {
                    const card = typeof body.card === "string" ? body.card : TEMPLATE;
                    if (card.length > MAX_CARD)
                      return json(400, { error: "The card is too long." });
                    let id = typeof body.id === "string" ? body.id : "";
                    if (!isCharacterId(id) || all.has(id)) {
                      let n = all.size + 1;
                      while (all.has(`character-${n}`)) n++;
                      id = `character-${n}`;
                    }
                    const parsed = parseCard(card, id);
                    if ("error" in parsed) return json(400, { error: parsed.error });
                    await files.writeFile(cardPath(id), card);
                    return json(201, { id });
                  }
                  if (req.path === "/compose" && req.method === "POST") {
                    if (!text) return json(400, { error: "Say who the character is." });
                    if (text.length > MAX_TEXT)
                      return json(400, { error: "Please keep it shorter." });
                    let n = all.size + 1;
                    while (all.has(`character-${n}`)) n++;
                    const id = `character-${n}`;
                    const { sessionId } = await host.createSession();
                    state.compose = { sessionId, id, idea: text, status: "running", error: null };
                    await save(state);
                    await host.run(sessionId, [
                      {
                        text: [
                          "The user wants a new character for the Characters workbench.",
                          "Use the character-chat skill: read its SKILL.md and references/card-format.md first.",
                          `Write the card to: ${files.filePath(cardPath(id))}`,
                          `Their idea: ${text}`,
                          "Answer in one sentence with the character's name once the file is written.",
                        ].join("\n"),
                      },
                    ]);
                    return json(202, { compose: state.compose });
                  }

                  const match = /^\/characters\/([^/]+)(\/[a-z]+)?$/.exec(req.path);
                  const id = match?.[1] ?? "";
                  const card = all.get(id);
                  if (!match || !card) return json(404, { error: "No such character." });
                  const action = match[2] ?? "";
                  const character = (state.characters[id] ??= newCharacter());

                  if (action === "/card" && req.method === "GET") {
                    // The card as a file to keep or share; importing it back is POST /characters.
                    return {
                      headers: {
                        "content-type": "text/markdown; charset=utf-8",
                        "content-disposition": `attachment; filename="${id}.card.md"`,
                        "cache-control": "no-store",
                      },
                      body: card.text,
                    };
                  }
                  if (action === "" && req.method === "GET") {
                    if (character.running && (await reconcile(id, character))) await save(state);
                    return {
                      body: {
                        ...summary(id, card, character),
                        card: card.text,
                        lines: character.lines,
                        choices: character.choices,
                        memory: memoryItems(decode(await files.readFile(memoryPath(id)))),
                        failure: character.error,
                      },
                    };
                  }
                  if (action === "" && req.method === "PUT") {
                    const next = typeof body.card === "string" ? body.card : "";
                    if (!next || next.length > MAX_CARD)
                      return json(400, { error: "The card is empty or too long." });
                    const parsed = parseCard(next, id);
                    if ("error" in parsed) return json(400, { error: parsed.error });
                    await files.writeFile(cardPath(id), next);
                    // A changed card is a changed character: the next line opens a Session on it.
                    character.sessionId = null;
                    character.opened = false;
                    await save(state);
                    return { body: { id, meta: parsed.meta } };
                  }
                  if (action === "" && req.method === "DELETE") {
                    if (character.running) return json(409, { error: "Wait for the reply first." });
                    await files.removeFile(cardPath(id));
                    await files.removeFile(memoryPath(id));
                    delete state.characters[id];
                    await save(state);
                    return { body: { removed: id } };
                  }
                  if (req.method !== "POST") return json(405, { error: "Not supported." });

                  if (action === "/say") {
                    if (!card.meta)
                      return json(409, { error: card.error ?? "The card cannot be read." });
                    if (!text) return json(400, { error: "Say something first." });
                    if (text.length > MAX_TEXT)
                      return json(400, { error: "Please keep it under 4,000 characters." });
                    if (character.running) return json(409, { error: "Still answering." });
                    const now =
                      typeof body.now === "string" && NOW.test(body.now)
                        ? body.now
                        : new Date().toISOString();
                    const scene = character.scene ?? card.meta.scene;
                    if (!character.sessionId) {
                      character.sessionId = await openSession();
                      character.opened = false;
                    }
                    const message = character.opened
                      ? turnMessage({
                          meta: card.meta,
                          bond: character.bond,
                          scene,
                          now,
                          forget: character.forget,
                          text,
                        })
                      : openingMessage({
                          card: card.text,
                          meta: card.meta,
                          memory: decode(await files.readFile(memoryPath(id))),
                          bond: character.bond,
                          scene,
                          userName: state.settings.userName,
                          language:
                            body.lang === "zh" || body.lang === "en"
                              ? body.lang
                              : (state.settings.lang ?? "en"),
                          now,
                          lastTalkAt: character.lastTalkAt,
                          text,
                        });
                    character.lines.push({ role: "user", text, at: now });
                    character.choices = [];
                    character.forget = [];
                    character.error = null;
                    character.running = true;
                    character.lastTalkAt = now;
                    await save(state);
                    follow(character.sessionId);
                    try {
                      await host.run(character.sessionId, [{ text: message }]);
                      character.opened = true;
                    } catch (e) {
                      unfollow(character.sessionId);
                      character.running = false;
                      character.sessionId = null;
                      character.error = e instanceof Error ? e.message : String(e);
                    }
                    await save(state);
                    return character.error
                      ? json(502, { error: character.error })
                      : { body: { sessionId: character.sessionId } };
                  }
                  if (action === "/chapter") {
                    // A new chapter: a fresh Session that reads the card and the memory again.
                    if (character.running) return json(409, { error: "Wait for the reply first." });
                    character.sessionId = null;
                    character.opened = false;
                    character.choices = [];
                    character.lines.push({
                      role: "note",
                      text: "chapter",
                      at: new Date().toISOString(),
                    });
                    await save(state);
                    return { body: { ok: true } };
                  }
                  if (action === "/forget") {
                    const kept = memoryItems(decode(await files.readFile(memoryPath(id))));
                    const index = typeof body.index === "number" ? body.index : -1;
                    const gone =
                      body.all === true ? kept.splice(0) : kept.splice(index, index >= 0 ? 1 : 0);
                    if (kept.length > 0)
                      await files.writeFile(
                        memoryPath(id),
                        kept.map((item) => `- ${item}`).join("\n") + "\n",
                      );
                    else await files.removeFile(memoryPath(id));
                    if (character.opened)
                      character.forget.push(...gone.map((item) => item.replace(/^\S+ · /, "")));
                    await save(state);
                    return { body: { memory: kept } };
                  }
                  if (action === "/restore" && Object.hasOwn(STARTERS, id)) {
                    await files.writeFile(cardPath(id), STARTERS[id]!);
                    character.sessionId = null;
                    character.opened = false;
                    await save(state);
                    return { body: { ok: true } };
                  }
                  return json(404, { error: "Not found." });
                });
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
