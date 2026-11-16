// @vitest-environment jsdom
/**
 * Switching to and from an imported theme pack (state/theme.tsx over lib/theme-pack-links.ts):
 * the root's attributes and the pack's stylesheet link, step by step. The network is the one
 * boundary faked: a link's `load` or `error` is fired by the test, the server's list comes from
 * the fetch fake, and a painted frame is a turn of the stubbed animation-frame queue.
 *
 * - Given Frost on screen, when an imported pack is picked, its stylesheet link goes into the head
 *   and the root keeps naming Frost until the link has loaded; then it names the pack and its base.
 * - Given a pack on screen, when a built-in theme is picked, the root names it at once, and the
 *   pack's link stays until the frame has painted.
 * - Given a pack whose stylesheet fails, the root keeps the theme it showed, the choice stays the
 *   pack and the failure is reported; a retry that loads shows the pack.
 * - Given a pack picked and then another theme before the link loaded, the late load is not
 *   applied and its link goes.
 * - Given a page that opened in a pack, the link the pre-paint script wrote is taken over when it
 *   holds a sheet; one that holds nothing is asked for again, and when that fails the page shows
 *   Frost.
 * - Given the pack on screen is removed from the server, the root falls back to Frost and the link
 *   goes, while the stored choice stays: listed again, the pack comes back.
 * - Given the pack on screen is replaced, its new stylesheet loads before the old one leaves, and
 *   the root names the pack throughout.
 * - Given a stored pack this browser has never seen listed, the page shows Frost until the list
 *   arrives, then switches once.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemePackDto } from "@prismshadow/penguin-server/api";
import { THEME_STORAGE_KEYS } from "@prismshadow/penguin-ui/boot";
import { publishUserEvent } from "../src/lib/amsp/user-events";
import { ThemeProvider, useTheme } from "../src/state/theme";
import { mount, run, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";

const pack = (v: string): ThemePackDto => ({
  id: "paper",
  names: { zh: "纸页", en: "Paper" },
  version: "1.0.0",
  api: 1,
  base: "modern",
  modes: ["light", "dark"],
  swatches: {
    light: { canvas: "#f6f1e7", ink: "#2b2521", accent: "#2b2521" },
    dark: { canvas: "#1c1a17", ink: "#ece4d6", accent: "#ece4d6" },
  },
  accent: {
    own: { light: "#2b2521", dark: "#ece4d6" },
    presets: [{ id: "ink-blue", swatch: "#2c4f9e" }],
  },
  fonts: {
    sans: "MiSans",
    ui: "MiSans",
    mono: "JetBrains Mono Variable",
    cjk: "MiSans",
    display: "MiSans",
  },
  href: `/api/themes/paper/files/index.css?v=${v}`,
  v,
});
const V1 = "5e1f0c2a";
const V2 = "9a7b3c4d";
const href = (v: string) => `/api/themes/paper/files/index.css?v=${v}`;

let theme: ReturnType<typeof useTheme>;
function Probe() {
  theme = useTheme();
  return null;
}

const root = () => document.documentElement;
const shown = () => [root().dataset.theme, root().dataset.themeBase];
const packLinks = () => [
  ...document.head.querySelectorAll<HTMLLinkElement>("link[data-theme-pack]"),
];

/** The browser's frames: each `paint()` runs the callbacks the last frame queued. */
let frames: FrameRequestCallback[] = [];
const paint = () => run(() => frames.splice(0).forEach((frame) => frame(0)));
const painted = async () => {
  await paint();
  await paint();
};
const fire = (link: HTMLLinkElement, type: "load" | "error") =>
  run(() => link.dispatchEvent(new Event(type)));

/** The server's list, as `GET /api/themes` answers it; the test changes it and says so. */
let listed: ThemePackDto[] = [];
const serverChanged = (next: ThemePackDto[]) =>
  run(() => {
    listed = next;
    publishUserEvent({ type: "themes_changed" });
  });

function store(entries: Record<string, string>) {
  for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
}

const open = () => mount(h(ThemeProvider, null, h(Probe)));

/** A page showing Frost, with the pack listed and then picked and loaded. */
async function showingPaper(): Promise<HTMLLinkElement> {
  store({ [THEME_STORAGE_KEYS.themePacks]: JSON.stringify([pack(V1)]) });
  listed = [pack(V1)];
  await open();
  await run(() => theme.setThemeId("paper"));
  const [link] = packLinks();
  await fire(link!, "load");
  await painted();
  return link!;
}

