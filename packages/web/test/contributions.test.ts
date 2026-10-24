/**
 * The server's contributions folded into WebApp's page table (web-app/contributions.tsx).
 *
 * - The store asks once per signed-in user; a failure leaves no answer, so the table is the
 *   compiled one; a user change drops the last answer and asks again, and a late answer for
 *   the user just left is dropped; signing out clears it. A refresh asks again for the same
 *   user; its failure keeps what was held.
 * - The merge appends iframe pages after the compiled ones; a compiled page wins a key or
 *   path clash; a builtin page is drawn by the renderer a module contributed under its name
 *   (`WebAppModule.pageRenderers`) and skipped when there is none; an entry without a key, a
 *   path or a renderer is skipped.
 * - A company-mode page (`nav: "org"`) keeps a path relative to the organization and clashes
 *   as the rooted one; `released` and the renderer it named are kept; `orgPagesOf` selects
 *   these pages from the table.
 * - A merged iframe page is routed at its path and draws a sandboxed frame of its src.
 */
import { createElement, type ComponentType } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";
import { describe, expect, it, vi } from "vitest";
import { contributedPagesOf, createContributionsStore } from "../src/web-app/contributions";
import type { WebAppPage } from "../src/web-app";
import { ThemeProvider } from "../src/state/theme";
import { orgPagesOf } from "../src/features/company/use-org-pages";

const Blank: ComponentType = () => null;

const COMPILED: WebAppPage[] = [
  {
    id: "agents.page",
    key: "agents",
    path: "/agents",
    frame: "shell",
    nav: "main",
    admin: false,
    released: true,
    order: 20,
    Component: Blank,
  },
  {
    id: "terminal.page",
    key: "terminal",
    path: "/terminal",
    frame: "bare",
    nav: "none",
    admin: false,
    released: true,
    order: 100,
    Component: Blank,
  },
];

/** No module contributed a page renderer. */
const NONE: ReadonlyMap<string, ComponentType> = new Map();

const frame = (src: string) => ({ iframe: { src, namespace: "hello" } });

function answer(pages: ContributionsResponse["pages"]): ContributionsResponse {
  return { pages, agentTabs: [], sessionTabs: [] };
}

/** A fetch whose answers the test hands out by hand, in order. */
function manualFetch() {
  const calls: Array<{ resolve: (r: ContributionsResponse) => void; reject: (e: Error) => void }> =
    [];
  const fetch = vi.fn(
    () => new Promise<ContributionsResponse>((resolve, reject) => calls.push({ resolve, reject })),
  );
  return { fetch, calls };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("createContributionsStore", () => {
  it("asks once per signed-in user and holds the answer", async () => {
    const { fetch, calls } = manualFetch();
    const store = createContributionsStore(fetch);
    const seen = vi.fn();
    store.subscribe(seen);
    store.setUser("alice");
    store.setUser("alice");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.current()).toEqual({ user: "alice", answer: null, pending: true });
    const res = answer([{ id: "x.hello", from: "x", key: "hello" }]);
    calls[0]!.resolve(res);
    await settle();
    expect(store.current()).toEqual({ user: "alice", answer: res, pending: false });
    expect(seen).toHaveBeenCalled();
  });

  it("a failed request leaves no answer, so the table is the compiled one", async () => {
    const { fetch, calls } = manualFetch();
    const store = createContributionsStore(fetch);
    store.setUser("alice");
    calls[0]!.reject(new Error("500"));
    await settle();
    expect(store.current()).toEqual({ user: "alice", answer: null, pending: false });
    expect(contributedPagesOf(COMPILED, store.current().answer, NONE)).toBe(COMPILED);
  });

  it("a user change drops the last answer and asks again; a late answer for the old user is dropped", async () => {
    const { fetch, calls } = manualFetch();
    const store = createContributionsStore(fetch);
    store.setUser("alice");
    calls[0]!.resolve(answer([{ id: "a", from: "x", key: "a" }]));
    await settle();
    store.setUser("bob");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.current()).toEqual({ user: "bob", answer: null, pending: true });

    store.setUser("carol");
    calls[1]!.resolve(answer([{ id: "b", from: "x", key: "b" }]));
    await settle();
    expect(store.current()).toEqual({ user: "carol", answer: null, pending: true });

    store.setUser(null);
    expect(store.current()).toEqual({ user: null, answer: null, pending: false });
    calls[2]!.resolve(answer([]));
    await settle();
    expect(store.current().answer).toBeNull();
  });
});

