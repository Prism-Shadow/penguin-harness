/** @vitest-environment jsdom */
/**
 * The server's word on which plugin server modules run, from `GET /api/contributions` to what a
 * gated web half draws (web-app/contributions.tsx, web-app/running-modules.ts,
 * lib/module-gate.ts). The web half here is one component of a module that declared the server
 * module `BoardServer`.
 *
 * - Given the server answers that `BoardServer` runs, the gated part is drawn; when the server
 *   says its contributions changed (a re-assembly) and now answers without it, the part goes —
 *   and a lost-events resync asks again the same way.
 * - Given this browser saw `BoardServer` running for this viewer last time, the part is drawn
 *   before the server has answered; for another viewer it is not.
 * - A read that fails does not stay failed: it is asked again after its wait, a longer one each
 *   time, and the answer that lands opens the gate. A newer ask replaces a pending retry.
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";
import { createContributionsStore, WebAppPagesProvider } from "../src/web-app/contributions";
import { webAppDeps, type WebAppDeps } from "../src/web-app/deps";
import { gatedComponent, setServerModuleGates } from "../src/lib/module-gate";
import { publishUserEvent } from "../src/lib/amsp/user-events";
import { mount, settle, unmountAll, waitFor } from "./helpers/dom";
import { json, stubFetch } from "./helpers/fetch";

const viewer = vi.hoisted(() => ({ userId: "bob" }));
vi.mock("../src/state/auth", () => ({ useAuth: () => ({ user: { userId: viewer.userId } }) }));

const BoardPart = gatedComponent("BoardWebModule", () => createElement("p", null, "board part"));

/** The provider around the gated part, with an otherwise empty shell. */
const App = webAppDeps.provide(
  {
    pages: [],
    pageRenderers: new Map(),
    sessionProviders: [],
    layers: [],
    userEvents: [],
  } as unknown as WebAppDeps,
  () => createElement(WebAppPagesProvider, null, createElement(BoardPart)),
);

const answer = (modules: string[]): ContributionsResponse => ({
  pages: [],
  fileRenderers: [],
  pageRemovals: [],
  agentTabs: [],
  sessionTabs: [],
  modules,
});

const drawn = () => document.body.textContent?.includes("board part") ?? false;

beforeEach(() => {
  viewer.userId = "bob";
  localStorage.clear();
  setServerModuleGates(new Map([["BoardWebModule", ["BoardServer"]]]));
});

afterEach(async () => {
  await unmountAll();
});

describe("the gate, from the server's answer to the screen", () => {
  it("draws the part while the server runs its module, and follows a re-assembly", async () => {
    let running = ["BoardServer"];
    const fetch = stubFetch(() => json(answer(running)));
    await mount(createElement(App));
    await waitFor(drawn);

    running = [];
    publishUserEvent({ type: "contributions_changed" });
    await waitFor(() => !drawn());

    running = ["BoardServer"];
    publishUserEvent({ type: "resync_required" });
    await waitFor(drawn);
    expect(fetch.requests.filter((r) => r.path === "/api/contributions")).toHaveLength(3);
  });

  it("draws what this viewer saw last time before the server answers, and nothing for another viewer", async () => {
    stubFetch(() => new Promise<Response>(() => {}));
    localStorage.setItem("penguin.serverModules.bob", JSON.stringify(["BoardServer"]));
    await mount(createElement(App));
    expect(drawn()).toBe(true);
    await unmountAll();

    viewer.userId = "carol";
    await mount(createElement(App));
    await settle();
    expect(drawn()).toBe(false);
  });
});

describe("a failed read", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is asked again after a growing wait, until an answer lands", async () => {
    vi.useFakeTimers();
    const replies: Array<() => Promise<ContributionsResponse>> = [
      () => Promise.reject(new Error("offline")),
      () => Promise.reject(new Error("offline")),
      () => Promise.resolve(answer(["BoardServer"])),
    ];
    const fetch = vi.fn(() => replies.shift()!());
    const store = createContributionsStore(fetch, [1_000, 2_000]);
    store.setUser("bob");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(store.current()).toMatchObject({ user: "bob", pending: false });
    expect(store.current().answer?.modules).toEqual(["BoardServer"]);
  });

  it("is not retried once a newer ask has replaced it", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<() => Promise<ContributionsResponse>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(answer([]));
    const store = createContributionsStore(fetch, [1_000]);
    store.setUser("bob");
    await vi.advanceTimersByTimeAsync(0);
    await store.refresh();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
