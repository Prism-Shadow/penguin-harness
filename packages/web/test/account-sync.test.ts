/**
 * Preferences and drafts that follow the account (lib/account-sync): the account's copy is the
 * truth, this browser's localStorage is its cache, and the first sign-in after the upgrade hands
 * the browser's own values to the account once.
 *
 * - Given an account that holds no preferences and a browser that never handed its own over,
 *   the browser's cached preferences (the background image included) go up and the cache stays.
 * - Given an account that holds preferences, the account wins field by field — a field it does
 *   not hold leaves the cache, which reads as the default — except a field with an edit the
 *   account has not acknowledged, which keeps the cached value and goes up again. The cached
 *   image is fetched only when its id is not the account's, and dropped when the account has
 *   none.
 * - A cached draft key maps to the account's `<kind>:<id>` key and back for every kind, a user
 *   named "session" included; another user's key maps to nothing.
 * - Given a first sign-in, cached drafts the account lacks go up, except form answers (their keys
 *   carry no user), which are dropped; later, a cached draft the account lacks was sent or
 *   deleted elsewhere and is dropped. Either way the account wins a conflict, a pending edit wins over the account, and a
 *   pending removal is not resurrected.
 * - Signed in: an edit is cached at once and reaches the account after the debounce; one whose
 *   send failed stays pending across a reload and wins over the account's older value at the next
 *   sign-in.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeCached } from "../src/lib/account-sync/cache";
import { accountKeyOf, cacheKeyOf, planDrafts } from "../src/lib/account-sync/drafts";
import { BACKGROUND_IMAGE_ID_KEY, planPrefs } from "../src/lib/account-sync/prefs";
import {
  PREF_FLUSH_MS,
  PREFS_IMPORTED_KEY,
  flushAccountSync,
  startAccountSync,
  stopAccountSync,
  syncPendingKey,
} from "../src/lib/account-sync/sync";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { memoryStorage, stubLocalStorage } from "./helpers/storage";

const IMAGE = "data:image/png;base64,AAAA";

describe("reading the account's preferences into the cache", () => {
  const cached = () =>
    memoryStorage({
      "penguin.themeId": "geek",
      "penguin.lang": "en",
      "penguin.toolAliases": "0",
      "penguin.background.settings": '{"transparency":40,"mode":"tile","position":"left top"}',
      "penguin.background.image": IMAGE,
    });

  it("hands an account that holds none the browser's own, once, leaving the cache as it is", () => {
    const plan = planPrefs({ lastProjectId: "p" }, cached(), {
      importing: true,
      pending: new Set(),
    });
    expect(plan.cache).toEqual([]);
    expect(plan.upload.sort()).toEqual(
      ["background", "backgroundImage", "lang", "themeId", "toolAliases"].sort(),
    );
    expect(plan.image).toBe("upload");
  });

  it("lets the account win field by field, except where an edit is still pending", () => {
    const plan = planPrefs(
      { themeId: "modern", lang: "zh", toolAliases: true, backgroundImageId: "img-2" },
      cached(),
      { importing: true, pending: new Set(["lang"]) },
    );
    expect(plan.cache).toEqual([
      ["penguin.themeId", "modern"],
      ["penguin.toolAliases", "1"],
      // Not held by the account: the default.
      ["penguin.background.settings", null],
    ]);
    expect(plan.upload).toEqual(["lang"]);
    expect(plan.image).toBe("fetch");
  });

  it("fetches the image only when it is not the cached one, and drops it when the account has none", () => {
    const same = cached();
    same.setItem(BACKGROUND_IMAGE_ID_KEY, "img-1");
    const options = { importing: false, pending: new Set<string>() };
    expect(planPrefs({ backgroundImageId: "img-1" }, same, options).image).toBe("keep");
    expect(planPrefs({ themeId: "geek" }, same, options).image).toBe("drop");
  });
});

describe("the account's draft keys", () => {
  it("maps every kind of cached draft to the account's key and back", () => {
    const pairs: Array<[cache: string, account: string]> = [
      ["penguin.chatDraft.ann.ann-default_project", "chat:ann-default_project"],
      ["penguin.chatDraft.session.ann.session-1", "session:session-1"],
      ["penguin.chatDrafts.ann.ann-default_project", "parked:ann-default_project"],
      ["penguin.channelDraft.ann.p.acme.general", "channel:p.acme.general"],
      ["penguin.orgCreateDraft.ann.p", "org:p"],
      ["penguin.a2uiDraft.session-1:block-9", "a2ui:session-1:block-9"],
    ];
    for (const [cacheKey, accountKey] of pairs) {
      expect(accountKeyOf(cacheKey, "ann")).toBe(accountKey);
      expect(cacheKeyOf(accountKey, "ann")).toBe(cacheKey);
    }
    // A user named "session": a Session's composer and a Project's draft stay apart.
    expect(accountKeyOf("penguin.chatDraft.session.session.session-1", "session")).toBe(
      "session:session-1",
    );
    expect(accountKeyOf("penguin.chatDraft.session.p", "session")).toBe("chat:p");
    expect(accountKeyOf("penguin.chatDraft.bob.p", "ann")).toBeNull();
    expect(accountKeyOf("penguin.theme", "ann")).toBeNull();
    expect(cacheKeyOf("notes:x", "ann")).toBeNull();
  });
});

describe("reading the account's drafts into the cache", () => {
  const cached = new Map([
    ["penguin.chatDraft.ann.p", '{"text":"typed here"}'],
    ["penguin.chatDraft.session.ann.s-1", '{"text":"local reply"}'],
    ["penguin.a2uiDraft.s-1:b", '{"v":1,"at":1,"state":{}}'],
    ["penguin.chatDraft.bob.p", '{"text":"bob\'s"}'],
  ]);

  it("on a first sign-in, hands the account the drafts it lacks and takes the ones it has", () => {
    const plan = planDrafts(
      { "session:s-1": { text: "account reply" }, "session:s-2": { text: "from elsewhere" } },
      cached,
      { userId: "ann", importing: true, pending: new Set() },
    );
    expect(plan.upload).toEqual(["chat:p"]);
    expect(plan.cache).toEqual([
      ["penguin.chatDraft.session.ann.s-1", '{"text":"account reply"}'],
      ["penguin.a2uiDraft.s-1:b", null],
      ["penguin.chatDraft.session.ann.s-2", '{"text":"from elsewhere"}'],
    ]);
  });

  it("afterwards drops what the account lacks, keeps a pending edit, and does not resurrect a pending removal", () => {
    const plan = planDrafts(
      { "session:s-1": { text: "account reply" }, "session:s-3": { text: "deleted here" } },
      cached,
      { userId: "ann", importing: false, pending: new Set(["session:s-1", "session:s-3"]) },
    );
    expect(plan.cache).toEqual([
      ["penguin.chatDraft.ann.p", null],
      ["penguin.a2uiDraft.s-1:b", null],
    ]);
    expect(plan.upload.sort()).toEqual(["session:s-1", "session:s-3"]);
  });
});

describe("carrying edits to the account", () => {
  afterEach(() => {
    stopAccountSync();
    vi.useRealTimers();
  });

  it("sends an edit after the debounce, and keeps a failed one pending until the next sign-in wins it", async () => {
    vi.useFakeTimers();
    const store = stubLocalStorage(memoryStorage({ [PREFS_IMPORTED_KEY]: "1" }));
    let prefs: Record<string, unknown> = { lang: "zh" };
    let down = false;
    const fetch = stubFetch((req) => {
      if (req.path === "/api/me/drafts") return json({ drafts: {} });
      if (req.path !== "/api/me/prefs") return apiError(404, "not_found");
      if (req.method === "GET") return json({ prefs });
      if (down) return apiError(503, "unavailable");
      prefs = { ...prefs, ...(req.body as object) };
      return json({ prefs });
    });

    await startAccountSync("ann");
    expect(store.getItem("penguin.lang")).toBe("zh");

    writeCached("penguin.lang", "en");
    expect(fetch.requests.filter((r) => r.method === "PUT")).toEqual([]);
    await vi.advanceTimersByTimeAsync(PREF_FLUSH_MS);
    expect(prefs.lang).toBe("en");

    down = true;
    writeCached("penguin.themeId", "geek");
    await flushAccountSync();
    expect(prefs.themeId).toBeUndefined();
    expect(JSON.parse(store.getItem(syncPendingKey("ann"))!)).toEqual({
      prefs: ["themeId"],
      drafts: [],
    });

    // A reload: the account still holds its older value, and the pending edit wins.
    stopAccountSync();
    prefs = { ...prefs, themeId: "modern" };
    down = false;
    await startAccountSync("ann");
    expect(store.getItem("penguin.themeId")).toBe("geek");
    await vi.advanceTimersByTimeAsync(0);
    expect(prefs.themeId).toBe("geek");
    expect(store.getItem(syncPendingKey("ann"))).toBeNull();
  });
});
