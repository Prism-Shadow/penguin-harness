// @vitest-environment jsdom
/**
 * Leaving a page with unsaved edits by navigating (src/lib/unsaved/navigation-guard.tsx): the
 * router blocker above every route, the form registered through `useFormDraft`, and the app's one
 * discard prompt, on a memory data router.
 *
 * - A dirty form holds a link's navigation until "Discard changes" is chosen; the page then
 *   changes and nothing is left dirty.
 * - "Keep editing" leaves the address and the typed text where they were.
 * - A clean form never asks.
 * - The browser's Back is held the same way, and goes once discard is chosen.
 * - A `?tab=` switch (a replace on the same page) asks too, and discarding resets the form that
 *   stays on screen.
 * - A navigation that keeps the path and the query (a state-only replace) leaves nothing behind
 *   and does not ask.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { Link, Outlet, RouterProvider, createMemoryRouter, useSearchParams } from "react-router";
import { hasUnsaved, useFormDraft } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { NavigationGuard } from "../src/lib/unsaved/navigation-guard";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  mount,
  run,
  settle,
  type,
  unmountAll,
} from "./helpers/dom";

const STORED = "http://proxy:8080";

/** A page with one typed field, links away and a tab switch on its own query. */
function FormPage() {
  const form = useFormDraft(STORED);
  const [params, setParams] = useSearchParams();
  return h(
    "div",
    null,
    h("input", {
      "aria-label": "Address",
      value: form.draft,
      onChange: (e: { target: { value: string } }) => form.setDraft(e.target.value),
    }),
    h(Link, { to: "/other" }, "Other page"),
    h(
      "button",
      { type: "button", onClick: () => setParams({ tab: "b" }, { replace: true }) },
      "Tab B",
    ),
    h("p", { "data-testid": "tab" }, params.get("tab") ?? "a"),
  );
}

function renderApp(initial = "/form") {
  const router = createMemoryRouter(
    [
      {
        element: h("div", null, h(NavigationGuard), h(Outlet)),
        children: [
          { path: "/start", element: h("p", null, "Start") },
          { path: "/form", element: h(FormPage) },
          { path: "/other", element: h("p", null, "Other content") },
        ],
      },
    ],
    { initialEntries: ["/start", initial] },
  );
  return {
    router,
    mounted: mount(h("div", null, h(RouterProvider, { router }), h(UnsavedPrompt))),
  };
}

const where = (router: ReturnType<typeof createMemoryRouter>) =>
  `${router.state.location.pathname}${router.state.location.search}`;

const promptOpen = () => hasButton("Discard changes") && hasButton("Keep editing");

describe("leaving a page with unsaved edits by navigating", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("holds a link until the user chooses to discard, then leaves with nothing dirty", async () => {
    const { router, mounted } = renderApp();
    await mounted;
    await type(field("Address"), "http://other:3128");
    await click(document.querySelector("a")!);
    expect(promptOpen()).toBe(true);
    expect(where(router)).toBe("/form");
    await click(button("Discard changes"));
    expect(where(router)).toBe("/other");
    expect(document.body.textContent).toContain("Other content");
    expect(hasUnsaved()).toBe(false);
    expect(dialogs()).toEqual([]);
  });

  it("stays put with the typed text when the user keeps editing", async () => {
    const { router, mounted } = renderApp();
    await mounted;
    await type(field("Address"), "http://other:3128");
    await click(document.querySelector("a")!);
    await click(button("Keep editing"));
    expect(where(router)).toBe("/form");
    expect(field("Address").value).toBe("http://other:3128");
    expect(promptOpen()).toBe(false);
    expect(hasUnsaved()).toBe(true);
  });

  it("never asks while the form is clean, even after typing the stored value back", async () => {
    const { router, mounted } = renderApp();
    await mounted;
    await type(field("Address"), "http://other:3128");
    await type(field("Address"), STORED);
    await click(document.querySelector("a")!);
    expect(promptOpen()).toBe(false);
    expect(where(router)).toBe("/other");
  });

  it("holds the browser's Back the same way, and goes back once discard is chosen", async () => {
    const { router, mounted } = renderApp();
    await mounted;
    await type(field("Address"), "http://other:3128");
    await run(() => router.navigate(-1));
    expect(promptOpen()).toBe(true);
    expect(where(router)).toBe("/form");
    await click(button("Discard changes"));
    await settle();
    expect(where(router)).toBe("/start");
  });

  it("asks before a ?tab= switch, and discarding resets the form that stays on screen", async () => {
    const { router, mounted } = renderApp();
    await mounted;
    await type(field("Address"), "http://other:3128");
    await click(button("Tab B"));
    expect(promptOpen()).toBe(true);
    expect(where(router)).toBe("/form");
    await click(button("Discard changes"));
    expect(where(router)).toBe("/form?tab=b");
    expect(field("Address").value).toBe(STORED);
    expect(hasUnsaved()).toBe(false);
  });

  it("lets a navigation through when it keeps the path and the query", async () => {
    const { router, mounted } = renderApp();
    await mounted;
    await type(field("Address"), "http://other:3128");
    await run(() => router.navigate("/form", { replace: true, state: { from: "test" } }));
    expect(promptOpen()).toBe(false);
    expect(router.state.location.state).toEqual({ from: "test" });
    expect(field("Address").value).toBe("http://other:3128");
  });
});
