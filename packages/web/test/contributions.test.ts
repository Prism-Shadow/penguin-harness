/**
 * The server's contributions folded into WebApp's page table (web-app/contributions.tsx).
 *
 * - The store asks once per signed-in user; a failure leaves no answer, so the table is the
 *   compiled one; a user change drops the last answer and asks again, and a late answer for
 *   the user just left is dropped; signing out clears it.
 * - The merge appends iframe pages after the compiled ones; a compiled page wins a key or
 *   path clash; a builtin renderer is skipped (this build carries none); an entry without a
 *   key, a path or an iframe src is skipped.
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
    expect(contributedPagesOf(COMPILED, store.current().answer)).toBe(COMPILED);
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

describe("contributedPagesOf", () => {
  it("returns the compiled table as it is without an answer", () => {
    expect(contributedPagesOf(COMPILED, null)).toBe(COMPILED);
    expect(contributedPagesOf(COMPILED, answer([]))).toBe(COMPILED);
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
    );
    expect(merged.map((p) => p.id)).toEqual(["agents.page", "terminal.page", "d"]);
  });

  it("skips a builtin renderer, and an entry without a key, a path or an iframe src", () => {
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
    );
    expect(merged.map((p) => p.id)).toEqual(["agents.page", "terminal.page"]);
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
