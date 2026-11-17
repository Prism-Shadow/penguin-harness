/** @vitest-environment jsdom */
/**
 * Public-site controls share the app's menu behaviour without its theme provider.
 * - Opening the language menu moves focus into it; arrows walk the choices, selection updates
 *   the host and closes the menu, and reopening announces the new checked choice.
 * - Escape restores focus to the trigger; an outside click closes without changing language.
 * - Cycling the theme updates the host through light, dark and system and exposes the current mode.
 * - Mobile route links keep router navigation and close their host's disclosure after selection.
 * - Pressing the bar's More entry opens its pages with focus on the first; a second press closes
 *   it, and so does Escape, which hands focus back to the trigger.
 * - Hovering More opens it without taking focus; it stays open while the pointer moves onto its
 *   pages and closes once the pointer has left. A press while hovered keeps it open.
 * - Focus moving to another page of the menu keeps it open; focus leaving it (Tab) closes it.
 * - Choosing a page under More navigates through the host router and closes the menu.
 */
import { act, createElement as h, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, useLocation } from "react-router";
import { SiteLanguageMenu, SiteNavLinks, SiteThemeToggle } from "@prismshadow/penguin-ui/site";
import type {
  SiteLangPref,
  SiteLinkProps,
  SiteNavItem,
  SiteThemeMode,
} from "@prismshadow/penguin-ui/site";
import { click, mount, pressEscape, run, unmountAll } from "./helpers/dom";

const languageLabels = { label: "Language", en: "English", zh: "中文", system: "System" };
const themeLabels = { label: "Theme", light: "Light", dark: "Dark", system: "System" };

function LanguageHost() {
  const [value, onChange] = useState<SiteLangPref>("system");
  return h(SiteLanguageMenu, { value, onChange, labels: languageLabels });
}
function menuTrigger(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
}
function choices(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
}

const routeLink = ({ href, ...props }: SiteLinkProps) => h(Link, { to: href, ...props });

/** A bar with one page in its row and a More menu holding a routed page and a plain link. */
const barItems: SiteNavItem[] = [
  { id: "home", href: "/", label: "Home", render: routeLink },
  {
    id: "more",
    label: "More",
    links: [
      { id: "amsp", href: "/amsp", label: "AMSP", render: routeLink },
      { id: "gallery", href: "/gallery/", label: "Theme Packs" },
    ],
  },
];
function BarHost() {
  const { pathname } = useLocation();
  return h(
    "div",
    null,
    h("output", null, pathname),
    h(SiteNavLinks, { links: barItems }),
    h("button", { type: "button" }, "Elsewhere"),
  );
}
const mountBar = () => mount(h(MemoryRouter, null, h(BarHost)));
function moreTrigger(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
}
function morePages(): HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')];
}
/** The pointer arriving on `element` from outside the bar, or leaving it for outside. */
const pointer = (type: "mouseover" | "mouseout", element: Element) =>
  act(() => {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: document.body }));
  });

