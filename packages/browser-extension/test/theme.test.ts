/**
 * The pages' light and dark theme.
 *
 * - Given no theme picked, the options page and the popup force none, so the stylesheet follows
 *   the device's light or dark setting, and the switch names System.
 * - Given the popup, each click on the theme switch steps Light → Dark → System; each step is
 *   stored and applied to the page at once.
 * - Given the popup open, a theme picked in another page reaches it at once, and leaves its
 *   language as it was.
 * - Given a theme picked earlier, a page opened afterwards opens in it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChrome, type FakeChrome } from "./helpers/chrome.js";
import { openPage, settled } from "./helpers/dom.js";

let fake: FakeChrome;

beforeEach(() => {
  fake = installChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the pages' theme", () => {
  it.each([
    ["the options page", "pair"],
    ["the popup", "popup"],
  ] as const)("%s follows the device when no theme was picked", async (_page, name) => {
    const page = await openPage(name);

    expect(page.theme).toBeUndefined();
    expect(page.byId("theme").getAttribute("aria-label")).toContain("System");
  });

  it("each click on the switch steps Light, Dark, System, stored and applied at once", async () => {
    const popup = await openPage("popup");
    const steps: [string | undefined, unknown, string | null][] = [];

    for (let i = 0; i < 3; i++) {
      popup.byId("theme").click();
      await settled();
      steps.push([
        popup.theme,
        fake.local.data.uiTheme,
        popup.byId("theme").getAttribute("aria-label"),
      ]);
    }

    expect(steps).toEqual([
      ["light", "light", expect.stringContaining("Light")],
      ["dark", "dark", expect.stringContaining("Dark")],
      [undefined, "system", expect.stringContaining("System")],
    ]);
  });

  it("an open popup takes a theme picked in another page, and keeps its language", async () => {
    const popup = await openPage("popup", { browserLanguage: "zh-CN" });
    const settings = popup.byId("settings").textContent;

    // What the options page's switch writes.
    await fake.local.set({ uiTheme: "dark" });
    await settled();

    expect(popup.theme).toBe("dark");
    expect(popup.lang).toBe("zh-CN");
    expect(popup.byId("settings").textContent).toBe(settings);
  });

  it("a page opened after a pick opens in the picked theme", async () => {
    await fake.local.set({ uiTheme: "light" });

    const options = await openPage("pair");

    expect(options.theme).toBe("light");
  });
});
