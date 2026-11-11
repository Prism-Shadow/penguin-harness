// @vitest-environment jsdom
/**
 * The theme-pack group on Settings → Appearance (features/settings/theme-packs-section.tsx) and the
 * page's theme row, signed in as an admin or a member against the package's fetch fake.
 *
 * - The theme row offers the built-in themes as segments; once the server offers imported packs it
 *   is a select listing every theme, the built-in ones first, and picking a pack there switches to
 *   it.
 * - A member sees every pack, built-in ones first, each with Export, and no Remove and no import:
 *   a line says only an admin imports or removes.
 * - An admin can remove an imported pack and never a built-in one; Remove asks first, and a
 *   cancelled confirmation sends nothing. Confirmed, the pack leaves the list, and when it was the
 *   theme on screen the page shows Frost.
 * - Export of a built-in pack downloads its zip from the server, as it does for an imported one.
 * - An import sends the zip as it is; an id already installed asks whether to replace it and, on
 *   yes, sends it again as a replacement, which takes the old row's place.
 * - A refused import says where the validator stopped and why, and the list stays as it was; a
 *   file over the cap is refused before anything is sent.
 * - The rows come from this browser's copy of the list while it is read again: they stay exactly
 *   as they were while the read is in flight, and a page opened meanwhile joins that read.
 */
import { createElement as h } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse, ThemePackDto } from "@prismshadow/penguin-server/api";
import { BUILTIN_PACKS, builtinPack, toastStore, type ThemeId } from "@prismshadow/penguin-ui";
import { THEME_STORAGE_KEYS } from "@prismshadow/penguin-ui/boot";
import { AppearanceSection } from "../src/features/settings/appearance-section";
import { ThemePacksSection } from "../src/features/settings/theme-packs-section";
import { publishUserEvent } from "../src/lib/amsp/user-events";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AuthProvider } from "../src/state/auth";
import { BackgroundProvider } from "../src/state/background";
import { LocaleProvider } from "../src/state/locale";
import { ThemeProvider } from "../src/state/theme";
import { ADMIN_ME } from "./helpers/admin-settings";
import {
  button,
  click,
  hasButton,
  mount,
  pickFile,
  run,
  unmountAll,
  waitFor,
  watchText,
} from "./helpers/dom";
import { apiError, json, stubFetch, type FetchRequest } from "./helpers/fetch";
import { SignedIn } from "./helpers/signed-in";

const T = en.settings.themePacks;
/** The built-in packs' names as the screen shows them, in the order every theme list puts first. */
const BUILTIN_NAMES = BUILTIN_PACKS.map((p) => en.settings.themeNames[p.id as ThemeId]);

const pack = (id: string, names: { zh: string; en: string }, v: string): ThemePackDto => ({
  id,
  names,
  version: "1.0.0",
  api: 1,
  base: "modern",
  modes: ["light", "dark"],
  swatches: {
    light: { canvas: "#f6f1e7", ink: "#2b2521", accent: "#2b2521" },
    dark: { canvas: "#1c1a17", ink: "#ece4d6", accent: "#ece4d6" },
  },
  accent: { own: { light: "#2b2521", dark: "#ece4d6" }, presets: [] },
  fonts: {
    sans: "MiSans",
    ui: "MiSans",
    mono: "JetBrains Mono Variable",
    cjk: "MiSans",
    display: "MiSans",
  },
  href: `/api/themes/${id}/files/index.css?v=${v}`,
  v,
});
const PAPER = pack("paper", { zh: "纸页", en: "Paper" }, "5e1f0c2a");
const PAPER_2 = {
  ...PAPER,
  version: "1.1.0",
  v: "77aa0c2a",
  href: "/api/themes/paper/files/index.css?v=77aa0c2a",
};
const INK = pack("ink", { zh: "墨", en: "Ink" }, "0b0b0c0d");

const MEMBER: MeResponse = {
  ...ADMIN_ME,
  user: { ...ADMIN_ME.user, userId: "ann", isAdmin: false },
};

interface Server {
  requests: FetchRequest[];
  /** The pack list `GET /api/themes` answers with. */
  listed: ThemePackDto[];
  /** Holds every list read until `release` (a read in flight). */
  hold(): void;
  release(): void;
  /** What the next import answers, by whether it replaces. */
  importAnswer: (replace: boolean) => Response;
}

