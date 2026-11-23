/**
 * The Slides workbench's handler, against a host whose data and cache folders are temporary
 * folders on disk (the one boundary the handler has; it reads and writes them with node:fs):
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
 * - Given two opens of one presentation on the same chosen model, both use one Session.
 *   A second presentation can choose a different provider with the same model ID.
 * - Given a deck is deleted, its file, its history and its conversation go with it.
 * - Given a link the Agent left where the decks or a deck's history belong, the handler refuses
 *   it and writes nothing through it.
 * - Given a file the page built for a download, it is kept in the cache folder, not the data
 *   folder, and downloads as it was sent.
 * - Given a host without data folders, the handler says so instead of failing.
 */
import { mkdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import slides from "../workbenches/slides/index.ts";

/** A deck file's text: a small Bento document. */
const deckText = (title: string) =>
  JSON.stringify({ format: "bento/slides", version: 1, title, slides: [] });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const roots: string[] = [];

/** Every file under `dir`, as paths relative to it with `/` between levels. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .sort();
}

async function fakeHost({ withFolders = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bento-handler-"));
  roots.push(root);
  const folders = {
    dataDir: path.join(root, "app", "data", "slides"),
    cacheDir: path.join(root, "app", "cache", "slides"),
    stateDir: path.join(root, "run", "slides"),
  };
  const status = new Map<string, string>();
  const picked = new Map<string, unknown>();
  const runs: Array<{ sessionId: string; text: string }> = [];
  let state: unknown = null;
  const host = {
    listAgents: () => [{ agentId: "default_agent" }],
    async createSession(opts?: { model?: unknown }) {
      const sessionId = `session-${status.size + 1}`;
      status.set(sessionId, "idle");
      picked.set(sessionId, opts?.model);
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
    async sessionResult(): Promise<{
      status: "completed" | "failed";
      text: string;
      error: string | null;
    }> {
      return { status: "completed", text: "The chart on slide 3 now shows Q1 to Q4.", error: null };
    },
    subscribe: () => () => undefined,
    getState: () => state,
    async setState(next: unknown) {
      state = next;
    },
    log: () => undefined,
    ...(withFolders
      ? {
          // As the server does: all three folders exist once this returns.
          dataPaths() {
            for (const dir of Object.values(folders)) mkdirSync(dir, { recursive: true });
            return { ...folders };
          },
        }
      : {}),
  };
  const { dataDir } = folders;
  return {
    host,
    root,
    ...folders,
    runs,
    status,
    picked,
    /** What the Agent does with its own file tools: the file changes outside the handler. */
    agentWrites: async (name: string, text: string) => {
      await mkdir(path.dirname(path.join(dataDir, name)), { recursive: true });
      await writeFile(path.join(dataDir, name), text);
    },
    text: (name: string) => readFile(path.join(dataDir, name), "utf8").catch(() => null),
  };
}

type Answer = {
  status: number;
  body: any;
  headers?: Record<string, string>;
  bytes?: Uint8Array;
  stream?: AsyncIterable<Uint8Array | string>;
};

function mount(host: unknown) {
  const disposers: Array<() => void> = [];
  const { api } = slides.modules.Workbench.create({
    use: { host } as never,
    effect: (dispose: () => void) => void disposers.push(dispose),
  });
  const call = async (
    method: string,
    route: string,
    body: unknown = null,
    query: Record<string, string> = {},
    bytes?: Uint8Array,
  ): Promise<Answer> => {
    const res = await api.main.handle({
      method,
      path: route,
      query,
      headers: {},
      body,
      ...(bytes ? { bytes } : {}),
    });
    return { ...res, status: res.status ?? 200, body: res.body };
  };
  return { call, dispose: () => disposers.forEach((dispose) => dispose()) };
}

