/**
 * The Characters workbench, as a person meets it, against a host that keeps the shared files
 * and the Sessions in memory (the one boundary the handler has).
 *
 * - Given a reply that opens with a stage line and carries a memory and choices, then the person
 *   reads only the words, the face is the reply's mood, the memory is kept and the choices offered.
 * - Given a reply with no stage line, then all of it is words and the face is calm.
 * - Given a reply still arriving, then a directive is never shown, not even half of one, and the
 *   mood is known as soon as its line is whole.
 * - Given many lines on one day, then the friendship moves by a day's worth at most; given the
 *   same lines over several days, it moves further.
 * - Given a first line to a character, then its Session is opened with the card and the memory;
 *   given a second, then only the stage's state and the line are sent.
 * - Given a reply that remembers something, then the memory book holds it and the next chapter's
 *   Session is opened with it.
 * - Given the person removes a memory, then the book no longer holds it and the character is
 *   told on the next line.
 * - Given a card whose header cannot be read, then saving it is refused and the old card stays.
 * - Given a stage Session, then it is opened with every tool call denied (it only talks), and
 *   the opening message says it has no tools.
 * - Given cards the Agent wrote into the folder, then the roster lists them, and one whose header
 *   cannot be read is listed with the reason.
 * - Given the friendship reaches a level, then that is noted once, not on every later reply.
 * - Given the person stops a reply, then their line stays, nothing is said and no failure shows.
 * - Given a saved card, then the next line opens a new Session on the new card.
 * - Given a full memory book, then the newest fact goes in and the oldest goes out.
 * - Given a card downloaded as a file and imported back, then it is the same character.
 */
import { describe, expect, it } from "vitest";
import workbench from "../workbenches/characters/index.ts";
import { afterExchange, levelOf, newBond, parseReply } from "../workbenches/characters/stage.ts";
// @ts-expect-error a plain-JS page module
import { draftOf } from "../workbenches/characters/ui/directives.js";

const FOLDER = "/data/agent_state/workbenches/characters/.files";

type StageRecord = { payload: { type: string; [key: string]: unknown }; origin?: string[] };

function fakeHost() {
  const files = new Map<string, string>();
  const runs: { sessionId: string; text: string }[] = [];
  const answers = new Map<
    string,
    { status: "completed" | "failed"; text: string; error: string | null }
  >();
  const listeners = new Map<string, (record: StageRecord) => void>();
  const opened: { sessionId: string; approvalMode: string }[] = [];
  let state: unknown = null;
  let sessions = 0;
  const host = {
    listAgents: () => [{ agentId: "default_agent" }],
    async createSession(opts?: { approvalMode?: string }) {
      const sessionId = `session-${++sessions}`;
      opened.push({ sessionId, approvalMode: opts?.approvalMode ?? "allow-all" });
      return { sessionId };
    },
    async run(sessionId: string, input: { text: string }[]) {
      runs.push({ sessionId, text: input[0]!.text });
      return { sessionId, queued: false };
    },
    sessionStatus: () => "idle",
    sessionTitle: () => null,
    async sessionResult(sessionId: string) {
      return answers.get(sessionId) ?? { status: "running" as const, text: "", error: null };
    },
    subscribe(sessionId: string, listener: (record: StageRecord) => void) {
      listeners.set(sessionId, listener);
      return () => listeners.delete(sessionId);
    },
    async listFiles() {
      return [...files.keys()]
        .sort()
        .map((path) => ({ path, size: files.get(path)!.length, mtimeMs: 1 }));
    },
    async readFile(path: string) {
      return files.has(path) ? new TextEncoder().encode(files.get(path)!) : null;
    },
    async writeFile(path: string, data: Uint8Array | string) {
      files.set(path, typeof data === "string" ? data : new TextDecoder().decode(data));
      return { path, size: 0, mtimeMs: 1 };
    },
    async removeFile(path: string) {
      files.delete(path);
    },
    filePath: (path?: string) => (path === undefined ? FOLDER : `${FOLDER}/${path}`),
    getState: () => state,
    async setState(next: unknown) {
      state = next;
    },
    log() {},
  };
  const main = workbench.modules.Workbench.create({ use: { host }, effect() {} } as never).api.main;
  const call = async (method: string, path: string, body: unknown = null) => {
    const res = await main.handle({ method, path, query: {}, headers: {}, body });
    return { status: res.status ?? 200, body: res.body as Record<string, any> };
  };
  /** The model finishes the turn of `sessionId` with `text`. */
  const answer = (sessionId: string, text: string) =>
    answers.set(sessionId, { status: "completed", text, error: null });
  /** The person presses Stop: the Session records the abort and ends the task. */
  const stop = (sessionId: string) => {
    answers.set(sessionId, { status: "failed", text: "", error: "Task aborted by user" });
    listeners.get(sessionId)?.({ payload: { type: "abort", error_code: "user_abort" } });
    listeners.get(sessionId)?.({ payload: { type: "task_end" } });
  };
  return { call, answer, stop, runs, files, opened };
}

