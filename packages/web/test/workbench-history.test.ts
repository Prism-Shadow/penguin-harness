/** @vitest-environment jsdom */
/**
 * Given an empty proxy 500, history shows a recoverable error instead of waiting forever.
 * When the user retries after service recovery, the saved versions replace that error.
 */
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { WorkbenchFrame } from "../src/features/workbenches/workbench-tabs";
import { ThemeProvider } from "../src/state/theme";
import { en } from "../src/lib/strings-en";
import { setActiveStrings, zh } from "../src/lib/strings";
import { stubFetch, json } from "./helpers/fetch";
import { button, click, mount, unmountAll } from "./helpers/dom";

afterEach(async () => {
  await unmountAll();
  setActiveStrings(zh);
});

it("retries a failed history request and displays saved versions", async () => {
  setActiveStrings(en);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const requests = stubFetch(() => new Response("", { status: 500 }));
  await mount(
    h(
      MemoryRouter,
      null,
      h(
        ThemeProvider,
        null,
        h(WorkbenchFrame, {
          projectId: "project",
          agentId: "agent",
          tab: {
            tabId: "support/main",
            workbenchId: "support",
            key: "main",
            title: "Support",
            src: "/support",
            machineId: null,
            name: "Support",
            version: null,
            revision: "current",
            uiRev: "ui",
            error: null,
          },
          onChanged() {},
          onRemoved() {},
        }),
      ),
    ),
  );
  await click(button(en.workbenches.history));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("500");
  expect(document.body.textContent).not.toContain(en.workbenches.loadingHistory);
  requests.answer(() =>
    json({
      versions: [
        {
          revision: "saved-revision",
          version: "1.0.0",
          savedAt: "2026-10-14T00:00:00Z",
          files: ["index.ts"],
        },
      ],
    }),
  );
  await click(button(en.workbenches.retryHistory));
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.body.textContent).toContain("saved-revision");
  expect(requests.requests.filter((request) => request.path.endsWith("/history"))).toHaveLength(2);
});
