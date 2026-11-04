/** @vitest-environment jsdom */
/**
 * Given an empty 500, history shows a recoverable error instead of waiting forever.
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
  // An empty body is carried as its status with a null body (serve.ts answerOnce), so this is
  // the server's status without an envelope: the generic failure, not a page/proxy message.
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(en.common.unknownError);
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
  // Two attempts by the page, one request each: an empty body rides the socket as its own
  // status with a null body (serve.ts answerOnce, simulated by test/helpers/carry.ts), so the
  // failed attempt is not fetched again over HTTP the way a 415 would be.
  expect(requests.requests.filter((request) => request.path.endsWith("/history"))).toHaveLength(2);
});