describe("refresh", () => {
  it("asks again for the signed-in user and answers the new response; a failure keeps the old answer", async () => {
    const { fetch, calls } = manualFetch();
    const store = createContributionsStore(fetch);
    expect(await store.refresh()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    store.setUser("alice");
    const first = answer([]);
    calls[0]!.resolve(first);
    await settle();
    const asked = store.refresh();
    const next = answer([{ id: "x.hello", from: "x", key: "hello" }]);
    calls[1]!.resolve(next);
    expect(await asked).toBe(next);
    expect(store.current()).toEqual({ user: "alice", answer: next, pending: false });
    const failed = store.refresh();
    calls[2]!.reject(new Error("500"));
    expect(await failed).toBeNull();
    expect(store.current()).toEqual({ user: "alice", answer: next, pending: false });
  });

  it("a refresh during the first request supersedes it, and its failure ends the wait", async () => {
    const { fetch, calls } = manualFetch();
    const store = createContributionsStore(fetch);
    store.setUser("alice");
    const asked = store.refresh();
    calls[0]!.resolve(answer([{ id: "old", from: "x", key: "old" }]));
    calls[1]!.reject(new Error("500"));
    expect(await asked).toBeNull();
    expect(store.current()).toEqual({ user: "alice", answer: null, pending: false });
  });
});

describe("contributedPagesOf", () => {
  it("returns the compiled table as it is without an answer", () => {
    expect(contributedPagesOf(COMPILED, null, NONE)).toBe(COMPILED);
    expect(contributedPagesOf(COMPILED, answer([]), NONE)).toBe(COMPILED);
  });

  it("appends an iframe page after the compiled ones, inside the shell", () => {
    const merged = contributedPagesOf(
      COMPILED,
      answer([
        {
          id: "hello.page",
          from: "HelloModule",
          key: "hello",
          path: "/hello",
          nav: "main",
          admin: false,
          renderer: frame("/hello.html"),
        },
      ]),
      NONE,
    );
    expect(merged.slice(0, 2)).toEqual(COMPILED);
    expect(merged[2]).toMatchObject({
      id: "hello.page",
      key: "hello",
      path: "/hello",
      frame: "shell",
      nav: "main",
      admin: false,
      released: true,
      order: 101,
    });
  });

  it("a compiled page wins a key or a path clash, and the first of two contributed ones wins", () => {
    const merged = contributedPagesOf(
      COMPILED,
      answer([
        { id: "a", from: "x", key: "agents", path: "/elsewhere", renderer: frame("/a.html") },
        { id: "b", from: "x", key: "mine", path: "/terminal", renderer: frame("/b.html") },
        { id: "c", from: "x", key: "login", path: "/login", renderer: frame("/c.html") },
        { id: "d", from: "x", key: "d", path: "/d", renderer: frame("/d.html") },
        { id: "e", from: "x", key: "d", path: "/e", renderer: frame("/e.html") },
      ]),
      NONE,
    );
    expect(merged.map((p) => p.id)).toEqual(["agents.page", "terminal.page", "d"]);
  });

  it("draws a builtin page with the renderer a module contributed under its name", () => {
    const Proposals: ComponentType = () => null;
    const merged = contributedPagesOf(
      COMPILED,
      answer([
        { id: "a", from: "x", key: "a", path: "/a", renderer: { builtin: "Proposals" } },
        { id: "b", from: "x", key: "b", path: "/b", renderer: { builtin: "Unknown" } },
      ]),
      new Map([["Proposals", Proposals]]),
    );
    expect(merged.map((p) => p.id)).toEqual(["agents.page", "terminal.page", "a"]);
    expect(merged[2]!.Component).toBe(Proposals);
  });

  it("skips a builtin renderer nobody contributed, and an entry without a key, a path or an iframe src", () => {
    const merged = contributedPagesOf(
      COMPILED,
      answer([
        { id: "a", from: "x", key: "a", path: "/a", renderer: { builtin: "AgentsPage" } },
        { id: "b", from: "x", path: "/b", renderer: frame("/b.html") },
        { id: "c", from: "x", key: "c", renderer: frame("/c.html") },
        { id: "d", from: "x", key: "d", path: "d", renderer: frame("/d.html") },
        { id: "e", from: "x", key: "e", path: "/e", renderer: { iframe: { namespace: "e" } } },
        { id: "f", from: "x", key: "f", path: "/f" },
      ]),
      NONE,
    );
    expect(merged.map((p) => p.id)).toEqual(["agents.page", "terminal.page"]);
  });

  it("keeps a company-mode page's path relative to the organization, clashing as the rooted one", () => {
    const merged = contributedPagesOf(
      COMPILED,
      answer([
        { id: "a", from: "x", key: "a", path: "/roadmaps", nav: "org", renderer: frame("/r") },
        { id: "b", from: "x", key: "b", path: "agents", nav: "org", renderer: frame("/b") },
        { id: "c", from: "x", key: "c", path: "roadmaps", nav: "org", renderer: frame("/c") },
        { id: "d", from: "x", key: "d", path: "/", nav: "org", renderer: frame("/d") },
        {
          id: "e",
          from: "x",
          key: "e",
          path: "later",
          nav: "org",
          released: false,
          renderer: frame("/e"),
        },
      ]),
      NONE,
    );
    expect(merged.slice(2)).toMatchObject([
      { id: "a", path: "roadmaps", nav: "org", released: true, renderer: frame("/r") },
      { id: "e", path: "later", nav: "org", released: false },
    ]);
  });

  it("routes an iframe page at its path and draws a sandboxed frame of its src", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    const merged = contributedPagesOf(
      COMPILED,
      answer([
        {
          id: "hello.page",
          from: "HelloModule",
          key: "hello",
          path: "/hello",
          nav: "none",
          admin: false,
          renderer: frame("/plugins/hello/index.html"),
        },
      ]),
      NONE,
    );
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(
          MemoryRouter,
          { initialEntries: ["/hello"] },
          createElement(
            Routes,
            null,
            merged.map(({ id, path, Component }) =>
              createElement(Route, { key: id, path, element: createElement(Component) }),
            ),
          ),
        ),
      ),
    );
    expect(html).toContain('src="/plugins/hello/index.html"');
    expect(html).toContain('title="hello"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin');
  });
});

describe("orgPagesOf", () => {
  it("selects the server's company-mode pages from the table, in table order", () => {
    const merged = contributedPagesOf(
      COMPILED,
      answer([
        { id: "a", from: "x", key: "a", path: "/a", nav: "main", renderer: frame("/a") },
        { id: "b", from: "x", key: "b", path: "b", nav: "org", renderer: frame("/b") },
        { id: "c", from: "x", key: "c", path: "c", nav: "org", renderer: { builtin: "P" } },
      ]),
      new Map([["P", Blank]]),
    );
    expect(orgPagesOf(merged).map((p) => p.id)).toEqual(["b", "c"]);
    expect(orgPagesOf(COMPILED)).toEqual([]);
  });
});
