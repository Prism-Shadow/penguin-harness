/**
 * The Slides workbench's handler, against a host that keeps the workbench's shared files in
 * memory (the one boundary the handler has):
 *
 * - Given a deck the Agent rewrote after the page last saved, a save made from the page's
 *   revision is refused with the file as it is now; a save made from that revision is taken, and
 *   the Agent's version it replaced goes to the deck's history.
 * - Given more than twenty replaced versions, the history keeps the newest twenty, each readable.
 * - Given a listening page, a deck file the Agent wrote is announced as changed and the page's
 *   version it replaced is kept; a file the Agent removed is announced as removed.
 * - Given requests on two decks, each deck gets one Session of its own, every request names the
 *   deck's file, the slide and the selection, and the answer joins the deck's conversation once
 *   the run has ended.
 * - Given a deck is deleted, its file, its history and its conversation go with it.
 * - Given a host without shared files, the handler says so instead of failing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import slides from "../workbenches/slides/index.ts";

const FOLDER = "/data/default_agent/agent_state/workbenches/slides/.files";

/** A deck file's text: a small Bento document. */
const deckText = (title: string) =>
  JSON.stringify({ format: "bento/slides", version: 1, title, slides: [] });

function fakeHost({ withFiles = true } = {}) {
  const files = new Map<string, { bytes: Uint8Array; mtimeMs: number }>();
  let clock = 1_000;
  const put = (path: string, text: string) => {
    const bytes = new TextEncoder().encode(text);
    files.set(path, { bytes, mtimeMs: ++clock });
    return { path, size: bytes.byteLength, mtimeMs: clock };
  };
  const status = new Map<string, string>();
  const runs: Array<{ sessionId: string; text: string }> = [];
  let state: unknown = null;
  const shared = {
    async listFiles() {
      return [...files.keys()].sort().map((path) => ({
        path,
        size: files.get(path)!.bytes.byteLength,
        mtimeMs: files.get(path)!.mtimeMs,
      }));
    },
    async readFile(path: string) {
      return files.get(path)?.bytes ?? null;
    },
    async writeFile(path: string, data: Uint8Array | string) {
      return put(path, typeof data === "string" ? data : new TextDecoder().decode(data));
    },
    async removeFile(path: string) {
      files.delete(path);
    },
    filePath: (path?: string) => (path === undefined ? FOLDER : `${FOLDER}/${path}`),
  };
  const host = {
    listAgents: () => [{ agentId: "default_agent" }],
    async createSession() {
      const sessionId = `session-${status.size + 1}`;
      status.set(sessionId, "idle");
      return { sessionId };
    },
    async run(sessionId: string, input: Array<{ text: string }>) {
      runs.push({ sessionId, text: input.map((item) => item.text).join("\n") });
      status.set(sessionId, "running");
      return { sessionId, queued: false };
    },
    sessionStatus(sessionId: string) {
      const now = status.get(sessionId);
      if (now === undefined) throw new Error("no such Session");
      return now;
    },
    sessionTitle: () => null,
    async sessionResult() {
      return { status: "completed", text: "The chart on slide 3 now shows Q1 to Q4.", error: null };
    },
    subscribe: () => () => undefined,
    getState: () => state,
    async setState(next: unknown) {
      state = next;
    },
    log: () => undefined,
    ...(withFiles ? shared : {}),
  };
  return {
    host,
    files,
    runs,
    status,
    /** What the Agent does with its own file tools: the file changes outside the handler. */
    agentWrites: (path: string, text: string) => void put(path, text),
    text: (path: string) => {
      const file = files.get(path);
      return file === undefined ? null : new TextDecoder().decode(file.bytes);
    },
  };
}

type Answer = { status: number; body: any; stream?: AsyncIterable<Uint8Array | string> };

