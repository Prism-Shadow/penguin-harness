// @vitest-environment jsdom
/**
 * The read store every per-machine read in the Web App shares (lib/read-store.ts): a machine's
 * Agent list, an Agent's installed plugins, a machine's modules. What it promises is that a
 * reader never sees a known value replaced by anything but a newer answer.
 *
 * - Given two readers of one key on screen at once, one request is made and both show its answer.
 * - Given a key invalidated while a read is in flight, the later read's answer stands, even when
 *   the earlier read answers after it.
 * - Given an answer a write already brought (`accept`) while a read is in flight, the read's late
 *   answer is dropped.
 * - Given a known value, a failed read keeps it and names the failure.
 * - Given an answer equal to the value held, the held object is kept.
 * - Given a value remembered in storage, a new store (a reload) has it at once, as not fresh, and
 *   each answer is remembered in its place.
 * - Given storage that refuses every call, or holds something that does not parse, it reads as
 *   nothing, and answers still apply.
 * - Given a forget, the remembered value is cleared and a read still in flight lands nowhere; a
 *   sweep by a machine's prefix leaves a machine whose id merely starts the same.
 * - Given a reader (`useRead`): it reads on mount, not again on a remount within `minAgeMs`, and
 *   again once the answer is older; never while `enabled` is false, and once it turns true; again
 *   when the key is invalidated, the value standing meanwhile.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { ApiError } from "../src/api/client";
import { createReadStore, readKey, useRead } from "../src/lib/read-store";
import type { ReadStorage, ReadStore } from "../src/lib/read-store";
import { mount, run, settle, unmountAll } from "./helpers/dom";
import { blockedStorage, memoryStorage } from "./helpers/storage";

type Rows = string[];

const KEY = readKey("proj", "gpu1", "agents");

/** A read's far end: every ask waits until the test answers it, and is counted. */
function farEnd() {
  const asks: Array<{ resolve: (rows: Rows) => void; reject: (err: unknown) => void }> = [];
  return {
    run: () =>
      new Promise<Rows>((resolve, reject) => {
        asks.push({ resolve, reject });
      }),
    get count() {
      return asks.length;
    },
    /** Answers ask `i` (by default the newest) and lets the answer land. */
    answer: async (rows: Rows, i?: number) => {
      await settle();
      asks[i ?? asks.length - 1]!.resolve(rows);
      await settle();
    },
    fail: async (err: unknown, i?: number) => {
      await settle();
      asks[i ?? asks.length - 1]!.reject(err);
      await settle();
    },
  };
}

/** The store's storage over a browser `Storage`, the way a module backs it with `localStorage`. */
const storageOver = (backing: Storage): ReadStorage<Rows> => ({
  load: (key) => {
    const raw = backing.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as Rows);
  },
  save: (key, rows) => backing.setItem(key, JSON.stringify(rows)),
  clear: (key) => backing.removeItem(key),
});

/** A reader on screen: the key's value as text, "—" while nothing is known. */
function Reader({
  store,
  readerKey,
  read,
  enabled,
}: {
  store: ReadStore<Rows>;
  readerKey: string;
  read: () => Promise<Rows>;
  enabled?: boolean;
}) {
  const state = useRead(store, readerKey, read, enabled === undefined ? {} : { enabled });
  return h("p", null, state.value === null ? "—" : state.value.join(","));
}

const reader = (store: ReadStore<Rows>, read: () => Promise<Rows>, enabled?: boolean) =>
  h(Reader, { store, readerKey: KEY, read, ...(enabled === undefined ? {} : { enabled }) });

afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
});