function server(me: MeResponse): Server {
  let held: Array<() => void> | null = null;
  const s: Server = {
    requests: [],
    listed: [PAPER],
    hold: () => void (held = []),
    release: () => {
      const waiting = held ?? [];
      held = null;
      for (const go of waiting) go();
    },
    importAnswer: () => json({ theme: INK }, 201),
  };
  const fetch = stubFetch((req) => {
    if (req.path === "/api/me") return json(me);
    if (req.path === "/api/me/prefs") return json({ prefs: {} });
    if (req.path === "/api/me/drafts") return json({ drafts: {} });
    if (req.path === "/api/themes" && req.method === "GET") {
      const answer = () => json({ themes: s.listed });
      if (held === null) return answer();
      return new Promise<Response>((resolve) => held!.push(() => resolve(answer())));
    }
    if (req.path === "/api/themes" && req.method === "POST") {
      return s.importAnswer(req.query.get("replace") === "1");
    }
    if (req.path === "/api/themes/paper" && req.method === "DELETE") {
      s.listed = s.listed.filter((p) => p.id !== "paper");
      return new Response(null, { status: 204 });
    }
    if (req.path.endsWith("/export")) {
      return new Response("PK", { headers: { "content-type": "application/zip" } });
    }
    return apiError(404, "not_found");
  });
  s.requests = fetch.requests;
  return s;
}

/** A refusal in the server's envelope, with the `details` a caller acts on. */
const refusal = (status: number, code: string, details: Record<string, string>) =>
  json({ error: { code, message: code, details } }, status);

const listReads = (s: Server) =>
  s.requests.filter((r) => r.path === "/api/themes" && r.method === "GET").length;

/** The signed-in shell around a settings page. */
const shell = (page: () => ReturnType<typeof h>) =>
  h(
    LocaleProvider,
    null,
    h(
      AuthProvider,
      null,
      h(ThemeProvider, null, h(BackgroundProvider, null, h(SignedIn, null, page()))),
    ),
  );

async function openPage(
  me: MeResponse = ADMIN_ME,
  cached: ThemePackDto[] = [PAPER],
  page: () => ReturnType<typeof h> = () => h(ThemePacksSection),
) {
  localStorage.setItem("penguin.prefsImported", "1");
  localStorage.setItem(THEME_STORAGE_KEYS.themePacks, JSON.stringify(cached));
  const s = server(me);
  s.listed = cached;
  await mount(shell(page));
  await waitFor(() => document.body.textContent?.includes(T.title) === true);
  return s;
}

/** The pack rows' names, in order: the text the row's name line shows. */
const rowNames = () =>
  [...document.querySelectorAll<HTMLElement>("[data-tooltip^='id: ']")].map((el) => el.textContent);
const toasts = () => toastStore.getState().items.map((t) => [t.kind, t.text]);
const zip = (bytes = 4) =>
  new File([new Uint8Array(bytes)], "ink.zip", { type: "application/zip" });
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]');

