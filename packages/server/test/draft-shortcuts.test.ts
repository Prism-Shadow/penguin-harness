/**
 * The draft screen's user-defined shortcuts, stored under `ui_prefs.draftShortcuts`.
 *
 * ui_prefs is a free-form JSON column shared by every UI preference, so this key — the only one
 * holding text the user wrote — is the one that has to be bounded on the way in. The cases below
 * go through the real route rather than the validator alone, because the two claims that matter
 * are about the route: a rejected write stores **nothing**, and an accepted one does not disturb
 * the other writers merging into the same object.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import {
  DRAFT_SHORTCUT_MAX_COUNT,
  DRAFT_SHORTCUT_PROMPT_MAX,
  DRAFT_SHORTCUT_TITLE_MAX,
} from "../src/services/draft-shortcuts.js";
import type { DraftShortcut } from "../src/api/types.js";

const shortcut = (id: string): DraftShortcut => ({
  id,
  title: `title ${id}`,
  prompt: `prompt ${id}`,
});

describe("ui_prefs draftShortcuts", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "gina");
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const readShortcuts = async (): Promise<DraftShortcut[] | undefined> => {
    const body = (await (await api.get("/api/me/prefs")).json()) as {
      prefs: { draftShortcuts?: DraftShortcut[] };
    };
    return body.prefs.draftShortcuts;
  };

  it("stores a list per user and reads it back in order", async () => {
    const list = [shortcut("a"), shortcut("b")];
    const res = await api.put("/api/me/prefs", { draftShortcuts: list });
    expect(res.status).toBe(200);
    expect(await readShortcuts()).toEqual(list);

    // Another user's shortcuts are their own.
    const other = apiClient(t.app, (await provisionUser(t.app, "hank")).cookie);
    const theirs = (await (await other.get("/api/me/prefs")).json()) as { prefs: object };
    expect(theirs.prefs).toEqual({});
  });

  it("replaces the whole list on write while leaving other preferences alone", async () => {
    await api.put("/api/me/prefs", { lastProjectId: "default_project" });
    await api.put("/api/me/prefs", { draftShortcuts: [shortcut("a"), shortcut("b")] });
    await api.put("/api/me/prefs", { draftShortcuts: [shortcut("b")] });
    const body = (await (await api.get("/api/me/prefs")).json()) as {
      prefs: { lastProjectId?: string; draftShortcuts?: DraftShortcut[] };
    };
    expect(body.prefs.draftShortcuts).toEqual([shortcut("b")]);
    expect(body.prefs.lastProjectId).toBe("default_project");
  });

  it("normalizes what it stores: trimmed fields, and no extra keys riding along", async () => {
    // Passing the entry through as given would let an unbounded field sit inside a value that
    // otherwise looks capped.
    await api.put("/api/me/prefs", {
      draftShortcuts: [
        { id: " a ", title: "  name  ", prompt: "  body  ", note: "x".repeat(5000) },
      ],
    });
    expect(await readShortcuts()).toEqual([{ id: "a", title: "name", prompt: "body" }]);
  });

  it("refuses more shortcuts than the cap, and stores nothing when it does", async () => {
    await api.put("/api/me/prefs", { draftShortcuts: [shortcut("keep")] });
    const tooMany = Array.from({ length: DRAFT_SHORTCUT_MAX_COUNT + 1 }, (_, i) =>
      shortcut(`id-${i}`),
    );
    const res = await api.put("/api/me/prefs", { draftShortcuts: tooMany });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_draft_shortcuts",
    );
    expect(await readShortcuts()).toEqual([shortcut("keep")]);

    // Exactly at the cap is fine.
    const atCap = tooMany.slice(0, DRAFT_SHORTCUT_MAX_COUNT);
    expect((await api.put("/api/me/prefs", { draftShortcuts: atCap })).status).toBe(200);
    expect(await readShortcuts()).toHaveLength(DRAFT_SHORTCUT_MAX_COUNT);
  });

  it("refuses an over-long title or prompt", async () => {
    const long = async (field: "title" | "prompt", max: number) => {
      const entry = { ...shortcut("a"), [field]: "x".repeat(max + 1) };
      const res = await api.put("/api/me/prefs", { draftShortcuts: [entry] });
      expect(res.status, `${field} over the cap`).toBe(400);
      const ok = { ...shortcut("a"), [field]: "x".repeat(max) };
      expect((await api.put("/api/me/prefs", { draftShortcuts: [ok] })).status).toBe(200);
    };
    await long("title", DRAFT_SHORTCUT_TITLE_MAX);
    await long("prompt", DRAFT_SHORTCUT_PROMPT_MAX);
  });

  it("refuses a malformed entry", async () => {
    const bad: unknown[] = [
      "not an object",
      { title: "no id", prompt: "body" },
      { id: "a", prompt: "no title" },
      { id: "a", title: "no prompt" },
      { id: "a", title: "   ", prompt: "blank title" },
      { id: "a", title: "blank prompt", prompt: "  " },
      { id: 7, title: "numeric id", prompt: "body" },
      { id: "x".repeat(65), title: "id as storage", prompt: "body" },
    ];
    for (const entry of bad) {
      const res = await api.put("/api/me/prefs", { draftShortcuts: [entry] });
      expect(res.status, JSON.stringify(entry)).toBe(400);
    }
    // A value that is not an array at all.
    expect((await api.put("/api/me/prefs", { draftShortcuts: { a: 1 } })).status).toBe(400);
    expect(await readShortcuts()).toBeUndefined();
  });

  it("refuses a duplicate id", async () => {
    // Ids are what the Web App edits and deletes a row by; two rows wearing one id would make
    // both act on the wrong one.
    const res = await api.put("/api/me/prefs", {
      draftShortcuts: [shortcut("a"), { ...shortcut("b"), id: "a" }],
    });
    expect(res.status).toBe(400);
  });

  it("accepts an empty list, which is how the last shortcut is deleted", async () => {
    await api.put("/api/me/prefs", { draftShortcuts: [shortcut("a")] });
    expect((await api.put("/api/me/prefs", { draftShortcuts: [] })).status).toBe(200);
    expect(await readShortcuts()).toEqual([]);
  });
});
