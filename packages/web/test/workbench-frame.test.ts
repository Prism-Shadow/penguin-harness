/** @vitest-environment jsdom */
/**
 * A workbench page's frame grants pointer lock only to a page that asks for it
 * (`renderer.iframe.pointerLock`): an ordinary page's sandbox stays as it was.
 */
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { WorkbenchFrame } from "../src/features/workbenches/workbench-frame";
import { ThemeProvider } from "../src/state/theme";
import { mount, unmountAll } from "./helpers/dom";

afterEach(async () => {
  await unmountAll();
});

/** The Support page's frame. */
async function frame(pointerLock?: true): Promise<void> {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  await mount(
    h(
      MemoryRouter,
      null,
      h(
        ThemeProvider,
        null,
        h(WorkbenchFrame, {
          projectId: "project",
          tab: {
            tabId: "support/main",
            workbenchId: "support",
            key: "main",
            title: "Support",
            src: "/support",
            pointerLock,
            machineId: null,
            name: "Support",
            version: null,
            revision: "current",
            uiRev: "ui",
            error: null,
          },
        }),
      ),
    ),
  );
}

it("permits pointer lock only for a workbench tab that requests it", async () => {
  await frame();
  const flags = () => document.querySelector("iframe")!.getAttribute("sandbox")!.split(" ");
  const ordinary = flags();
  expect(ordinary).not.toContain("allow-pointer-lock");
  await unmountAll();
  await frame(true);
  expect(flags()).toEqual([...ordinary, "allow-pointer-lock"]);
});
