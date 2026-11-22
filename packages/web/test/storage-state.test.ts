/**
 * The Storage page's usage (plugins/storage/src/web/storage-state.ts), driven through the real endpoint
 * wrappers against the fetch fake.
 *
 * - Given a measurement under way, the page asks again every poll interval until an answer says
 *   it has ended, and then asks nothing more.
 * - Given the page closed while a measurement runs, nothing more is asked.
 * - Given Refresh, the server is asked to measure again, and a read that Refresh overtook does
 *   not replace its answer.
 * - Given a poll that fails, the numbers on screen stay, and the page asks again later.
 * - Given the first read failing, the page has no numbers and says why.
 */
// The face's host first: the page calls the app's `apiFetch` and toasts through it.
import "../src/web-app/plugin-host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageUsage } from "../../../plugins/storage/src/types";
import {
  STORAGE_POLL_MS,
  STORAGE_POLL_RETRY_MS,
  createStorageStore,
} from "../../../plugins/storage/src/web/storage-state";
import { apiError, json, stubFetch, type FakeFetch } from "./helpers/fetch";

const ZERO = {
  traces: 0,
  agentState: 0,
  workspaces: 0,
  scratchpads: 0,
  caches: 0,
  logs: 0,
  plugins: 0,
  other: 0,
};

function usage(bytes: number, measuring: boolean): StorageUsage {
  return {
    measuredAt: "2026-11-19T08:00:00.000Z",
    measuring,
    bytes,
    categories: { ...ZERO, traces: bytes },
    projects: [],
    reveal: false,
  };
}

let fetch: FakeFetch;

/** The reads and refreshes the page sent, in order. */
const sent = () =>
  fetch.requests
    .filter((r) => r.path.startsWith("/api/me/storage"))
    .map((r) => `${r.method} ${r.path}`);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the Storage page's usage", () => {
  it("asks again while a measurement runs, and stops once one answer says it ended", async () => {
    const answers = [usage(1, true), usage(2, true), usage(3, false)];
    fetch = stubFetch(() => json(answers.shift() ?? usage(9, false)));
    const store = createStorageStore();
    await store.getState().load();
    expect(store.getState().usage?.bytes).toBe(1);
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS);
    expect(store.getState().usage?.bytes).toBe(2);
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS);
    expect(store.getState().usage).toMatchObject({ bytes: 3, measuring: false });
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS * 5);
    expect(sent()).toEqual(["GET /api/me/storage", "GET /api/me/storage", "GET /api/me/storage"]);
  });

  it("asks nothing more once the page is closed", async () => {
    fetch = stubFetch(() => json(usage(1, true)));
    const store = createStorageStore();
    await store.getState().load();
    store.getState().dispose();
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS * 5);
    expect(sent()).toEqual(["GET /api/me/storage"]);
  });

  it("asks the server to measure on Refresh, and an overtaken read does not land", async () => {
    let releaseRead!: () => void;
    const readHeld = new Promise<void>((resolve) => (releaseRead = resolve));
    fetch = stubFetch(async (request) => {
      if (request.path === "/api/me/storage/refresh") return json(usage(5, false));
      await readHeld;
      return json(usage(1, false));
    });
    const store = createStorageStore();
    const reading = store.getState().load();
    await store.getState().refresh();
    releaseRead();
    await reading;
    expect(store.getState().usage?.bytes).toBe(5);
    expect(sent()).toEqual(["GET /api/me/storage", "POST /api/me/storage/refresh"]);
  });

  it("keeps the numbers when a poll fails, and asks again later", async () => {
    const answers: (StorageUsage | null)[] = [usage(4, true), null, usage(6, false)];
    fetch = stubFetch(() => {
      const next = answers.shift();
      return next === null || next === undefined ? apiError(500, "internal") : json(next);
    });
    const errors: string[] = [];
    const store = createStorageStore((message) => errors.push(message));
    await store.getState().load();
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_MS);
    expect(store.getState().usage?.bytes).toBe(4);
    expect(errors).toEqual([]);
    await vi.advanceTimersByTimeAsync(STORAGE_POLL_RETRY_MS);
    expect(store.getState().usage).toMatchObject({ bytes: 6, measuring: false });
  });

  it("says why when the first read fails, with no numbers to show", async () => {
    fetch = stubFetch(() => apiError(500, "storage_unreadable", "disk unreadable"));
    const store = createStorageStore();
    await store.getState().load();
    expect(store.getState().usage).toBeNull();
    expect(store.getState().loadError).toContain("disk unreadable");
  });
});