function mount(host: unknown) {
  const disposers: Array<() => void> = [];
  const { api } = slides.modules.Workbench.create({
    use: { host } as never,
    effect: (dispose: () => void) => void disposers.push(dispose),
  });
  const call = async (
    method: string,
    path: string,
    body: unknown = null,
    query: Record<string, string> = {},
  ): Promise<Answer> => {
    const res = await api.main.handle({ method, path, query, headers: {}, body });
    return { status: res.status ?? 200, body: res.body, stream: res.stream };
  };
  return { call, dispose: () => disposers.forEach((dispose) => dispose()) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("saving a deck the Agent edits too", () => {
  it("refuses a save made from an old revision, answering the file as it is now", async () => {
    const { host, agentWrites, text } = fakeHost();
    const { call } = mount(host);
    const created = await call("POST", "/decks", { id: "q4", text: deckText("Q4") });
    expect(created.status).toBe(201);
    agentWrites("decks/q4.bento.json", deckText("Q4, as the Agent wrote it"));

    const stale = await call("PUT", "/decks/q4", {
      text: deckText("Q4, by hand"),
      base: created.body.rev,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.text).toBe(deckText("Q4, as the Agent wrote it"));
    expect(text("decks/q4.bento.json")).toBe(deckText("Q4, as the Agent wrote it"));

    const merged = await call("PUT", "/decks/q4", {
      text: deckText("Q4, both"),
      base: stale.body.rev,
    });
    expect(merged.status).toBe(200);
    expect(text("decks/q4.bento.json")).toBe(deckText("Q4, both"));
    // The Agent's version the save replaced is in the deck's history.
    const { versions } = (await call("GET", "/decks/q4/history")).body;
    expect(versions.map((version: { by: string }) => version.by)).toEqual(["agent"]);
    const kept = await call("GET", `/decks/q4/history/${versions[0].name}`);
    expect(kept.body.text).toBe(deckText("Q4, as the Agent wrote it"));
  });

  it("keeps the newest twenty replaced versions, newest first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T09:00:00Z"));
    const { host, agentWrites } = fakeHost();
    const { call } = mount(host);
    await call("POST", "/decks", { id: "q4", text: deckText("start") });
    for (let round = 1; round <= 25; round++) {
      vi.setSystemTime(new Date(Date.parse("2026-11-17T09:00:00Z") + round * 1000));
      agentWrites("decks/q4.bento.json", deckText(`Agent, round ${round}`));
      const current = await call("GET", "/decks/q4");
      const saved = await call("PUT", "/decks/q4", {
        text: deckText(`mine ${round}`),
        base: current.body.rev,
      });
      expect(saved.status).toBe(200);
    }
    const { versions } = (await call("GET", "/decks/q4/history")).body;
    expect(versions).toHaveLength(20);
    const texts = await Promise.all(
      versions.map(
        async (version: { name: string }) =>
          (await call("GET", `/decks/q4/history/${version.name}`)).body.text,
      ),
    );
    expect(texts[0]).toBe(deckText("Agent, round 25"));
    expect(texts[19]).toBe(deckText("Agent, round 6"));
    expect((await call("GET", "/decks/q4/history/0-nobody")).status).toBe(404);
  });
});

describe("a page listening for changes", () => {
  it("hears that the Agent changed or removed a deck, and the page's version the Agent replaced is kept", async () => {
    vi.useFakeTimers();
    const { host, agentWrites, files } = fakeHost();
    const { call, dispose } = mount(host);
    await call("POST", "/decks", { id: "q4", text: deckText("the page's") });
    const events = (await call("GET", "/events")).stream![Symbol.asyncIterator]();
    expect((await events.next()).value).toBe(": open\n\n");
    // The first look takes stock; the next one compares.
    await vi.advanceTimersByTimeAsync(700);

    agentWrites("decks/q4.bento.json", deckText("the Agent's"));
    await vi.advanceTimersByTimeAsync(700);
    expect((await events.next()).value).toBe(
      `event: decks\ndata: ${JSON.stringify({ changed: ["q4"], removed: [] })}\n\n`,
    );
    const { versions } = (await call("GET", "/decks/q4/history")).body;
    expect(versions.map((version: { by: string }) => version.by)).toEqual(["editor"]);
    expect((await call("GET", `/decks/q4/history/${versions[0].name}`)).body.text).toBe(
      deckText("the page's"),
    );

    files.delete("decks/q4.bento.json");
    await vi.advanceTimersByTimeAsync(700);
    expect((await events.next()).value).toBe(
      `event: decks\ndata: ${JSON.stringify({ changed: [], removed: ["q4"] })}\n\n`,
    );
    await events.return?.();
    dispose();
  });
});

