/** @vitest-environment jsdom */
import { createElement as h } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../src/app";
import { WorkbenchAppPage } from "../src/features/workbenches/workbench-app-page";
import { addedPaletteActions } from "../src/lib/palette-actions";
import { json, stubFetch } from "./helpers/fetch";
import { mount, unmountAll } from "./helpers/dom";

const active = vi.hoisted(() => new Set<() => boolean | void>());
vi.mock("../src/lib/shortcuts/dispatcher", async (original) => {
  const actual = await original<typeof import("../src/lib/shortcuts/dispatcher")>();
  return {
    ...actual,
    onCommand: (id: Parameters<typeof actual.onCommand>[0], handler: () => boolean | void) => {
      if (id === "palette.toggle") active.add(handler);
      const off = actual.onCommand(id, handler);
      return () => {
        active.delete(handler);
        off();
      };
    },
  };
});
vi.mock("../src/api/sse", () => ({ openUserEvents: () => ({ close() {} }) }));

afterEach(async () => {
  await unmountAll();
  expect(active.size).toBe(0);
  expect(addedPaletteActions()).toEqual([]);
  vi.unstubAllGlobals();
});

it("registers a full-page exit with the root palette, never a second toggle handler", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  stubFetch(({ path }) =>
    path === "/api/me"
      ? json({ user: null })
      : path.endsWith("/workbenches")
        ? json({ workbenches: [] })
        : json({}),
  );
  function Root() {
    return h(
      MemoryRouter,
      { initialEntries: ["/app/p/a/board"] },
      h(
        Routes,
        null,
        h(Route, { path: "/app/:projectId/:agentId/:workbenchId", element: h(WorkbenchAppPage) }),
      ),
    );
  }
  await mount(h(App, { Root }));
  expect(active.size).toBe(1);
  expect(addedPaletteActions().map((a) => a.id)).toEqual(["exit-full-page"]);
});