/** One exchange: the person's line, then the reply, then the stage as the page reads it. */
async function exchange(
  t: ReturnType<typeof fakeHost>,
  id: string,
  text: string,
  reply: string,
  now: string,
) {
  const said = await t.call("POST", `/characters/${id}/say`, { text, now });
  expect(said.status).toBe(200);
  t.answer(said.body.sessionId, reply);
  return (await t.call("GET", `/characters/${id}`)).body;
}

describe("a reply on the stage", () => {
  it("shows the person the words and gives the stage the mood, the memory and the choices", () => {
    const reply = parseReply(
      '<stage mood="laugh" bond="2"/>\nOh! That is big news.\n<remember>The person passed their driving test.</remember>\n<choices>Very nervous|Not at all</choices>',
    );
    expect(reply.text).toBe("Oh! That is big news.");
    expect(reply.mood).toBe("laugh");
    expect(reply.bond).toBe(2);
    expect(reply.remember).toEqual(["The person passed their driving test."]);
    expect(reply.choices).toEqual(["Very nervous", "Not at all"]);
  });

  it("is all words, with no mood, when it carries no stage line", () => {
    const reply = parseReply("Just words.");
    expect(reply).toMatchObject({
      text: "Just words.",
      mood: null,
      bond: 0,
      remember: [],
      choices: [],
    });
  });

  it("never shows a directive while it is still arriving", () => {
    const whole =
      '<stage mood="shy"/>\nReally?\n<remember>A promise.</remember>\n<choices>Yes|No</choices>';
    for (let end = 1; end <= whole.length; end++) {
      const { text } = draftOf(whole.slice(0, end));
      expect(text).not.toMatch(/[<>]|stage|remember|choices|promise/i);
    }
    expect(draftOf('<stage mood="shy"/>\nRe')).toEqual({ text: "Re", mood: "shy" });
    expect(draftOf(whole)).toEqual({ text: "Really?", mood: "shy" });
  });
});

describe("the friendship meter", () => {
  it("moves by a day's worth at most in one day, and further over several days", () => {
    let oneDay = newBond();
    for (let i = 0; i < 40; i++) oneDay = afterExchange(oneDay, "2026-11-17", 2);
    let fiveDays = newBond();
    for (let day = 17; day <= 21; day++)
      for (let i = 0; i < 8; i++) fiveDays = afterExchange(fiveDays, `2026-11-${day}`, 2);
    expect(levelOf(oneDay.points)).toBe(2);
    expect(oneDay.days).toBe(1);
    expect(fiveDays.days).toBe(5);
    expect(levelOf(fiveDays.points)).toBe(3);
    expect(fiveDays.points).toBeGreaterThan(oneDay.points * 4);
  });
});

