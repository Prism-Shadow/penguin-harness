/** @vitest-environment jsdom */
/**
 * A workbench page's frame grants pointer lock only to a page that asks for it
 * (`renderer.iframe.pointerLock`): an ordinary page's sandbox stays as it was.
 * A visible local page can open its Project's Models. Other origins, unrelated frames,
 * background workbenches and workbenches on another machine cannot navigate the host.
 */
import { createElement as h } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AppWindow } from "@prismshadow/penguin-ui";
import { WorkbenchFrame } from "../src/features/workbenches/workbench-frame";
import { ThemeProvider } from "../src/state/theme";
import { mount, run, unmountAll } from "./helpers/dom";

afterEach(async () => {
  await unmountAll();
});

/** The Support page's frame. */
function Location() {
  return h("output", null, useLocation().pathname);
}

async function frame(
  pointerLock?: true,
  machineId: string | null = null,
  shown = true,
): Promise<void> {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  await mount(
    h(
      MemoryRouter,
      null,
      h(Location),
      h(
        ThemeProvider,
        null,
        h(AppWindow, {
          shown,
          children: h(WorkbenchFrame, {
            projectId: "project",
            tab: {
              tabId: "support/main",
              workbenchId: "support",
              key: "main",
              title: "Support",
              src: "/support",
              pointerLock,
              machineId,
              name: "Support",
              version: null,
              revision: "current",
              uiRev: "ui",
              error: null,
            },
          }),
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

function openSettings(source: Window, origin = window.location.origin) {
  return run(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source,
        origin,
        data: { type: "penguin:open-model-settings", id: "setup" },
      }),
    ),
  );
}

it("only the visible local frame opens Models for its Project", async () => {
  await frame();
  const source = document.querySelector("iframe")!.contentWindow!;
  const page = () => document.querySelector("output")!.textContent;
  await openSettings(window);
  await openSettings(source, "https://outside.example");
  expect(page()).toBe("/");
  await openSettings(source);
  expect(page()).toBe("/models");
  expect(localStorage.getItem("penguin.lastProjectId")).toBe("project");
});

it.each([
  ["background", null, false],
  ["remote", "machine", true],
] as const)(
  "a %s workbench receives a refusal and stays on its page",
  async (_kind, machine, shown) => {
    await frame(undefined, machine, shown);
    const source = document.querySelector("iframe")!.contentWindow!;
    const reply = vi.spyOn(source, "postMessage");
    await openSettings(source);
    expect(document.querySelector("output")!.textContent).toBe("/");
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "setup", error: expect.any(String) }),
      "*",
    );
  },
);