afterEach(async () => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("saving a deck the Agent edits too", () => {
  it("refuses a save made from an old revision, answering the file as it is now", async () => {
    const { host, agentWrites, text } = await fakeHost();
    const { call } = mount(host);
    const created = await call("POST", "/decks", { id: "q4", text: deckText("Q4") });
    expect(created.status).toBe(201);
    // Windows PowerShell can mark a UTF-8 file with a BOM. Index it by title, while keeping
    // its exact contents in conflict responses and revision history.
    const agentVersion = "\uFEFF" + deckText("Q4, as the Agent wrote it");
    await agentWrites("decks/q4.bento.json", agentVersion);
    expect((await call("GET", "/decks")).body.decks).toEqual([
      expect.objectContaining({ title: "Q4, as the Agent wrote it" }),
    ]);

    const stale = await call("PUT", "/decks/q4", {
      text: deckText("Q4, by hand"),
      base: created.body.rev,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.text).toBe(agentVersion);
    expect(await text("decks/q4.bento.json")).toBe(agentVersion);

    const merged = await call("PUT", "/decks/q4", {
      text: deckText("Q4, both"),
      base: stale.body.rev,
    });
    expect(merged.status).toBe(200);
    expect(await text("decks/q4.bento.json")).toBe(deckText("Q4, both"));
    // The Agent's version the save replaced is in the deck's history.
    const { versions } = (await call("GET", "/decks/q4/history")).body;
    expect(versions.map((version: { by: string }) => version.by)).toEqual(["agent"]);
    const kept = await call("GET", `/decks/q4/history/${versions[0].name}`);
    expect(kept.body.text).toBe(agentVersion);
  });

  it("keeps the newest twenty replaced versions, newest first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T09:00:00Z"));
    const { host, agentWrites, dataDir } = await fakeHost();
    const { call } = mount(host);
    await call("POST", "/decks", { id: "q4", text: deckText("start") });
    for (let round = 1; round <= 25; round++) {
      vi.setSystemTime(new Date(Date.parse("2026-11-17T09:00:00Z") + round * 1000));
      await agentWrites("decks/q4.bento.json", deckText(`Agent, round ${round}`));
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
    // On disk, the history folder holds those twenty and nothing half-written.
    expect(await filesUnder(path.join(dataDir, "history", "q4"))).toHaveLength(20);
  });
});

describe("a page listening for changes", () => {
  it("hears that the Agent changed or removed a deck, and the page's version the Agent replaced is kept", async () => {
    const { host, agentWrites, dataDir } = await fakeHost();
    const { call, dispose } = mount(host);
    await call("POST", "/decks", { id: "q4", text: deckText("the page's") });
    const events = (await call("GET", "/events")).stream![Symbol.asyncIterator]();
    expect((await events.next()).value).toBe(": open\n\n");
    // The first look takes stock; the next ones compare.
    await sleep(1_500);

    await agentWrites("decks/q4.bento.json", deckText("the Agent's"));
    expect((await events.next()).value).toBe(
      `event: decks\ndata: ${JSON.stringify({ changed: ["q4"], removed: [] })}\n\n`,
    );
    const { versions } = (await call("GET", "/decks/q4/history")).body;
    expect(versions.map((version: { by: string }) => version.by)).toEqual(["editor"]);
    expect((await call("GET", `/decks/q4/history/${versions[0].name}`)).body.text).toBe(
      deckText("the page's"),
    );

    await rm(path.join(dataDir, "decks", "q4.bento.json"));
    expect((await events.next()).value).toBe(
      `event: decks\ndata: ${JSON.stringify({ changed: [], removed: ["q4"] })}\n\n`,
    );
    await events.return?.();
    dispose();
  });
});

