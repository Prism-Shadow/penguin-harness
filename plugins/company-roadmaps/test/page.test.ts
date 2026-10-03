/**
 * The roadmaps page — the entry after the handbook: its route answers one HTML document, the
 * manifest contributes it as a company-mode iframe page keyed `roadmaps` (the key the web app
 * draws the row for), and its script, run against a stand-in parent window, finds the
 * organization in the parent's URL, asks the plugin's own routes, follows the app's language
 * and escapes what it shows.
 *
 * And it is never blank. In the dark theme an empty `<main>` is a solid near-black pane — what a
 * person saw in a real browser while the list was on its way, and for good when the answer never
 * came — so every write the script makes is read back as text, and the document without its
 * script, the moment before the answer, every refusal, a hung answer and a script that throws
 * must each leave words (the HTTP status among them, when there is one).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PAGE_PREFIX,
  PAGE_ROUTES_ID,
  PAGE_SRC,
  PAGE_STRINGS,
  PAGE_TIMEOUT_MS,
  pageHtml,
  pageRoutes,
} from "../src/index.js";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function scriptOf(html: string): string {
  const m = /<script>([\s\S]*)<\/script>/.exec(html);
  if (m === null) throw new Error("the page has no script");
  return m[1]!;
}

/** What a person reads in some HTML: its text, tags dropped, the five escapes undone, spaces folded. */
function readable(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(lt|gt|quot|#39|amp);/g,
      (_, e: string) => ({ lt: "<", gt: ">", quot: '"', "#39": "'", amp: "&" })[e]!,
    )
    .replace(/\s+/g, " ")
    .trim();
}

interface Answer {
  ok: boolean;
  status?: number;
  body: unknown;
}

interface Rendered {
  /** The last HTML the script wrote into `#main`. */
  html: string;
  /** Every HTML the script wrote into `#main`, in order. */
  writes: string[];
  fetched: string[];
  lang: string;
  dark: boolean;
  title: string;
  /** Fires the timers the script set (its deadline), then lets the promises settle. */
  expire: () => Promise<string>;
}

/** Where the page asks which machine the organization runs on, before anything else. */
const LISTING = "/api/projects/proj/organizations";

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

/**
 * Runs the page's script against a parent at `parentPath`; returns what it rendered and what it
 * asked. `answer` may return a promise that never settles (a hung server) or throw (no network).
 */
async function render(
  parentPath: string,
  answer: (url: string) => Answer | Promise<Answer>,
  opts: {
    lang?: string;
    dark?: boolean;
    hash?: string;
    brokenRoot?: boolean;
    /** The Project's organization list; by default it names no machine for any of them. */
    listing?: Answer;
  } = {},
): Promise<Rendered> {
  const fetched: string[] = [];
  const writes: string[] = [];
  const main = {
    get innerHTML() {
      return writes.at(-1) ?? "";
    },
    set innerHTML(html: string) {
      writes.push(html);
    },
    addEventListener: () => {},
  };
  const classes = new Set<string>();
  const root = { lang: "", classList: { add: (c: string) => classes.add(c) } };
  const doc = {
    title: "",
    getElementById: () => main,
    get documentElement() {
      if (opts.brokenRoot === true) throw new Error("no root element");
      return root;
    },
  };
  const timers: Array<() => void> = [];
  const sandbox = {
    document: doc,
    window: {
      parent: {
        location: { pathname: parentPath },
        document: { documentElement: { classList: { contains: () => opts.dark === true } } },
      },
      addEventListener: () => {},
    },
    location: { hash: opts.hash ?? "", pathname: PAGE_SRC, origin: "http://localhost:7364" },
    localStorage: { getItem: () => opts.lang ?? null },
    navigator: { language: "en-US" },
    setTimeout: (f: () => void) => timers.push(f),
    clearTimeout: () => {},
    fetch: async (url: string) => {
      fetched.push(url);
      const a =
        url === LISTING
          ? (opts.listing ?? { ok: true, body: { organizations: [{ orgId: "acme" }] } })
          : await answer(url);
      return {
        ok: a.ok,
        status: a.status ?? (a.ok ? 200 : 404),
        json: async () => {
          if (typeof a.body === "string") throw new SyntaxError("Unexpected token");
          return a.body;
        },
      };
    },
  };
  vm.runInNewContext(scriptOf(pageHtml()), sandbox);
  await settle();
  return {
    get html() {
      return main.innerHTML;
    },
    writes,
    fetched,
    lang: root.lang,
    dark: classes.has("dark"),
    title: doc.title,
    expire: async () => {
      for (const f of timers.splice(0)) f();
      await settle();
      return main.innerHTML;
    },
  };
}

