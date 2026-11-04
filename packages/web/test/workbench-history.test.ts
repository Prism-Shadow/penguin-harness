/** @vitest-environment jsdom */
/**
 * Given an empty 500, history shows a recoverable error instead of waiting forever.
 * When the user retries after service recovery, the saved versions replace that error.
 * Given a restore that listed the current revision twice, only its newest entry is marked
 * current and the older one can still be restored.
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

/** The Support tab's frame in English, its loaded revision `current`. */
async function frame(): Promise<void> {
  setActiveStrings(en);
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
}

it("retries a failed history request and displays saved versions", async () => {
  const requests = stubFetch(() => new Response("", { status: 500 }));
  await frame();
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
          commit: "0123456789ab",
          savedAt: "2026-10-14T00:00:00Z",
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

it("marks only the newest entry of a revision listed twice as current", async () => {
  const version = (revision: string, commit: string) => ({
    revision,
    commit,
    savedAt: "2026-10-14T00:00:00Z",
  });
  stubFetch(() =>
    json({
      versions: [
        version("current", "333333333333"),
        version("earlier", "222222222222"),
        version("current", "111111111111"),
      ],
    }),
  );
  await frame();
  await click(button(en.workbenches.history));
  const rows = [...document.querySelectorAll("li")].filter((li) =>
    li.textContent?.includes("current"),
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]!.textContent).toContain(en.workbenches.current);
  expect(rows[1]!.querySelector("button")?.textContent).toBe(en.workbenches.restore);
});