describe("talking to a character", () => {
  it("opens the Session with the card and the memory, then sends only the stage and the line", async () => {
    const t = fakeHost();
    await t.call("GET", "/characters");
    const first = await t.call("POST", "/characters/pip/say", {
      text: "Hello Pip",
      now: "2026-11-17T09:30:00+08:00",
    });
    expect(first.status).toBe(200);
    expect(t.runs[0]!.text).toContain("=== character card ===");
    expect(t.runs[0]!.text).toContain("post office at the edge of the map");
    expect(t.runs[0]!.text).toContain("The person says: Hello Pip");
    t.answer(first.body.sessionId, '<stage mood="happy" bond="1"/>\nOh! A visitor!');
    const shown = await t.call("GET", "/characters/pip");
    expect(shown.body.lines.at(-1)).toMatchObject({
      role: "character",
      text: "Oh! A visitor!",
      mood: "happy",
    });
    expect(shown.body.mood).toBe("happy");

    await t.call("POST", "/characters/pip/say", {
      text: "I like stamps",
      now: "2026-11-17T09:31:00+08:00",
    });
    expect(t.runs[1]!.sessionId).toBe(first.body.sessionId);
    expect(t.runs[1]!.text).not.toContain("=== character card ===");
    expect(t.runs[1]!.text).toContain("The person says: I like stamps");
  });

  it("keeps what a reply remembers, and opens the next chapter with it", async () => {
    const t = fakeHost();
    await t.call("GET", "/characters");
    const said = await t.call("POST", "/characters/pip/say", {
      text: "My cat is called Mochi",
      now: "2026-11-17T09:30:00+08:00",
    });
    t.answer(
      said.body.sessionId,
      '<stage mood="happy"/>\nMochi!\n<remember>The person has a cat called Mochi.</remember>',
    );
    const shown = await t.call("GET", "/characters/pip");
    expect(shown.body.memory).toEqual(["2026-11-17 · The person has a cat called Mochi."]);

    await t.call("POST", "/characters/pip/chapter");
    await t.call("POST", "/characters/pip/say", {
      text: "Hello again",
      now: "2026-11-18T09:30:00+08:00",
    });
    expect(t.runs[1]!.sessionId).not.toBe(said.body.sessionId);
    expect(t.runs[1]!.text).toContain("The person has a cat called Mochi.");
  });

  it("forgets a memory the person removes and tells the character on the next line", async () => {
    const t = fakeHost();
    await t.call("GET", "/characters");
    const said = await t.call("POST", "/characters/pip/say", {
      text: "My cat is called Mochi",
      now: "2026-11-17T09:30:00+08:00",
    });
    t.answer(
      said.body.sessionId,
      '<stage mood="happy"/>\nMochi!\n<remember>The person has a cat called Mochi.</remember>',
    );
    await t.call("GET", "/characters/pip");
    const after = await t.call("POST", "/characters/pip/forget", { index: 0 });
    expect(after.body.memory).toEqual([]);
    expect(t.files.has("characters/pip/memory.md")).toBe(false);
    await t.call("POST", "/characters/pip/say", {
      text: "Anyway",
      now: "2026-11-17T09:35:00+08:00",
    });
    expect(t.runs[1]!.text).toContain("no longer use it: The person has a cat called Mochi.");
  });

  it("refuses a card whose header cannot be read and keeps the old one", async () => {
    const t = fakeHost();
    await t.call("GET", "/characters");
    const before = t.files.get("characters/pip/card.md");
    const res = await t.call("PUT", "/characters/pip", { card: "no header here" });
    expect(res.status).toBe(400);
    expect(t.files.get("characters/pip/card.md")).toBe(before);
  });
});

describe("the stage Session", () => {
  it("is opened with every tool call denied, and its opening message says it has no tools", async () => {
    const t = fakeHost();
    await t.call("GET", "/characters");
    const said = await t.call("POST", "/characters/sunny/say", {
      text: "Hi!",
      now: "2026-11-17T09:30:00+08:00",
    });
    expect(t.opened).toEqual([{ sessionId: said.body.sessionId, approvalMode: "deny-all" }]);
    expect(t.runs[0]!.text).toContain("You have no tools here");
    expect(t.runs[0]!.text).toContain("weather station");
  });

  it("opens a new Session on the next line once the card is saved", async () => {
    const t = fakeHost();
    await t.call("GET", "/characters");
    await exchange(t, "pip", "Hello", '<stage mood="happy"/>\nOh!', "2026-11-17T09:30:00+08:00");
    const card = (await t.call("GET", "/characters/pip")).body.card as string;
    const saved = await t.call("PUT", "/characters/pip", {
      card: card.replace("collects small good news", "collects lost buttons"),
    });
    expect(saved.status).toBe(200);
    await t.call("POST", "/characters/pip/say", {
      text: "Again",
      now: "2026-11-17T09:40:00+08:00",
    });
    expect(t.runs[1]!.sessionId).not.toBe(t.runs[0]!.sessionId);
    expect(t.runs[1]!.text).toContain("collects lost buttons");
  });
});