/** No write the script made reads as nothing. */
function neverBlank(out: Rendered): void {
  expect(out.writes.length).toBeGreaterThan(0);
  for (const html of out.writes) expect(readable(html)).not.toBe("");
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
    {
      key: "a",
      kind: "proposal",
      title: "Ledger",
      brief: "An append-only ledger.",
      owner: "acme_dev",
      cites: ["Why"],
    },
  ],
  delegations: { a: { proposal: 61 } },
};

describe("the page route", () => {
  it("answers one HTML document behind the plugin's own prefix", async () => {
    const res = await pageRoutes().request("/page");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toContain('<main id="main"><header class="head"><h1>Roadmaps</h1></header>');
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
    const out = await render(
      "/org/proj/acme/roadmaps",
      () => ({
        ok: true,
        body: { roadmaps: [ROADMAP] },
      }),
      { lang: "zh", dark: true },
    );
    expect(out.fetched).toEqual([LISTING, "/api/projects/proj/organizations/acme/roadmaps"]);
    expect(out.lang).toBe("zh");
    expect(out.dark).toBe(true);
    expect(out.title).toBe(PAGE_STRINGS.zh.title);
    expect(out.html).toContain(PAGE_STRINGS.zh.title);
    expect(out.html).toContain("Queue &lt;migration&gt;");
    expect(out.html).not.toContain("<migration>");
    expect(out.html).toContain(PAGE_STRINGS.zh.discussing);
    expect(out.html).toContain("acme_dev");
    expect(out.html).toContain("#61");
    expect(out.html).toContain(PAGE_STRINGS.zh.itemsOne);
  });

  it("opens one roadmap — its record and body — when the parent's URL names it", async () => {
    const out = await render("/org/proj/acme/roadmaps/3", () => ({ ok: true, body: ROADMAP }));
    expect(out.fetched).toEqual([LISTING, "/api/projects/proj/organizations/acme/roadmaps/3"]);
    expect(out.lang).toBe("en");
    expect(out.html).toContain(PAGE_STRINGS.en.record);
    expect(out.html).toContain("We agreed.");
    expect(out.html).toContain("## Why");
  });

  it("says roadmaps are unavailable when the routes answer a bare 404, and outside an organization asks nothing", async () => {
    const off = await render("/org/proj/acme/roadmaps", () => ({ ok: false, body: {} }));
    expect(readable(off.html)).toContain(`HTTP 404 — ${PAGE_STRINGS.en.unavailable}`);
    const nowhere = await render("/chat", () => ({ ok: true, body: {} }));
    expect(nowhere.fetched).toEqual([]);
    expect(readable(nowhere.html)).toContain(PAGE_STRINGS.en.elsewhere);
    expect(readable(nowhere.html)).toContain("/chat");
  });
});

describe("an organization that runs on another machine", () => {
  const onMachine = {
    ok: true,
    body: { organizations: [{ orgId: "other" }, { orgId: "acme", machineId: "m-1" }] },
  };

  it("is asked there, through this server's /server/<machine>/, as the app asks it", async () => {
    const out = await render(
      "/org/proj/acme/roadmaps",
      () => ({ ok: true, body: { roadmaps: [] } }),
      {
        listing: onMachine,
      },
    );
    expect(out.fetched).toEqual([
      LISTING,
      "/server/m-1/api/projects/proj/organizations/acme/roadmaps",
    ]);
    expect(readable(out.html)).toContain(PAGE_STRINGS.en.empty);
  });

  it("says the plugin must be there too when that machine answers a bare 404", async () => {
    const out = await render(
      "/org/proj/acme/roadmaps",
      () => ({ ok: false, status: 404, body: {} }),
      {
        listing: onMachine,
      },
    );
    expect(readable(out.html)).toContain(
      `HTTP 404 — ${PAGE_STRINGS.en.onMachine.replace("{m}", "m-1")}`,
    );
  });

  it("is asked here when the list cannot be read", async () => {
    const out = await render(
      "/org/proj/acme/roadmaps",
      () => ({ ok: true, body: { roadmaps: [] } }),
      {
        listing: { ok: false, status: 500, body: {} },
      },
    );
    expect(out.fetched).toEqual([LISTING, "/api/projects/proj/organizations/acme/roadmaps"]);
  });
});