afterEach(async () => {
  vi.useRealTimers();
  await unmountAll();
});
describe("public-site controls", () => {
  it("choosing a language with the menu updates the host and announces the checked choice", async () => {
    await mount(h(LanguageHost));
    await click(menuTrigger());
    expect(document.activeElement).toBe(choices()[0]);
    await run(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(choices()[1]);
    await click(document.activeElement!);
    expect(choices()).toHaveLength(0);
    await click(menuTrigger());
    expect(
      choices().find((choice) => choice.getAttribute("aria-checked") === "true")?.textContent,
    ).toBe("中文");
  });

  it("Escape returns focus and outside dismissal does not change the selected language", async () => {
    await mount(h(LanguageHost));
    await click(menuTrigger());
    await pressEscape();
    expect(choices()).toHaveLength(0);
    expect(document.activeElement).toBe(menuTrigger());
    await click(menuTrigger());
    await click(document.body);
    expect(choices()).toHaveLength(0);
    await click(menuTrigger());
    expect(
      choices().find((choice) => choice.getAttribute("aria-checked") === "true")?.textContent,
    ).toBe("System");
  });

  it("theme cycling exposes each current mode to the host and assistive technology", async () => {
    function ThemeHost() {
      const [mode, onChange] = useState<SiteThemeMode>("system");
      return h(SiteThemeToggle, { mode, onChange, labels: themeLabels });
    }
    const { container } = await mount(h(ThemeHost));
    const button = container.querySelector("button")!;
    for (const mode of ["Light", "Dark", "System"]) {
      await click(button);
      expect(button.getAttribute("aria-label")).toBe(`Theme: ${mode}`);
    }
  });

  it("mobile route selection navigates through the host router and closes its menu", async () => {
    function Routes() {
      const { pathname } = useLocation();
      const [open, setOpen] = useState(true);
      return h(
        "div",
        null,
        h("output", null, pathname),
        open &&
          h(SiteNavLinks, {
            mobile: true,
            onNavigate: () => setOpen(false),
            links: [
              {
                id: "blog",
                href: "/blog",
                label: "Blog",
                render: ({ href, ...props }) => h(Link, { to: href, ...props }),
              },
            ],
          }),
      );
    }
    const { container } = await mount(h(MemoryRouter, null, h(Routes)));
    await click(container.querySelector("a")!);
    expect(container.querySelector("output")?.textContent).toBe("/blog");
    expect(container.querySelector("nav")).toBeNull();
  });
});

describe("the bar's More menu", () => {
  it("a press opens it with focus on its first page; a second press or Escape closes it", async () => {
    await mountBar();
    await click(moreTrigger());
    expect(moreTrigger().getAttribute("aria-expanded")).toBe("true");
    expect(morePages().map((page) => page.textContent)).toEqual(["AMSP", "Theme Packs"]);
    expect(document.activeElement).toBe(morePages()[0]);
    await click(moreTrigger());
    expect(morePages()).toHaveLength(0);
    await click(moreTrigger());
    await pressEscape();
    expect(morePages()).toHaveLength(0);
    expect(document.activeElement).toBe(moreTrigger());
  });

  it("hovering opens it without taking focus, and it closes once the pointer has left", async () => {
    await mountBar();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await pointer("mouseover", moreTrigger());
    expect(morePages()).toHaveLength(2);
    expect(morePages()).not.toContain(document.activeElement);
    // Crossing from the trigger onto the menu keeps it open.
    await pointer("mouseout", moreTrigger());
    await pointer("mouseover", morePages()[1]!);
    await act(() => vi.advanceTimersByTime(1000));
    expect(morePages()).toHaveLength(2);
    await pointer("mouseout", morePages()[1]!);
    await act(() => vi.advanceTimersByTime(1000));
    expect(morePages()).toHaveLength(0);
  });

  it("a press while hovered keeps it open after the pointer leaves", async () => {
    await mountBar();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await pointer("mouseover", moreTrigger());
    await act(() => {
      moreTrigger().dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    await pointer("mouseout", moreTrigger());
    await act(() => vi.advanceTimersByTime(1000));
    expect(morePages()).toHaveLength(2);
  });

  it("focus moving within the menu keeps it open, and focus leaving it closes it", async () => {
    const { container } = await mountBar();
    await click(moreTrigger());
    const leave = (to: Element) =>
      run(() =>
        morePages()[0]!.dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, relatedTarget: to }),
        ),
      );
    await leave(morePages()[1]!);
    expect(morePages()).toHaveLength(2);
    await leave(container.querySelector("button:not([aria-haspopup])")!);
    expect(morePages()).toHaveLength(0);
  });

  it("choosing a page navigates through the host router and closes the menu", async () => {
    const { container } = await mountBar();
    await click(moreTrigger());
    await click(morePages()[0]!);
    expect(container.querySelector("output")?.textContent).toBe("/amsp");
    expect(morePages()).toHaveLength(0);
  });
});