describe("the roster", () => {
  it("lists a card the Agent wrote into the folder, and one it cannot read with the reason", async () => {
    const t = fakeHost();
    await t.call("GET", "/characters");
    t.files.set(
      "characters/keeper/card.md",
      '---\nname: Keeper\nname_zh: 守灯人\nkind: human\nlook: {"hairstyle":"short"}\nscene: rooftop\n---\n\n## Who\n\nA retired lighthouse keeper.\n',
    );
    t.files.set("characters/broken/card.md", "just some words, no header");
    const roster = (await t.call("GET", "/characters")).body.characters as {
      id: string;
      meta: { name: string; kind: string; scene: string } | null;
      error: string | null;
    }[];
    expect(roster.map((row) => row.id)).toEqual([
      "broken",
      "keeper",
      "pip",
      "steep",
      "sunny",
      "tock",
    ]);
    expect(roster.find((row) => row.id === "keeper")).toMatchObject({
      meta: { name: "Keeper", kind: "human", scene: "rooftop" },
      error: null,
    });
    expect(roster.find((row) => row.id === "broken")).toMatchObject({
      meta: null,
      error: expect.stringContaining("no header"),
    });
  });

  it("hands a card out as a file, and the file imported back is the same character", async () => {
    const t = fakeHost();
    await t.call("GET", "/characters");
    const res = await t.call("GET", "/characters/sunny/card");
    const imported = await t.call("POST", "/characters", { id: "sunny-copy", card: res.body });
    expect(imported).toMatchObject({ status: 201, body: { id: "sunny-copy" } });
    const copy = (await t.call("GET", "/characters/sunny-copy")).body;
    const original = (await t.call("GET", "/characters/sunny")).body;
    expect(copy.meta).toEqual({ ...original.meta, id: "sunny-copy" });
  });
});

describe("a conversation over time", () => {
  it("notes a friendship level once, when it is reached", async () => {
    const t = fakeHost();
    await t.call("GET", "/characters");
    const day = (n: number) => `2026-11-17T09:${String(30 + n).padStart(2, "0")}:00+08:00`;
    let shown: Record<string, any> = {};
    for (let n = 0; n < 5; n++)
      shown = await exchange(
        t,
        "tock",
        `Riddle ${n}`,
        '<stage mood="happy" bond="2"/>\nCorrect.',
        day(n),
      );
    const notes = (shown.lines as { role: string; text: string }[]).filter(
      (line) => line.role === "note",
    );
    expect(notes).toEqual([expect.objectContaining({ text: "level:2" })]);
    expect(shown.bond.level).toBe(2);
  });

  it("keeps the person's line and says nothing when they stop a reply", async () => {
    const t = fakeHost();
    await t.call("GET", "/characters");
    const said = await t.call("POST", "/characters/steep/say", {
      text: "Long story",
      now: "2026-11-17T21:00:00+08:00",
    });
    t.stop(said.body.sessionId);
    const shown = (await t.call("GET", "/characters/steep")).body;
    expect(shown.failure).toBeNull();
    expect(shown.running).toBe(false);
    expect(shown.lines).toEqual([expect.objectContaining({ role: "user", text: "Long story" })]);
    expect(shown.memory).toEqual([]);
  });

  it("lets the oldest memory go when the book is full", async () => {
    const t = fakeHost();
    await t.call("GET", "/characters");
    const full = Array.from({ length: 120 }, (_, i) => `- 2026-10-01 · Fact ${i + 1}.`).join("\n");
    t.files.set("characters/pip/memory.md", `${full}\n`);
    const shown = await exchange(
      t,
      "pip",
      "News!",
      '<stage mood="laugh"/>\nA keeper!\n<remember>The person got a new bike.</remember>',
      "2026-11-17T09:30:00+08:00",
    );
    expect(shown.memory).toHaveLength(120);
    expect(shown.memory[0]).toBe("2026-10-01 · Fact 2.");
    expect(shown.memory.at(-1)).toBe("2026-11-17 · The person got a new bike.");
  });
});
