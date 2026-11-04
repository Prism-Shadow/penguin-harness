/** @vitest-environment jsdom */
/**
 * Public-site controls share the app's menu behaviour without its theme provider.
 * - Opening the language menu moves focus into it; arrows walk the choices, selection updates
 *   the host and closes the menu, and reopening announces the new checked choice.
 * - The current language is checked with a line mark alone, never with the app's mark drawn in
 *   every theme's icon set, which the sites would otherwise have to ship.
 * - Escape restores focus to the trigger; an outside click closes without changing language.
 * - Cycling the theme updates the host through light, dark and system and exposes the current mode.
 * - Mobile route links keep router navigation and close their host's disclosure after selection.
 */
import { createElement as h, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Link, MemoryRouter, useLocation } from "react-router";
import { SiteLanguageMenu, SiteNavLinks, SiteThemeToggle } from "@prismshadow/penguin-ui/site";
import type { SiteLangPref, SiteThemeMode } from "@prismshadow/penguin-ui/site";
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

afterEach(unmountAll);
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

  it("checks the current language with a line mark, not the app's icon sets", async () => {
    await mount(h(LanguageHost));
    await click(menuTrigger());
    const current = choices().find((choice) => choice.getAttribute("aria-checked") === "true");
    expect(current?.querySelector("svg path")).not.toBeNull();
    expect(document.querySelector('[role="menu"] [data-set]')).toBeNull();
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
