/**
 * Sounds from espeak-ng, through a fake runner so no program starts: the language mapping, the
 * stress stripping, the refresh that fills a decodable book's words, the author's own sounds,
 * and the books a refresh refuses.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { BookWordsRefresh, BookWordsState } from "../src/activities/book-word-types.js";
import {
  espeakLanguage,
  parseEspeakOutput,
  parseEspeakVersion,
  type EspeakRunner,
} from "../src/activities/phonemes.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import { catBookSpec } from "./activity-fixtures.js";

describe("espeak-ng output", () => {
  it("maps language codes as Loom does", () => {
    expect(espeakLanguage("en-US")).toBe("en-us");
    expect(espeakLanguage("en_GB")).toBe("en-gb");
    expect(espeakLanguage("en-AU")).toBe("en-us");
    expect(espeakLanguage("es-US")).toBe("es");
  });

  it("strips stress and reads one segment per sound", () => {
    expect(parseEspeakOutput(" k ˈæ t\r\n")).toEqual(["k", "æ", "t"]);
    expect(parseEspeakOutput("ˌð ə\n")).toEqual(["ð", "ə"]);
    expect(parseEspeakOutput("\n")).toBeNull();
    expect(parseEspeakOutput("toolongsegment")).toBeNull();
    expect(parseEspeakVersion("eSpeak NG text-to-speech: 1.51  Data at: /usr")).toBe("1.51");
  });
});

const SOUNDS: Record<string, string> = {
  the: "ð ə",
  cat: "k ˈæ t",
  sat: "s ˈæ t",
};

describe("refreshing book words", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(installed = true) {
    const calls: { program: string; args: readonly string[]; timeoutMs: number }[] = [];
    const run: EspeakRunner = async (program, args, timeoutMs) => {
      calls.push({ program, args, timeoutMs });
      if (!installed) return { ok: false, stdout: "" };
      if (args[0] === "--version") return { ok: true, stdout: "eSpeak NG text-to-speech: 1.51" };
      const sounds = SOUNDS[args[args.length - 1]!];
      return sounds ? { ok: true, stdout: `${sounds}\n` } : { ok: false, stdout: "" };
    };
    const t = await createTestApp({ espeakPorts: { run } });
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "wordsmith");
    const client = apiClient(t.app, owner.cookie);
    const projectId = "wordsmith-books";
    expect((await client.post("/api/projects", { projectId })).status).toBe(201);
    const base = `/api/projects/${projectId}/activities`;
    const authoring = t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    async function book(
      spec: Record<string, unknown> = catBookSpec(),
      activityType: "book" | "standard" = "book",
      productCode = "cat-book",
    ) {
      const created = (await (
        await client.post(base, { productCode, refNum: 1, title: "Cat book", activityType })
      ).json()) as ActivityDetail;
      const endpoint = `${base}/${created.id}`;
      const draft = await plan(endpoint, spec, created.draft.contentRevision);
      return { endpoint, created, draft };
    }
    async function plan(endpoint: string, spec: Record<string, unknown>, revision: string) {
      const applied = await client.post(`${endpoint}/apply-generated-spec`, {
        spec,
        expectedRevision: revision,
      });
      expect(applied.status, await applied.clone().text()).toBe(200);
      const planned = await client.post(`${endpoint}/plan-media`, {
        expectedRevision: ((await applied.json()) as ActivityDraft).contentRevision,
      });
      expect(planned.status, await planned.clone().text()).toBe(200);
      return (await planned.json()) as ActivityDraft;
    }
    const refresh = (endpoint: string, draft: ActivityDraft, bookMode?: string) =>
      client.post(`${endpoint}/book-words/refresh`, {
        language: "en-US",
        expectedRevision: draft.contentRevision,
        ...(bookMode ? { bookMode } : {}),
      });
    return { t, client, base, projectId, authoring, calls, book, plan, refresh };
  }

  const words = (draft: ActivityDraft) =>
    draft.mediaPlan!.manifest.assets["en-US"]!.filter((asset) => asset.role === "bookWord");

  it("plans the story's words with espeak-ng's sounds and lists the ones it could not sound out", async () => {
    const { client, calls, book, refresh } = await setup();
    const { endpoint, draft } = await book();
    const response = await refresh(endpoint, draft, "decodable");
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as BookWordsRefresh;
    expect(result.missing).toEqual(["ran"]);
    expect(
      words(result.draft).map((asset) => [
        asset.key,
        asset.word,
        asset.phonemes ?? null,
        asset.phonemeSource ?? null,
      ]),
    ).toEqual([
      ["book-word-the-b9776d7ddf", "The", ["ð", "ə"], "espeak"],
      ["book-word-cat-77af778b51", "cat", ["k", "æ", "t"], "espeak"],
      ["book-word-sat-339efeab70", "sat", ["s", "æ", "t"], "espeak"],
      ["book-word-ran-c8fc6bf296", "ran", null, null],
    ]);
    // Started with no shell, one word per call, with the voice and separator the spec names.
    const cat = calls.find((call) => call.args.includes("cat"))!;
    expect(cat).toEqual({
      program: "espeak-ng",
      args: ["-q", "--ipa", "-v", "en-us", "--sep= ", "cat"],
      timeoutMs: 5000,
    });
    const state = (await (await client.get(`${endpoint}/book-words`)).json()) as BookWordsState;
    // The author's choice is recorded on the product, so it holds after a reload.
    expect(state).toEqual({ bookMode: "decodable", espeak: { available: true, version: "1.51" } });
    const later = (await (await refresh(endpoint, result.draft)).json()) as BookWordsRefresh;
    expect(later.missing).toEqual(["ran"]);
  });

  it("copies no word pronunciation into a language the book adds", async () => {
    const { client, book, refresh } = await setup();
    const { endpoint, draft } = await book();
    const refreshed = (await (
      await refresh(endpoint, draft, "decodable")
    ).json()) as BookWordsRefresh;
    // A word with a script, as an imported Loom word has.
    const manifest = structuredClone(refreshed.draft.mediaPlan!.manifest);
    const cat = manifest.assets["en-US"]!.find((asset) => asset.normalizedWord === "cat")!;
    cat.script = "cat";
    const saved = await client.put(`${endpoint}/media`, {
      manifest,
      expectedRevision: refreshed.draft.contentRevision,
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const added = await client.post(`${endpoint}/languages`, {
      language: "es-MX",
      expectedRevision: ((await saved.json()) as ActivityDraft).contentRevision,
    });
    expect(added.status, await added.clone().text()).toBe(200);
    const group = ((await added.json()) as ActivityDraft).mediaPlan!.manifest.assets["es-MX"]!;
    expect(group.length).toBeGreaterThan(0);
    expect(group.some((asset) => asset.role === "bookWord")).toBe(false);
  });

  it("says every word is missing when espeak-ng is not installed", async () => {
    const { client, base, book, refresh } = await setup(false);
    const { endpoint, draft } = await book();
    const result = (await (await refresh(endpoint, draft, "decodable")).json()) as BookWordsRefresh;
    expect(result.missing).toEqual(["the", "cat", "sat", "ran"]);
    expect(words(result.draft).every((asset) => asset.phonemes === undefined)).toBe(true);
    expect(await (await client.get(`${base}/book-words/setup`)).json()).toEqual({
      espeak: { available: false, version: null },
    });
  });

  it("keeps a word the author corrected, even when the story no longer uses it", async () => {
    const { client, book, plan, refresh } = await setup();
    const { endpoint, draft } = await book();
    const refreshed = (await (
      await refresh(endpoint, draft, "decodable")
    ).json()) as BookWordsRefresh;

    const bad = await client.put(`${endpoint}/book-words/book-word-sat-339efeab70/phonemes`, {
      phonemes: [],
      expectedRevision: refreshed.draft.contentRevision,
    });
    expect(bad.status).toBe(400);
    const missingWord = await client.put(`${endpoint}/book-words/narration-1/phonemes`, {
      phonemes: ["x"],
      expectedRevision: refreshed.draft.contentRevision,
    });
    expect(missingWord.status).toBe(404);
    const corrected = await client.put(`${endpoint}/book-words/book-word-sat-339efeab70/phonemes`, {
      phonemes: ["s", "ˈa", "t"],
      expectedRevision: refreshed.draft.contentRevision,
    });
    expect(corrected.status, await corrected.clone().text()).toBe(200);
    const edited = (await corrected.json()) as ActivityDraft;
    expect(words(edited).find((asset) => asset.normalizedWord === "sat")).toMatchObject({
      phonemes: ["s", "a", "t"],
      phonemeSource: "author",
      customized: true,
    });

    // The story is rewritten without "sat"; the plan is rebuilt and the words refreshed.
    const rewritten = await plan(endpoint, catBookSpec(["The cat ran."]), edited.contentRevision);
    const again = (await (
      await refresh(endpoint, rewritten, "decodable")
    ).json()) as BookWordsRefresh;
    const after = words(again.draft);
    expect(after.map((asset) => asset.normalizedWord)).toEqual(["the", "cat", "ran", "sat"]);
    expect(after.find((asset) => asset.normalizedWord === "sat")).toMatchObject({
      phonemes: ["s", "a", "t"],
      phonemeSource: "author",
      customized: true,
      usages: [],
    });
    expect(again.missing).toEqual(["ran"]);
  });

  it("refuses a read-along book, a book with no mode chosen, and anything that is not a book", async () => {
    const { t, projectId, authoring, book, refresh } = await setup();
    const readAlong = await book();
    const collection = (await authoring.ensureCollection(projectId)).collectionId;
    await authoring.setProductBookMode(projectId, collection, "cat-book", "readAlong");
    // The product's recorded mode wins over the author's choice.
    const refused = await refresh(readAlong.endpoint, readAlong.draft, "decodable");
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "not_decodable" } });

    const unchosen = await book(catBookSpec(), "book", "dog-book");
    expect((await refresh(unchosen.endpoint, unchosen.draft)).status).toBe(409);
    await authoring.setProductBookMode(projectId, collection, "dog-book", "decodable");
    expect((await refresh(unchosen.endpoint, unchosen.draft)).status).toBe(200);

    const standard = await book(
      {
        ...catBookSpec(),
        scenes: [{ id: "intro", description: "A scene" }],
      },
      "standard",
      "not-a-book",
    );
    const notBook = await refresh(standard.endpoint, standard.draft, "decodable");
    expect(notBook.status).toBe(409);
    expect(await notBook.json()).toMatchObject({ error: { code: "not_decodable" } });
    expect(t).toBeTruthy();
  });

  it("lets only an admin name the espeak-ng program", async () => {
    const { t, calls } = await setup();
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect(await (await admin.get("/api/admin/activity-phonemes")).json()).toEqual({
      espeakPath: null,
      espeak: { available: true, version: "1.51" },
    });
    const put = await admin.put("/api/admin/activity-phonemes", {
      espeakPath: "/opt/espeak/bin/espeak-ng",
    });
    expect(put.status, await put.clone().text()).toBe(200);
    expect((await put.json()) as unknown).toMatchObject({
      espeakPath: "/opt/espeak/bin/espeak-ng",
    });
    expect(calls.at(-1)!.program).toBe("/opt/espeak/bin/espeak-ng");
    expect((await admin.put("/api/admin/activity-phonemes", { espeakPath: "a\nb" })).status).toBe(
      400,
    );
    const member = await provisionUser(t.app, "notadmin");
    expect((await apiClient(t.app, member.cookie).get("/api/admin/activity-phonemes")).status).toBe(
      403,
    );
  });
});