describe("the theme-pack group on the Appearance page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    toastStore.setState({ items: [] });
    localStorage.setItem("penguin.lang", "en");
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    document.head.innerHTML = "";
  });

  it("offers built-in themes as segments, and every theme in a select once packs are offered", async () => {
    const s = await openPage(MEMBER, [], () => h(AppearanceSection));
    const themeSelect = () =>
      document.querySelector<HTMLButtonElement>(
        `button[aria-haspopup="listbox"][aria-label="${en.settings.theme}"]`,
      );
    expect(button("Frost").getAttribute("aria-pressed")).toBe("true");
    expect(themeSelect()).toBeNull();

    s.listed = [PAPER, INK];
    await run(() => publishUserEvent({ type: "themes_changed" }));
    await waitFor(() => themeSelect() !== null);
    await click(themeSelect()!);
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual([...BUILTIN_NAMES, "Paper", "Ink"]);
    await click(options.find((o) => o.textContent === "Paper")!);
    expect(localStorage.getItem(THEME_STORAGE_KEYS.themeId)).toBe("paper");
    expect(document.head.querySelector('link[data-theme-pack="paper"]')?.getAttribute("href")).toBe(
      PAPER.href,
    );
  });

  it("shows a member every pack with Export, and no Remove and no import", async () => {
    await openPage(MEMBER);
    expect(rowNames()).toEqual([...BUILTIN_NAMES, "Paper"]);
    for (const name of rowNames()) expect(hasButton(T.exportLabel(name!))).toBe(true);
    expect(rowNames().some((name) => hasButton(T.removeLabel(name!)))).toBe(false);
    expect(fileInput()).toBeNull();
    expect(document.body.textContent).toContain(T.adminOnly);
  });

  it("lets an admin remove an imported pack only, asking first, and a cancel sends nothing", async () => {
    const s = await openPage();
    expect(hasButton(T.removeLabel("Frost"))).toBe(false);
    await click(button(T.removeLabel("Paper")));
    expect(document.body.textContent).toContain(T.removeBody("Paper"));
    await click(button(en.common.cancel));
    expect(s.requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(rowNames()).toContain("Paper");
  });

  it("removes a confirmed pack, and the page on it shows Frost", async () => {
    localStorage.setItem(THEME_STORAGE_KEYS.themeId, "paper");
    const s = await openPage();
    await click(button(T.removeLabel("Paper")));
    await click(button(T.remove));
    expect(s.requests.filter((r) => r.method === "DELETE").map((r) => r.path)).toEqual([
      "/api/themes/paper",
    ]);
    expect(rowNames()).toEqual(BUILTIN_NAMES);
    await waitFor(() => document.documentElement.dataset.theme === "modern");
  });

  it("exports a built-in pack's zip from the server", async () => {
    const s = await openPage(MEMBER);
    const NodeUrl = globalThis.URL;
    vi.stubGlobal(
      "URL",
      class extends NodeUrl {
        static createObjectURL = () => "blob:pack";
        static revokeObjectURL = () => undefined;
      },
    );
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    await click(button(T.exportLabel("Frost")));
    await waitFor(() => saved.length === 1);
    expect(s.requests.at(-1)?.path).toBe("/api/themes/modern/export");
    expect(saved).toEqual([`modern-${builtinPack("modern").version}.zip`]);
  });

  it("imports a zip as it is, and replaces an installed id once the admin says so", async () => {
    const s = await openPage();
    await pickFile(fileInput()!, zip());
    await waitFor(() => rowNames().includes("Ink"));
    const sent = s.requests.find((r) => r.method === "POST")!;
    expect(sent.query.get("replace")).toBeNull();
    expect(sent.body).toBeInstanceOf(File);

    s.importAnswer = (replace) =>
      replace ? json({ theme: PAPER_2 }, 201) : refusal(409, "theme_exists", { themeId: "paper" });
    await pickFile(fileInput()!, zip());
    await waitFor(() => document.body.textContent?.includes(T.replaceBody("Paper")) === true);
    await click(button(T.replace));
    await waitFor(() => document.body.textContent?.includes("v1.1.0") === true);
    const posts = s.requests.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.query.get("replace"))).toEqual([null, null, "1"]);
    expect(rowNames()).toEqual([...BUILTIN_NAMES, "Paper", "Ink"]);
  });

  it("says where a refused import stopped and keeps the list, and sends nothing for a file over the cap", async () => {
    const s = await openPage();
    s.importAnswer = () =>
      refusal(400, "theme_invalid", {
        file: "recipes.css",
        line: "12",
        column: "4",
        reason: "remote url()",
      });
    await pickFile(fileInput()!, zip());
    await waitFor(() => toasts().length === 1);
    expect(toasts()).toEqual([["error", T.invalid("recipes.css:12:4", "remote url()")]]);
    expect(rowNames()).toEqual([...BUILTIN_NAMES, "Paper"]);

    const posts = s.requests.filter((r) => r.method === "POST").length;
    await pickFile(fileInput()!, zip(16 * 1024 * 1024 + 1));
    expect(s.requests.filter((r) => r.method === "POST").length).toBe(posts);
    expect(toasts().at(-1)).toEqual(["error", T.tooLarge]);
  });

  it("keeps the rows as they are while the list is read again, and a page opened meanwhile joins the read", async () => {
    const s = await openPage();
    const reads = listReads(s);
    const rows = watchText("section");
    s.hold();
    await run(() => publishUserEvent({ type: "themes_changed" }));
    expect(listReads(s)).toBe(reads + 1);
    // A second copy of the page mounts while the read is in flight: it asks for nothing more.
    await mount(shell(() => h(ThemePacksSection)));
    expect(listReads(s)).toBe(reads + 1);
    await run(() => s.release());
    expect(listReads(s)).toBe(reads + 1);
    expect(rows.texts()).toHaveLength(1);
    rows.stop();
  });
});