describe("switching to and from an imported theme pack", () => {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    stubFetch((req) =>
      req.path === "/api/themes" ? json({ themes: listed }) : apiError(404, "not_found"),
    );
  });
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    document.head.innerHTML = "";
    for (const name of [...root().getAttributeNames()]) root().removeAttribute(name);
    listed = [];
  });

  it("names a picked pack on the root only once its stylesheet has loaded", async () => {
    store({ [THEME_STORAGE_KEYS.themePacks]: JSON.stringify([pack(V1)]) });
    await open();
    expect(shown()).toEqual(["modern", "modern"]);

    await run(() => theme.setThemeId("paper"));
    const [link] = packLinks();
    expect(link?.getAttribute("href")).toBe(href(V1));
    expect(link?.dataset.themePack).toBe("paper");
    // The picker has moved; the root has not, so no frame paints the pack without its rules.
    expect(theme.themeId).toBe("paper");
    expect(shown()).toEqual(["modern", "modern"]);

    await fire(link!, "load");
    expect(shown()).toEqual(["paper", "modern"]);
    expect(theme.appliedTheme.id).toBe("paper");
    expect(localStorage.getItem(THEME_STORAGE_KEYS.themeId)).toBe("paper");
  });

  it("names a built-in theme at once and drops the pack's link only after the frame painted", async () => {
    const link = await showingPaper();
    await run(() => theme.setThemeId("github"));
    expect(shown()).toEqual(["github", undefined]);
    expect(packLinks()).toEqual([link]);
    await paint();
    expect(packLinks()).toEqual([link]);
    await paint();
    expect(packLinks()).toEqual([]);
  });

  it("keeps the theme on screen and the choice when the stylesheet fails, and a retry shows the pack", async () => {
    store({
      [THEME_STORAGE_KEYS.themeId]: "github",
      [THEME_STORAGE_KEYS.themePacks]: JSON.stringify([pack(V1)]),
    });
    await open();
    await run(() => theme.setThemeId("paper"));
    await fire(packLinks()[0]!, "error");
    expect(shown()).toEqual(["github", undefined]);
    expect(packLinks()).toEqual([]);
    expect(theme.themeId).toBe("paper");
    expect(theme.themePackFailed).toBe("paper");
    expect(localStorage.getItem(THEME_STORAGE_KEYS.themeId)).toBe("paper");

    await run(() => theme.retryThemePack());
    await fire(packLinks()[0]!, "load");
    expect(shown()).toEqual(["paper", "modern"]);
    expect(theme.themePackFailed).toBeNull();
  });

  it("does not apply a pack whose stylesheet loads after the choice moved on", async () => {
    store({ [THEME_STORAGE_KEYS.themePacks]: JSON.stringify([pack(V1)]) });
    await open();
    await run(() => theme.setThemeId("paper"));
    const [late] = packLinks();
    await run(() => theme.setThemeId("geek"));
    await fire(late!, "load");
    expect(shown()).toEqual(["geek", undefined]);
    expect(packLinks()).toEqual([]);
  });

  it("takes over the pre-paint link that holds a sheet, without asking again", async () => {
    store({
      [THEME_STORAGE_KEYS.themeId]: "paper",
      [THEME_STORAGE_KEYS.themePacks]: JSON.stringify([pack(V1)]),
    });
    root().dataset.theme = "paper";
    root().dataset.themeBase = "modern";
    const prePaint = document.createElement("link");
    prePaint.rel = "stylesheet";
    prePaint.dataset.themePack = "paper";
    prePaint.setAttribute("href", href(V1));
    Object.defineProperty(prePaint, "sheet", { value: {} });
    document.head.append(prePaint);

    await open();
    await painted();
    expect(packLinks()).toEqual([prePaint]);
    expect(shown()).toEqual(["paper", "modern"]);
    expect(theme.appliedTheme.id).toBe("paper");
  });

  it("asks again for a pre-paint link that holds nothing, and shows Frost when that fails too", async () => {
    store({
      [THEME_STORAGE_KEYS.themeId]: "paper",
      [THEME_STORAGE_KEYS.themePacks]: JSON.stringify([pack(V1)]),
    });
    root().dataset.theme = "paper";
    root().dataset.themeBase = "modern";
    const prePaint = document.createElement("link");
    prePaint.dataset.themePack = "paper";
    prePaint.setAttribute("href", href(V1));
    document.head.append(prePaint);

    await open();
    const links = packLinks();
    expect(links).toHaveLength(2);
    await fire(links[1]!, "error");
    expect(packLinks()).toEqual([]);
    expect(shown()).toEqual(["modern", "modern"]);
    expect(theme.themePackFailed).toBe("paper");
    expect(localStorage.getItem(THEME_STORAGE_KEYS.themeId)).toBe("paper");
  });

  it("falls back to Frost when the pack on screen is removed, and brings it back when it is listed again", async () => {
    await showingPaper();
    await serverChanged([]);
    await waitFor(() => root().dataset.theme === "modern");
    expect(theme.themeId).toBe("modern");
    await painted();
    expect(packLinks()).toEqual([]);
    // The account's choice is not rewritten by a removal.
    expect(localStorage.getItem(THEME_STORAGE_KEYS.themeId)).toBe("paper");

    await serverChanged([pack(V1)]);
    await waitFor(() => packLinks().length === 1);
    await fire(packLinks()[0]!, "load");
    expect(shown()).toEqual(["paper", "modern"]);
  });

  it("loads a replaced pack's new stylesheet before the old one leaves, naming the pack throughout", async () => {
    const old = await showingPaper();
    await serverChanged([pack(V2)]);
    await waitFor(() => packLinks().length === 2);
    const fresh = packLinks().find((link) => link !== old)!;
    expect(fresh.getAttribute("href")).toBe(href(V2));
    expect(shown()).toEqual(["paper", "modern"]);

    await fire(fresh, "load");
    expect(shown()).toEqual(["paper", "modern"]);
    expect(packLinks()).toEqual([old, fresh]);
    await painted();
    expect(packLinks()).toEqual([fresh]);
  });

  it("shows Frost for a stored pack this browser never saw listed, then switches once the list arrives", async () => {
    store({ [THEME_STORAGE_KEYS.themeId]: "paper" });
    await open();
    expect(shown()).toEqual(["modern", "modern"]);
    expect(packLinks()).toEqual([]);

    await serverChanged([pack(V1)]);
    await waitFor(() => packLinks().length === 1);
    expect(shown()).toEqual(["modern", "modern"]);
    await fire(packLinks()[0]!, "load");
    expect(shown()).toEqual(["paper", "modern"]);
  });
});
