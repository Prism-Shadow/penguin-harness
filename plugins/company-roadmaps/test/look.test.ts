/**
 * The roadmaps page looks like the app because it is dressed in the app's values, not a palette
 * of its own: it links the app's base stylesheet for framed pages, carries no colour or font of
 * its own beyond the status tones, copies the app's resolved theme from its parent's root — the
 * same list the web app copies into a workflow's frame — and copies it again when the parent's
 * root changes (a theme switch, a new accent, a new font size). Run in happy-dom: a parent
 * document standing for the app, and the page's own document and script beside it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_HREF, THEME_VARS, pageHtml } from "../src/index.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let windows: Window[] = [];
afterEach(async () => {
  for (const w of windows) await w.happyDOM.close();
  windows = [];
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

describe("the page's look", () => {
  it("links the app's stylesheet for framed pages first, then its own rules — and no palette or font of its own", () => {
    const html = pageHtml();
    const link = html.indexOf(`<link rel="stylesheet" href="${THEME_HREF}">`);
    expect(link).toBeGreaterThan(-1);
    expect(link).toBeLessThan(html.indexOf("<style>"));
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    // The page's former look: GitHub's dark ground and blues, and a font of its own.
    for (const gone of ["#0d1117", "#0969da", "#4493f8", "#1f2328", "system-ui", "font: 14px"]) {
      expect(style).not.toContain(gone);
    }
    expect(style).toContain("var(--wf-bg");
    expect(style).toContain("var(--wf-accent");
  });

  it("copies the same theme values the web app copies into a workflow's frame", () => {
    const source = readFileSync(path.join(REPO, "packages/web/src/lib/workflow-theme.ts"), "utf8");
    const list = /WORKFLOW_THEME_VARS = \[([\s\S]*?)\]/.exec(source)![1]!;
    const names = [...list.matchAll(/"(--[a-z0-9-]+)"/g)].map((m) => m[1]);
    expect([...THEME_VARS]).toEqual(names);
  });

  it("takes the app's theme from its parent, and follows it when it changes", async () => {
    const app = new Window({ url: "http://localhost:7364/org/proj/acme/roadmaps" });
    const frame = new Window({ url: "http://localhost:7364/api/company-roadmaps/page" });
    windows.push(app, frame);
    const appRoot = app.document.documentElement;
    appRoot.classList.add("dark");
    appRoot.style.fontSize = "20px";
    appRoot.style.setProperty("--ui-accent", "rgb(1, 2, 3)");
    appRoot.style.setProperty("--color-gray-950", "#000000");

    const html = pageHtml();
    frame.document.body.innerHTML = /<body>([\s\S]*)<script>/.exec(html)![1]!;
    const sandbox = {
      document: frame.document,
      window: {
        parent: {
          location: app.location,
          document: app.document,
          getComputedStyle: (el: unknown) => app.getComputedStyle(el as never),
        },
        addEventListener: () => {},
      },
      MutationObserver: app.MutationObserver,
      location: frame.location,
      localStorage: { getItem: () => "en" },
      navigator: { language: "en-US" },
      setTimeout,
      clearTimeout,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ roadmaps: [] }) }),
    };
    vm.runInNewContext(/<script>([\s\S]*)<\/script>/.exec(html)![1]!, sandbox);
    await settle();

    const root = frame.document.documentElement;
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.fontSize).toBe("20px");
    expect(root.style.getPropertyValue("--ui-accent").trim()).toBe("rgb(1, 2, 3)");
    expect(root.style.getPropertyValue("--color-gray-950").trim()).toBe("#000000");

    // The person switches the app to light and picks another accent: the page follows.
    appRoot.classList.remove("dark");
    appRoot.style.setProperty("--ui-accent", "rgb(4, 5, 6)");
    await settle();
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.classList.contains("light")).toBe(true);
    expect(root.style.getPropertyValue("--ui-accent").trim()).toBe("rgb(4, 5, 6)");
  });
});
