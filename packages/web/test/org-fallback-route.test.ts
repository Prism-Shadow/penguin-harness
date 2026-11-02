// @vitest-environment jsdom
/**
 * The organization layout's catch-all (router.tsx, `OrgFallbackRedirect`): an address under
 * `/org/<projectId>/<orgId>` that no page claims — an old link, a bookmark, a typo — opens that
 * organization's overview.
 *
 * The target is absolute on purpose. A relative `overview` is appended to whatever went
 * unmatched, so `/org/proj/org/garbage` became `/org/proj/org/garbage/overview`, and the layout
 * remounted with another `/overview` on every pass. These cases pin the three things that keeps
 * broken:
 *
 * - the layout's wildcard child is the component that reads the route's ids, not a bare redirect;
 * - an unknown address lands on exactly `/org/proj/org/overview` and stays there;
 * - a page's own path (tickets) is left alone and still renders.
 *
 * The pages and the shell around them are stood in for: the fallback is what is under test, and
 * the real organization pages need the whole signed-in app (their own suites cover them).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement as h, useRef } from "react";
import { Navigate, Outlet, RouterProvider, createMemoryRouter, useLocation } from "react-router";
import { OrgFallbackRedirect, appRoutes } from "../src/router";
import { mount, settle, unmountAll } from "./helpers/dom";

/**
 * A fallback that keeps appending navigates without ever settling, so a suite that waits for the
 * address would hang instead of failing. This stand-in layout bounds the renders and turns that
 * loop into one failure that names the paths it walked.
 */
function OrgLayoutStub() {
  const location = useLocation();
  const seen = useRef<string[]>([]);
  seen.current.push(location.pathname);
  if (seen.current.length > 10) {
    throw new Error(`the organization fallback kept navigating: ${seen.current.join(" -> ")}`);
  }
  return h(Outlet);
}

/** The organization layout's own routes around its wildcard child, and the address it opens on. */
function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/org/:projectId/:orgId",
        element: h(OrgLayoutStub),
        children: [
          { index: true, element: h(Navigate, { to: "overview", replace: true }) },
          { path: "overview", element: h("p", null, "the overview") },
          { path: "tickets", element: h("p", null, "the tickets page") },
          { path: "*", element: h(OrgFallbackRedirect) },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  return { router, mounted: mount(h(RouterProvider, { router })) };
}

const where = (router: ReturnType<typeof createMemoryRouter>) => router.state.location.pathname;

/** The router's own tree, for the one assertion that is about wiring rather than rendering. */
interface RouteNode {
  path?: string;
  element?: { type?: unknown };
  children?: RouteNode[];
}

function routeAt(routes: RouteNode[], path: string): RouteNode | undefined {
  for (const route of routes) {
    if (route.path === path) return route;
    const hit = route.children === undefined ? undefined : routeAt(route.children, path);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

afterEach(unmountAll);

describe("the organization layout's catch-all", () => {
  it("is the component the layout mounts on its wildcard child", () => {
    // The router's real tree: the wildcard child is the id-reading component, not the bare
    // relative redirect that appended /overview to whatever it did not match.
    const org = routeAt(appRoutes() as unknown as RouteNode[], "/org/:projectId/:orgId");
    expect(org).toBeDefined();
    const wildcard = org?.children?.find((child) => child.path === "*");
    expect(wildcard?.element?.type).toBe(OrgFallbackRedirect);
  });

  it("sends an address no page claims to the overview, exactly once", async () => {
    const { router, mounted } = renderAt("/org/proj/org/garbage");
    await mounted;
    await settle();
    expect(document.body.textContent).toContain("the overview");
    expect(where(router)).toBe("/org/proj/org/overview");
    // It stays there: nothing appends a second segment after the redirect lands.
    const settled = where(router);
    await settle();
    await settle();
    expect(where(router)).toBe(settled);
    expect(settled.split("/").filter((segment) => segment === "overview")).toHaveLength(1);
  });

  it("leaves a page's own path alone", async () => {
    const { router, mounted } = renderAt("/org/proj/org/tickets");
    await mounted;
    await settle();
    expect(document.body.textContent).toContain("the tickets page");
    expect(where(router)).toBe("/org/proj/org/tickets");
  });
});