describe("asking the Agent", () => {
  it("opens one Session per deck and names the deck's file, the slide and the selection", async () => {
    const { host, runs, status } = fakeHost();
    const { call } = mount(host);
    await call("POST", "/decks", { id: "q4", text: deckText("Q4") });
    await call("POST", "/decks", { id: "launch", text: deckText("Launch") });

    const asked = await call("POST", "/ask", {
      deck: "q4",
      text: "Make this slide a bar chart of the numbers",
      slide: { id: "numbers", number: 3 },
      selection: ["chart", "headline"],
    });
    expect(asked.body).toEqual({ sessionId: "session-1", queued: false });
    const request = runs[0]!.text;
    expect(request).toContain(`${FOLDER}/decks/q4.bento.json`);
    expect(request).toContain('slide 3 (id "numbers")');
    expect(request).toContain('"chart", "headline"');
    expect(request).toContain("Make this slide a bar chart of the numbers");

    status.set("session-1", "idle");
    await call("POST", "/ask", { deck: "q4", text: "Add a caption under it" });
    await call("POST", "/ask", { deck: "launch", text: "Retitle the cover" });
    expect(runs.map((run) => run.sessionId)).toEqual(["session-1", "session-1", "session-2"]);
    expect(runs[2]!.text).toContain(`${FOLDER}/decks/launch.bento.json`);

    // While the request runs there is no answer yet; once it has ended, the answer is taken up.
    expect((await call("GET", "/ask", null, { deck: "q4" })).body.status).toBe("running");
    status.set("session-1", "idle");
    const talk = (await call("GET", "/ask", null, { deck: "q4" })).body;
    expect(talk.messages).toEqual([
      { role: "user", text: "Make this slide a bar chart of the numbers" },
      { role: "user", text: "Add a caption under it" },
      { role: "assistant", text: "The chart on slide 3 now shows Q1 to Q4." },
    ]);
    // Asked again, the answer is not taken up twice.
    expect((await call("GET", "/ask", null, { deck: "q4" })).body.messages).toHaveLength(3);
  });
});

describe("deleting a deck", () => {
  it("removes its file, its history and its conversation", async () => {
    const { host, agentWrites, files } = fakeHost();
    const { call } = mount(host);
    await call("POST", "/decks", { id: "q4", text: deckText("Q4") });
    agentWrites("decks/q4.bento.json", deckText("the Agent's"));
    const current = (await call("GET", "/decks/q4")).body;
    await call("PUT", "/decks/q4", { text: deckText("mine"), base: current.rev });
    await call("POST", "/ask", { deck: "q4", text: "Retitle the cover" });
    expect([...files.keys()].some((path) => path.startsWith("history/q4/"))).toBe(true);

    expect((await call("DELETE", "/decks/q4")).status).toBe(200);
    expect([...files.keys()]).toEqual([]);
    expect((await call("GET", "/decks")).body.decks).toEqual([]);
    expect((await call("GET", "/ask", null, { deck: "q4" })).body).toEqual({
      sessionId: null,
      status: null,
      messages: [],
    });
  });
});

describe("a server without workbench files", () => {
  it("answers that it is not supported instead of failing", async () => {
    const { host } = fakeHost({ withFiles: false });
    const { call } = mount(host);
    expect((await call("GET", "/info")).body).toEqual({ supported: false, decksDir: null });
    const decks = await call("GET", "/decks");
    expect(decks.status).toBe(501);
    expect(decks.body.error).toBe("unsupported");
  });
});
