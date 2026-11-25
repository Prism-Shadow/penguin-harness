// @vitest-environment jsdom
/**
 * The start page's app menus read the Project's apps (features/chat/use-project-apps.ts).
 *
 * - Given the first read has not answered, then there is no list yet: the menu shows it as
 *   loading, never as "no apps".
 * - Given a list is shown, when a burst of workbench news makes the page read again and that read
 *   fails, then the burst is one read and the list stays.
 */
import { afterEach, expect, it } from "vitest";
import { createElement as h } from "react";
import type { AppCenterShortcut } from "@prismshadow/penguin-server/api";
import { useProjectApps } from "@prismshadow/penguin-library-session/web";
import { WORKBENCH_NEWS_SETTLE_MS, WORKBENCH_UPDATED_EVENT } from "../src/lib/workbench-tabs";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { mount, run, settle, unmountAll } from "./helpers/dom";

const app = (agentId: string, workbenchId: string): AppCenterShortcut => ({
  agentId,
  agentName: agentId,
  workbenchId,
  title: workbenchId,
  path: `/app/p1/${agentId}/${workbenchId}`,
  build: "ready",
});

afterEach(async () => {
  await unmountAll();
});

it("shows loading until the first answer, then keeps the list when a later read fails", async () => {
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  let down = false;
  const fetch = stubFetch(async (request) => {
    if (request.path !== "/api/projects/p1/app-center") return apiError(404, "not_found");
    await answered;
    if (down) return apiError(503, "unavailable");
    return json({ shortcuts: [app("system_agent", "settings"), app("default_agent", "desk")] });
  });
  function Probe() {
    const { apps, error } = useProjectApps("p1", null);
    const shown = apps?.map((item) => item.workbenchId).join(",");
    return h("p", null, shown ?? (error === null ? "loading" : "failed"));
  }
  const view = await mount(h(Probe));
  expect(view.container.textContent).toBe("loading");
  answer();
  await settle();
  expect(view.container.textContent).toBe("desk");

  down = true;
  const news = () =>
    window.dispatchEvent(
      new CustomEvent(WORKBENCH_UPDATED_EVENT, {
        detail: { projectId: "p1", agentId: "default_agent" },
      }),
    );
  await run(() => {
    news();
    news();
  });
  await run(() => new Promise((resolve) => setTimeout(resolve, WORKBENCH_NEWS_SETTLE_MS + 50)));
  await settle();
  expect(fetch.requests).toHaveLength(2);
  expect(view.container.textContent).toBe("desk");
});
