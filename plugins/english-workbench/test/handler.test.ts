/**
 * English Learning Workbench: the handler's privacy rules, as a learner meets them.
 *
 * - Given a fresh workbench, the daily press is off: asking for the press list, even with a
 *   forced refresh, contacts nothing.
 * - Given a press list cached while it was on, when the learner keeps it off, the list still
 *   shows but without the cover addresses, and nothing is contacted.
 * - Given the switch turned on, every address the handler requests is on a host it names,
 *   under its own name rather than a browser's, and a story every feed carries is listed once.
 * - Given pasted text, it becomes paragraphs without any request; a link that is not http(s)
 *   is refused, with a reason the page shows in Chinese or English rather than as a raw code.
 * - Given a state an older copy left with accounts and tokens, the first write keeps the
 *   learning record as one document and drops the accounts.
 * - Given a stored record, a write that carries no record is refused, with a reason the page
 *   can show, and wipes nothing.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import workbench from "../workbenches/english/index";

/** The page's two dictionaries, read the way the page loads them. */
function pageStrings(): Record<"zh" | "en", Record<string, unknown>> {
  const source = readFileSync(
    new URL("../workbenches/english/ui/i18n.js", import.meta.url),
    "utf8",
  );
  const sandbox: Record<string, unknown> = { navigator: {}, document: {} };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return (sandbox.EnglishI18n as { strings: Record<"zh" | "en", Record<string, unknown>> }).strings;
}

/** Whether the page shows this refusal in both of its languages rather than as a raw code. */
function pageExplains(reply: Reply): boolean {
  const strings = pageStrings();
  const key = "err." + String(reply.body?.error);
  return key in strings.zh && key in strings.en;
}

interface Reply {
  status?: number;
  // The handler's JSON body; each scenario reads the fields it is about.
  body?: any;
}

/** The handler with a fake host: one state document, no log. */
function open(initial: unknown = null) {
  let state = initial;
  const host = {
    getState: () => state,
    setState: async (next: unknown) => {
      state = structuredClone(next);
    },
    log: () => {},
  };
  const made = workbench.modules.Workbench.create({ use: { host } } as never) as unknown as {
    api: { main: { handle(req: unknown): Promise<Reply> } };
  };
  const call = (
    method: string,
    path: string,
    body: unknown = null,
    query: Record<string, string> = {},
  ) => made.api.main.handle({ method, path, query, headers: {}, body });
  return { call, state: () => state as any };
}

const FEED = `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel>
<item><title>A long enough headline about the sea</title><link>https://example.com/story</link>
<pubDate>Mon, 16 Nov 2026 08:00:00 GMT</pubDate><description>A short summary.</description>
<media:thumbnail url="https://example.com/cover.jpg"/></item>
</channel></rss>`;

describe("the English workbench handler", () => {
  let network: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    network = vi.fn(async () => new Response(FEED, { status: 200 }));
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("contacts nothing for the daily press until the learner switches it on", async () => {
    const wb = open();
    const settings = await wb.call("GET", "/settings");
    expect(settings.body.online).toBe(false);

    const press = await wb.call("GET", "/press", null, { refresh: "1" });

    expect(press.body.items).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  });

  it("keeps showing the cached list while off, without the cover addresses", async () => {
    const cached = {
      press: {
        fetchedAt: 1,
        items: [
          {
            id: "a",
            title: "Cached headline",
            url: "https://example.com/a",
            ts: 1,
            date: null,
            summary: "",
            source: "S",
            topic: "world",
            image: "https://example.com/a.jpg",
          },
        ],
      },
    };
    const wb = open(cached);

    const press = await wb.call("GET", "/press");

    expect(press.body.items.map((it: { title: string }) => it.title)).toEqual(["Cached headline"]);
    expect(press.body.items[0].image).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  });

  it("once on, reads only the hosts it names, under its own name", async () => {
    const wb = open();
    const on = await wb.call("PUT", "/settings", { online: true });

    const press = await wb.call("GET", "/press");

    expect(network).toHaveBeenCalled();
    for (const [url, init] of network.mock.calls as [string, RequestInit][]) {
      expect(on.body.hosts).toContain(new URL(url).hostname);
      const agent = (init.headers as Record<string, string>)["user-agent"];
      expect(agent).toMatch(/PenguinHarness/);
      expect(agent).not.toMatch(/Mozilla|Chrome|Safari/);
    }
    // Every feed answered with the same story: it is listed once, with the cover the feed gave.
    expect(press.body.items).toHaveLength(1);
    expect(press.body.items[0].image).toBe("https://example.com/cover.jpg");
  });

  it("turns pasted text into paragraphs and refuses a link that is not http(s)", async () => {
    const wb = open();
    const text = Array(30).fill("word").join(" ") + "\n\n" + Array(30).fill("more").join(" ");

    const refused = await wb.call("POST", "/press/import-text", {
      text,
      url: "javascript:alert(1)",
    });
    const taken = await wb.call("POST", "/press/import-text", {
      text,
      url: "https://example.com/p",
    });

    expect(refused.status).toBe(400);
    expect(refused.body.item).toBeUndefined();
    expect(pageExplains(refused)).toBe(true);
    expect(taken.body.item.paragraphs).toHaveLength(2);
    expect(taken.body.item.url).toBe("https://example.com/p");
    expect(network).not.toHaveBeenCalled();
  });

  it("keeps the learning record as one document and drops an older copy's accounts", async () => {
    const wb = open({ users: { "a@example.com": { hash: "x" } }, tokens: { t: {} } });

    await wb.call("PUT", "/data", { data: { saved: { words: [{ en: "dormant" }] } } });
    const back = await wb.call("GET", "/data");

    expect(back.body.data.saved.words[0].en).toBe("dormant");
    expect(wb.state().users).toBeUndefined();
    expect(wb.state().tokens).toBeUndefined();
  });

  it("does not wipe the record when a write carries no data", async () => {
    const wb = open();
    await wb.call("PUT", "/data", { data: { notes: { a: "kept" } } });

    const empty = await wb.call("PUT", "/data", {});

    expect(empty.status).toBe(400);
    expect(pageExplains(empty)).toBe(true);
    expect((await wb.call("GET", "/data")).body.data.notes.a).toBe("kept");
  });
});