describe("the read store", () => {
  it("makes one request for two readers of one key, and both show its answer", async () => {
    const store = createReadStore<Rows>();
    const far = farEnd();
    const first = await mount(reader(store, far.run));
    const second = await mount(reader(store, far.run));
    await settle();
    expect(far.count).toBe(1);
    await far.answer(["helper"]);
    expect(first.container.textContent).toBe("helper");
    expect(second.container.textContent).toBe("helper");
  });

  it("keeps the later read's answer when an earlier one, asked before an invalidation, lands after it", async () => {
    const store = createReadStore<Rows>();
    const far = farEnd();
    void store.read(KEY, far.run);
    store.invalidate(KEY);
    void store.read(KEY, far.run);
    await settle();
    expect(far.count).toBe(2);
    await far.answer(["after the delete"], 1);
    await far.answer(["before the delete"], 0);
    expect(store.get(KEY).value).toEqual(["after the delete"]);
    expect(store.get(KEY).stale).toBe(false);
  });

  it("drops a read's late answer once a write brought its own", async () => {
    const store = createReadStore<Rows>();
    const far = farEnd();
    void store.read(KEY, far.run);
    await settle();
    store.accept(KEY, ["installed"]);
    await far.answer(["not yet installed"]);
    expect(store.get(KEY)).toMatchObject({ value: ["installed"], fresh: true, reading: false });
  });

  it("keeps the value when a read fails, and names the failure", async () => {
    const store = createReadStore<Rows>();
    const far = farEnd();
    void store.read(KEY, far.run);
    await far.answer(["helper"]);
    const known = store.get(KEY).value;
    store.invalidate(KEY);
    void store.read(KEY, far.run);
    await far.fail(new ApiError(502, "machine_gone_quiet", "gpu-box did not answer"));
    expect(store.get(KEY)).toMatchObject({ error: "gpu-box did not answer", reading: false });
    expect(store.get(KEY).value).toBe(known);
  });

  it("keeps the object it holds when an answer carries the same data", async () => {
    const store = createReadStore<Rows>();
    const far = farEnd();
    void store.read(KEY, far.run);
    await far.answer(["helper", "trainer"]);
    const held = store.get(KEY).value;
    store.invalidate(KEY);
    void store.read(KEY, far.run);
    await far.answer(["helper", "trainer"]);
    expect(store.get(KEY).value).toBe(held);
  });

  it("starts a reloaded page from the remembered value, not fresh, and remembers each answer", async () => {
    const backing = memoryStorage();
    const before = createReadStore<Rows>({ storage: storageOver(backing) });
    const far = farEnd();
    void before.read(KEY, far.run);
    await far.answer(["helper"]);

    const reloaded = createReadStore<Rows>({ storage: storageOver(backing) });
    expect(reloaded.get(KEY)).toMatchObject({ value: ["helper"], fresh: false, at: null });
    void reloaded.read(KEY, far.run);
    await far.answer(["helper", "trainer"]);
    expect(reloaded.get(KEY)).toMatchObject({ value: ["helper", "trainer"], fresh: true });
    expect(createReadStore<Rows>({ storage: storageOver(backing) }).get(KEY).value).toEqual([
      "helper",
      "trainer",
    ]);
  });

  it.each([
    ["refuses every call", () => blockedStorage()],
    ["holds what does not parse", () => memoryStorage({ [KEY]: "[not json" })],
  ])("reads storage that %s as nothing, and still applies answers", async (_, backing) => {
    const store = createReadStore<Rows>({ storage: storageOver(backing()) });
    expect(store.get(KEY).value).toBeNull();
    const far = farEnd();
    void store.read(KEY, far.run);
    await far.answer(["helper"]);
    expect(store.get(KEY).value).toEqual(["helper"]);
  });

  it("clears what a forgotten key remembered, drops its read in flight, and sweeps only under the prefix", async () => {
    const backing = memoryStorage();
    const store = createReadStore<Rows>({ storage: storageOver(backing) });
    const neighbour = readKey("proj", "gpu10", "agents");
    store.accept(neighbour, ["kept"]);
    const far = farEnd();
    store.accept(KEY, ["helper"]);
    void store.read(readKey("proj", "gpu1", "installs", "helper"), far.run);
    await settle();

    for (const key of store.keys(readKey("proj", "gpu1"))) store.forget(key);
    await far.answer(["late"]);

    expect(store.get(KEY).value).toBeNull();
    expect(store.get(readKey("proj", "gpu1", "installs", "helper")).value).toBeNull();
    expect(backing.getItem(KEY)).toBeNull();
    expect(store.get(neighbour).value).toEqual(["kept"]);
  });
});

describe("a reader of the store", () => {
  it("reads on mount, not again on a remount within minAgeMs, and again once the answer is older", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
    const store = createReadStore<Rows>();
    const far = farEnd();
    const first = await mount(reader(store, far.run));
    await far.answer(["helper"]);
    await first.unmount();

    // Back within a second: the answer stands, and the machine is not asked again.
    vi.setSystemTime(new Date("2026-10-22T10:00:01Z"));
    const second = await mount(reader(store, far.run));
    await settle();
    expect(second.container.textContent).toBe("helper");
    expect(far.count).toBe(1);
    await second.unmount();

    // Back a minute later: the answer shows at once, and is read again behind it.
    vi.setSystemTime(new Date("2026-10-22T10:01:00Z"));
    const third = await mount(reader(store, far.run));
    await settle();
    expect(third.container.textContent).toBe("helper");
    expect(far.count).toBe(2);
  });

  it("never reads while disabled, and reads once enabled", async () => {
    const store = createReadStore<Rows>();
    const far = farEnd();
    const mounted = await mount(reader(store, far.run, false));
    await settle();
    expect(far.count).toBe(0);
    expect(mounted.container.textContent).toBe("—");

    await mounted.rerender(reader(store, far.run, true));
    await settle();
    expect(far.count).toBe(1);
    await far.answer(["helper"]);
    expect(mounted.container.textContent).toBe("helper");
  });

  it("reads again when the key is invalidated, the value standing until the answer", async () => {
    const store = createReadStore<Rows>();
    const far = farEnd();
    const mounted = await mount(reader(store, far.run));
    await far.answer(["helper"]);

    await run(() => store.invalidate(KEY));
    expect(far.count).toBe(2);
    expect(mounted.container.textContent).toBe("helper");
    await far.answer(["helper", "trainer"]);
    expect(mounted.container.textContent).toBe("helper,trainer");
  });
});