describe("the page is never blank", () => {
  it("the document says what it is before any script runs", () => {
    const body = /<body>([\s\S]*)<\/body>/.exec(pageHtml())![1]!;
    const text = readable(body);
    expect(text).toContain(PAGE_STRINGS.en.title);
    expect(text).toContain(PAGE_STRINGS.en.loading);
  });

  it("says what it is asking before the answer arrives", async () => {
    const out = await render("/org/proj/acme/roadmaps", () => new Promise<Answer>(() => {}), {
      dark: true,
    });
    expect(out.fetched).toEqual([LISTING, "/api/projects/proj/organizations/acme/roadmaps"]);
    const text = readable(out.html);
    expect(text).toContain(PAGE_STRINGS.en.title);
    expect(text).toContain(PAGE_STRINGS.en.loading);
    expect(text).toContain("GET /api/projects/proj/organizations/acme/roadmaps");
    neverBlank(out);
  });

  it(`says the server did not answer when no answer has come after ${PAGE_TIMEOUT_MS / 1000} s`, async () => {
    const out = await render("/org/proj/acme/roadmaps", () => new Promise<Answer>(() => {}));
    const text = readable(await out.expire());
    expect(text).toContain(PAGE_STRINGS.en.failed);
    expect(text).toContain(PAGE_STRINGS.en.timeout.replace("{s}", String(PAGE_TIMEOUT_MS / 1000)));
    neverBlank(out);
  });

  it.each([
    [
      404,
      { error: { code: "not_found", message: "Company mode is off." } },
      "Company mode is off.",
    ],
    [404, {}, PAGE_STRINGS.en.unavailable],
    [401, {}, PAGE_STRINGS.en.signedOut],
    [403, { error: { code: "forbidden", message: "Not a member." } }, "Not a member."],
    [500, "<html>oops</html>", ""],
  ])("a %i answer leaves its status and what it means", async (status, body, said) => {
    const out = await render("/org/proj/acme/roadmaps", () => ({ ok: false, status, body }));
    const text = readable(out.html);
    expect(text).toContain(PAGE_STRINGS.en.failed);
    expect(text).toContain(`HTTP ${status}`);
    expect(text).toContain(said);
    neverBlank(out);
  });

  it("a request that fails before any answer says so", async () => {
    const out = await render("/org/proj/acme/roadmaps/3", () => {
      throw new TypeError("Failed to fetch");
    });
    const text = readable(out.html);
    expect(text).toContain(PAGE_STRINGS.en.network);
    expect(text).toContain("Failed to fetch");
    neverBlank(out);
  });

  it("a script that cannot start says so", async () => {
    const out = await render(
      "/org/proj/acme/roadmaps",
      () => ({ ok: true, body: { roadmaps: [] } }),
      {
        brokenRoot: true,
      },
    );
    expect(readable(out.html)).toContain(PAGE_STRINGS.en.broken);
    expect(readable(out.html)).toContain("no root element");
    neverBlank(out);
  });

  it("every state that answers is words, in either language", async () => {
    for (const lang of ["en", "zh"] as const) {
      for (const answer of [
        () => ({ ok: true, body: { roadmaps: [] } }),
        () => ({ ok: true, body: { roadmaps: [ROADMAP] } }),
        () => ({ ok: false, status: 404, body: {} }),
      ]) {
        const out = await render("/org/proj/acme/roadmaps", answer, { lang, dark: true });
        neverBlank(out);
        expect(readable(out.html)).toContain(PAGE_STRINGS[lang].title);
      }
    }
  });
});

describe("the page opens a roadmap, and never sends anyone to a terminal", () => {
  it("offers the button above the list, empty or not — and no command, token or 'only reads' anywhere", async () => {
    for (const lang of ["en", "zh"] as const) {
      for (const body of [{ roadmaps: [] }, { roadmaps: [ROADMAP] }]) {
        const out = await render("/org/proj/acme/roadmaps", () => ({ ok: true, body }), { lang });
        expect(out.html).toContain(
          `<button type="button" class="primary" data-open>${PAGE_STRINGS[lang].open}</button>`,
        );
      }
    }
    const empty = await render("/org/proj/acme/roadmaps", () => ({
      ok: true,
      body: { roadmaps: [] },
    }));
    expect(readable(empty.html)).toContain(PAGE_STRINGS.en.empty);
    const source = pageHtml();
    for (const gone of [
      "curl",
      "PENGUIN_API_TOKEN",
      "only reads",
      "本页只读",
      "penguin org channel create",
    ]) {
      expect(source).not.toContain(gone);
    }
  });
});
