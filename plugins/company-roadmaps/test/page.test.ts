/**
 * The roadmaps page — the entry after the handbook: its route answers one HTML document, the
 * manifest contributes it as a company-mode iframe page keyed `roadmaps` (the key the web app
 * draws the row for), and its script, run against a stand-in parent window, finds the
 * organization in the parent's URL, asks the plugin's own routes, follows the app's language
 * and escapes what it shows.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAGE_PREFIX, PAGE_ROUTES_ID, PAGE_SRC, PAGE_STRINGS, pageHtml, pageRoutes } from "../src/index.js";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function scriptOf(html: string): string {
  const m = /<script>([\s\S]*)<\/script>/.exec(html);
  if (m === null) throw new Error("the page has no script");
  return m[1]!;
}

/** Runs the page's script against a parent at `parentPath`; returns what it rendered and what it asked. */
async function render(
  parentPath: string,
  answer: (url: string) => { ok: boolean; body: unknown },
  opts: { lang?: string; dark?: boolean; hash?: string } = {},
): Promise<{ html: string; fetched: string[]; lang: string; dark: boolean; title: string }> {
  const fetched: string[] = [];
  const main = { innerHTML: "", addEventListener: () => {} };
  const classes = new Set<string>();
  const doc = {
    title: "",
    getElementById: () => main,
    documentElement: { lang: "", classList: { add: (c: string) => classes.add(c) } },
  };
  const sandbox = {
    document: doc,
    window: {
      parent: {
        location: { pathname: parentPath },
        document: { documentElement: { classList: { contains: () => opts.dark === true } } },
      },
      addEventListener: () => {},
    },
    location: { hash: opts.hash ?? "", pathname: PAGE_SRC },
    localStorage: { getItem: () => opts.lang ?? null },
    navigator: { language: "en-US" },
    fetch: async (url: string) => {
      fetched.push(url);
      const a = answer(url);
      return { ok: a.ok, status: a.ok ? 200 : 404, json: async () => a.body };
    },
  };
  vm.runInNewContext(scriptOf(pageHtml()), sandbox);
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  return {
    html: main.innerHTML,
    fetched,
    lang: doc.documentElement.lang,
    dark: classes.has("dark"),
    title: doc.title,
  };
}

const ROADMAP = {
  number: 3,
  name: "Queue <migration>",
  status: "discussing",
  archived: false,
  channelId: "room_a",
  record: "We agreed.",
  body: "## Why\nBecause.",
  items: [
    { key: "a", kind: "proposal", title: "Ledger", brief: "An append-only ledger.", owner: "acme_dev", cites: ["Why"] },
  ],
  delegations: { a: { proposal: 61 } },
};

describe("the page route", () => {
  it("answers one HTML document behind the plugin's own prefix", async () => {
    const res = await pageRoutes().request("/page");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toContain('<main id="main"></main>');
    expect(`${PAGE_PREFIX}/page`).toBe(PAGE_SRC);
  });

  it("is contributed as the company-mode page keyed `roadmaps`, in an iframe on that route", () => {
    const table = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "ifaces.json"), "utf8")) as {
      modules: Record<string, { contributes: Record<string, Array<Record<string, unknown>>> }>;
    };
    const c = table.modules.CompanyRoadmapsPlugin?.contributes;
    expect(c?.["WebModule.pages"]?.[0]).toMatchObject({
      key: "roadmaps",
      path: "roadmaps/:number?",
      nav: "org",
      admin: false,
      renderer: { iframe: { src: PAGE_SRC } },
    });
    expect(c?.["HttpModule.routes"]?.find((r) => r.id === PAGE_ROUTES_ID)).toMatchObject({
      prefix: PAGE_PREFIX,
      auth: "user",
    });
  });
});

describe("the page's script", () => {
  it("lists the organization's roadmaps, read off the parent's URL, in the app's language, escaped", async () => {
    const out = await render("/org/proj/acme/roadmaps", () => ({
      ok: true,
      body: { roadmaps: [ROADMAP] },
    }), { lang: "zh", dark: true });
    expect(out.fetched).toEqual(["/api/projects/proj/organizations/acme/roadmaps"]);
    expect(out.lang).toBe("zh");
    expect(out.dark).toBe(true);
    expect(out.title).toBe(PAGE_STRINGS.zh.title);
    expect(out.html).toContain(PAGE_STRINGS.zh.title);
    expect(out.html).toContain("Queue &lt;migration&gt;");
    expect(out.html).not.toContain("<migration>");
    expect(out.html).toContain(PAGE_STRINGS.zh.discussing);
    expect(out.html).toContain("acme_dev");
    expect(out.html).toContain("#61");
  });

  it("opens one roadmap — its record and body — when the parent's URL names it", async () => {
    const out = await render("/org/proj/acme/roadmaps/3", () => ({ ok: true, body: ROADMAP }));
    expect(out.fetched).toEqual(["/api/projects/proj/organizations/acme/roadmaps/3"]);
    expect(out.lang).toBe("en");
    expect(out.html).toContain(PAGE_STRINGS.en.record);
    expect(out.html).toContain("We agreed.");
    expect(out.html).toContain("## Why");
  });

  it("says roadmaps are unavailable when the routes answer 404, and outside an organization asks nothing", async () => {
    const off = await render("/org/proj/acme/roadmaps", () => ({ ok: false, body: {} }));
    expect(off.html).toContain(PAGE_STRINGS.en.unavailable);
    const nowhere = await render("/chat", () => ({ ok: true, body: {} }));
    expect(nowhere.fetched).toEqual([]);
    expect(nowhere.html).toContain(PAGE_STRINGS.en.unavailable);
  });
});
