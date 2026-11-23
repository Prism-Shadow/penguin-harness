/** @vitest-environment jsdom */
/**
 * The install face of a workbench's full-page route (`useInstallManifest`): while the page is
 * mounted the document's manifest link names the page's own manifest — the tab's, or the
 * workbench's when no tab key is in the route, a remote machine's with the machine query —
 * and on unmount the main app's literal link (`/manifest.webmanifest`) is restored. The
 * restore is the literal even when the page ARRIVED already rewritten (a direct hit on the
 * server-rewritten HTML): the arrival href is a workbench manifest, and keeping it would
 * leave the install surface on the workbench after the page is gone.
 */
import { createElement as h } from "react";
import { afterEach, expect, it } from "vitest";
import { useInstallManifest } from "../src/lib/workbench-tabs";
import { mount, unmountAll } from "./helpers/dom";

const manifestHref = () =>
  document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute("href") ?? null;

function setPageLink(href: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link === null) {
    link = document.createElement("link");
    link.rel = "manifest";
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

function Page(props: {
  tabKey?: string;
  machineId?: string | null;
  /** The href the link carries before the page mounts (what a rewrite would have left). */
  arriveAs?: string;
}) {
  if (props.arriveAs !== undefined) setPageLink(props.arriveAs);
  useInstallManifest("p", "a", "demo", props.tabKey, props.machineId ?? null);
  return h("div", null, "page");
}

afterEach(unmountAll);

it("names the tab's manifest while mounted, the workbench's without a tab key", async () => {
  setPageLink("/manifest.webmanifest");
  const page = await mount(h(Page, { tabKey: "board" }));
  expect(manifestHref()).toBe(
    "/api/projects/p/agents/a/workbenches/demo/tabs/board/manifest.webmanifest",
  );
  await page.rerender(h(Page, {}));
  // No tab key in the route: the workbench's own manifest (the first tab's face).
  expect(manifestHref()).toBe("/api/projects/p/agents/a/workbenches/demo/manifest.webmanifest");
});

it("adds the machine query for a remote machine's workbench", async () => {
  const page = await mount(h(Page, { tabKey: "board", machineId: "m-1" }));
  expect(manifestHref()).toBe(
    "/api/projects/p/agents/a/workbenches/demo/tabs/board/manifest.webmanifest?machine=m-1",
  );
  await page.rerender(h(Page, { tabKey: "board" }));
  expect(manifestHref()).toBe(
    "/api/projects/p/agents/a/workbenches/demo/tabs/board/manifest.webmanifest",
  );
});

it("restores the main app's literal link on unmount, even on a page that arrived rewritten", async () => {
  // Direct hit on the server-rewritten HTML: the arrival href IS the workbench manifest.
  const page = await mount(
    h(Page, {
      tabKey: "board",
      arriveAs: "/api/projects/p/agents/a/workbenches/demo/tabs/board/manifest.webmanifest",
    }),
  );
  // The arrival href is already the target; the link is left as it is — and the cleanup
  // still restores the MAIN app's link, not the arrival one.
  expect(manifestHref()).toBe(
    "/api/projects/p/agents/a/workbenches/demo/tabs/board/manifest.webmanifest",
  );
  await page.unmount();
  expect(manifestHref()).toBe("/manifest.webmanifest");
});

it("restores the main link after leaving a page that arrived unrewritten (a pushed web)", async () => {
  const page = await mount(h(Page, { tabKey: "board", arriveAs: "/manifest.webmanifest" }));
  expect(manifestHref()).toBe(
    "/api/projects/p/agents/a/workbenches/demo/tabs/board/manifest.webmanifest",
  );
  await page.unmount();
  expect(manifestHref()).toBe("/manifest.webmanifest");
});