describe("asking the Agent", () => {
  it("does not attach the previous abort to a retry while the host is admitting it", async () => {
    const { host, status } = await fakeHost();
    const { call } = mount(host);
    await call("POST", "/decks", { id: "draft", text: deckText("draft") });
    await call("POST", "/ask", { deck: "draft", text: "First edit" });
    status.set("session-1", "idle");
    const result = vi.spyOn(host, "sessionResult").mockResolvedValue({
      status: "failed",
      text: "",
      error: "Task aborted",
    });
    expect((await call("GET", "/ask", null, { deck: "draft" })).body.messages.at(-1).text).toBe(
      "Task aborted",
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const run = host.run.bind(host);
    vi.spyOn(host, "run").mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return run(...args);
    });
    const retry = call("POST", "/ask", { deck: "draft", text: "Try again" });
    await entered.promise;
    const snapshot = call("GET", "/ask", null, { deck: "draft" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();
    expect((await retry).status).toBe(200);
    expect((await snapshot).body.messages.at(-1)).toMatchObject({
      role: "user",
      text: "Try again",
    });
    status.set("session-1", "idle");
    result.mockResolvedValue({ status: "completed", text: "Deck updated.", error: null });
    expect((await call("GET", "/ask", null, { deck: "draft" })).body).toMatchObject({
      sessionId: "session-1",
      status: "idle",
      messages: [
        { role: "user", text: "First edit" },
        { role: "error", text: "Task aborted" },
        { role: "user", text: "Try again" },
        { role: "assistant", text: "Deck updated." },
      ],
    });
  });

  it("keeps the chosen provider and model per deck across simultaneous opens, runs and a reload", async () => {
    const { host, picked, runs } = await fakeHost();
    const { call } = mount(host);
    for (const id of ["draft", "other"]) await call("POST", "/decks", { id, text: deckText(id) });
    const chosen = { provider: "first", modelId: "same-upstream" };
    expect(
      (await call("POST", "/ask/session", { deck: "draft", model: { modelId: "same-upstream" } }))
        .status,
    ).toBe(400);
    expect((await call("POST", "/ask/session", { deck: "missing", model: chosen })).status).toBe(
      404,
    );
    const open = () => call("POST", "/ask/session", { deck: "draft", model: chosen });
    const [one, two] = await Promise.all([open(), open()]);
    expect(one.body.sessionId).toBe(two.body.sessionId);
    expect(picked.get(one.body.sessionId)).toEqual(chosen);
    expect(runs).toHaveLength(0);
    expect((await mount(host).call("GET", "/ask", null, { deck: "draft" })).body.sessionId).toBe(
      one.body.sessionId,
    );
    await call("POST", "/ask", { deck: "draft", text: "First task" });
    const other = await call("POST", "/ask", {
      deck: "other",
      text: "Create",
      model: { ...chosen, provider: "second" },
    });
    expect(picked.get(other.body.sessionId)).toEqual({ ...chosen, provider: "second" });
    expect(picked.size).toBe(2);
  });

  it("opens one Session per deck and names the deck's file, the slide and the selection", async () => {
    const { host, runs, status, dataDir } = await fakeHost();
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
    expect(request).toContain(`Deck file: ${path.join(dataDir, "decks", "q4.bento.json")}\n`);
    expect(request).toContain('slide 3 (id "numbers")');
    expect(request).toContain('"chart", "headline"');
    expect(request).toContain("Make this slide a bar chart of the numbers");

    status.set("session-1", "idle");
    await call("POST", "/ask", { deck: "q4", text: "Add a caption under it" });
    await call("POST", "/ask", { deck: "launch", text: "Retitle the cover" });
    expect(runs.map((run) => run.sessionId)).toEqual(["session-1", "session-1", "session-2"]);
    expect(runs[2]!.text).toContain(path.join(dataDir, "decks", "launch.bento.json"));

    // While the request runs there is no answer yet; once it has ended, the answer is taken up.
    expect((await call("GET", "/ask", null, { deck: "q4" })).body.status).toBe("running");
    status.set("session-1", "idle");
    const talk = (await call("GET", "/ask", null, { deck: "q4" })).body;
    expect(
      talk.messages.map(({ role, text }: { role: string; text: string }) => ({ role, text })),
    ).toEqual([
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
    const { host, agentWrites, dataDir } = await fakeHost();
    const { call } = mount(host);
    await call("POST", "/decks", { id: "q4", text: deckText("Q4") });
    await agentWrites("decks/q4.bento.json", deckText("the Agent's"));
    const current = (await call("GET", "/decks/q4")).body;
    await call("PUT", "/decks/q4", { text: deckText("mine"), base: current.rev });
    await call("POST", "/ask", { deck: "q4", text: "Retitle the cover" });
    expect((await filesUnder(dataDir)).some((name) => name.startsWith("history/q4/"))).toBe(true);

    expect((await call("DELETE", "/decks/q4")).status).toBe(200);
    expect(await filesUnder(dataDir)).toEqual([]);
    expect((await call("GET", "/decks")).body.decks).toEqual([]);
    expect((await call("GET", "/ask", null, { deck: "q4" })).body).toEqual({
      sessionId: null,
      status: null,
      messages: [],
    });
  });
});

describe("a link the Agent left in the data folder", () => {
  // A junction where the platform has one: a folder link needs no privilege there.
  const linkFolder = (target: string, at: string) => symlink(target, at, "junction");

  it("is refused where the decks belong, and nothing is read or written through it", async () => {
    const { host, root, dataDir } = await fakeHost();
    const { call } = mount(host);
    host.dataPaths();
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(
      path.join(outside, "leak.bento.json"),
      deckText("not a deck of this workbench"),
    );
    await linkFolder(outside, path.join(dataDir, "decks"));

    await expect(call("GET", "/decks")).rejects.toThrow(/not a folder/);
    await expect(call("GET", "/decks/leak")).rejects.toThrow(/not a folder/);
    await expect(call("POST", "/decks", { id: "q4", text: deckText("Q4") })).rejects.toThrow(
      /not a folder/,
    );
    expect(await readdir(outside)).toEqual(["leak.bento.json"]);
  });

  it("is refused where a deck's history belongs: the save goes through, the history does not", async () => {
    const { host, root, dataDir, agentWrites, text } = await fakeHost();
    const { call } = mount(host);
    await call("POST", "/decks", { id: "q4", text: deckText("Q4") });
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await linkFolder(outside, path.join(dataDir, "history"));
    await agentWrites("decks/q4.bento.json", deckText("the Agent's"));
    const current = (await call("GET", "/decks/q4")).body;

    expect(
      (await call("PUT", "/decks/q4", { text: deckText("mine"), base: current.rev })).status,
    ).toBe(200);
    expect(await text("decks/q4.bento.json")).toBe(deckText("mine"));
    await expect(call("GET", "/decks/q4/history")).rejects.toThrow(/not a folder/);
    await expect(call("DELETE", "/decks/q4")).rejects.toThrow(/not a folder/);
    expect(await readdir(outside)).toEqual([]);
    expect(await text("decks/q4.bento.json")).toBe(deckText("mine"));
  });
});

describe("a download the page built", () => {
  it("is kept in the cache folder, not with the decks, and downloads as it was sent", async () => {
    const { host, dataDir, cacheDir } = await fakeHost();
    const { call } = mount(host);
    const bytes = new TextEncoder().encode("<!doctype html><title>Q4</title>");
    const posted = await call("POST", "/export", null, { name: "Q4 review.bento.html" }, bytes);
    expect(posted.status).toBe(200);
    expect(await filesUnder(dataDir)).toEqual([]);
    expect(await filesUnder(cacheDir)).toHaveLength(1);

    const download = await call("GET", `/${posted.body.href}`);
    expect(download.headers?.["content-disposition"]).toContain("Q4%20review.bento.html");
    expect(new TextDecoder().decode(download.bytes)).toBe("<!doctype html><title>Q4</title>");
    expect((await call("GET", "/export/not-a-token")).status).toBe(404);
  });
});

describe("a server without data folders", () => {
  it("answers that it is not supported instead of failing", async () => {
    const { host } = await fakeHost({ withFolders: false });
    const { call } = mount(host);
    expect((await call("GET", "/info")).body).toEqual({ supported: false, decksDir: null });
    const decks = await call("GET", "/decks");
    expect(decks.status).toBe(501);
    expect(decks.body.error).toBe("unsupported");
  });
});
