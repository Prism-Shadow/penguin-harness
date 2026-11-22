/**
 * Handing a server this Chrome profile's cookies for its import (src/cookie-export.ts), the
 * consent page and chrome.cookies faked at the module's own seams.
 *
 * - Given a `read-cookies`, the consent page opens naming the server, and nothing is read yet;
 *   Allow hands over every cookie in the wire's shape — session cookies without an expiry,
 *   partitioned ones marked — and closes the page.
 * - Given Deny, the page closed unanswered, or no answer in time, the command is refused
 *   `import_declined` and no cookie is read.
 * - Given a second command from the same server while its page is open, both wait for the one
 *   answer: one import asks once.
 * - The link accepts `read-cookies` from a server.
 */
import { describe, expect, it } from "vitest";
import { CookieExport, type ConsentRequest } from "../src/cookie-export.js";
import { parseCommandMessage } from "../src/wire.js";

const ORIGIN = "http://127.0.0.1:4317";

function cookie(over: Partial<chrome.cookies.Cookie>): chrome.cookies.Cookie {
  return {
    domain: ".amazon.com",
    hostOnly: false,
    httpOnly: true,
    name: "session-id",
    path: "/",
    sameSite: "lax",
    secure: true,
    session: false,
    storeId: "0",
    value: "v",
    expirationDate: 1_900_000_000.5,
    ...over,
  } as chrome.cookies.Cookie;
}

function harness(jar: chrome.cookies.Cookie[], timeoutMs = 60_000) {
  const opened: string[] = [];
  const closed: number[] = [];
  let reads = 0;
  let nextTab = 40;
  const exporter = new CookieExport({
    openPage: async (id) => {
      opened.push(id);
      return nextTab++;
    },
    closePage: async (tabId) => {
      closed.push(tabId);
    },
    readAll: async () => {
      reads++;
      return jar;
    },
    timeoutMs,
  });
  return {
    exporter,
    opened,
    closed,
    reads: () => reads,
    /** What the open consent page shows. */
    page: (): ConsentRequest | null => exporter.request(opened.at(-1) ?? ""),
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("handing over the profile's cookies", () => {
  it("asks on the consent page first, then hands every cookie over in the wire's shape", async () => {
    const h = harness([
      cookie({ name: "session-id" }),
      cookie({ domain: "www.amazon.com", hostOnly: true, name: "host-only" }),
      cookie({ name: "session", session: true, expirationDate: undefined }),
      cookie({ name: "embedded", partitionKey: { topLevelSite: "https://a.com" } }),
    ]);
    const reading = h.exporter.read(ORIGIN);
    await settled();
    expect(h.page()).toMatchObject({ origin: ORIGIN });
    expect(h.reads()).toBe(0);

    h.exporter.answer(h.opened[0]!, true);
    const { cookies } = await reading;
    expect(cookies).toEqual([
      {
        domain: ".amazon.com",
        hostOnly: false,
        name: "session-id",
        value: "v",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        expirationDate: 1_900_000_000.5,
      },
      expect.objectContaining({ domain: "www.amazon.com", hostOnly: true, name: "host-only" }),
      expect.not.objectContaining({ expirationDate: expect.anything() }),
      expect.objectContaining({ name: "embedded", partitioned: true }),
    ]);
    expect(cookies[2]).toMatchObject({ name: "session" });
    // The store's own fields stay in Chrome.
    expect(cookies[0]).not.toHaveProperty("storeId");
    expect(h.closed).toEqual([40]);
    expect(h.page()).toBeNull();
  });

  it("refuses import_declined and reads nothing when the user denies", async () => {
    const h = harness([cookie({})]);
    const reading = h.exporter.read(ORIGIN);
    await settled();
    h.exporter.answer(h.opened[0]!, false);
    await expect(reading).rejects.toThrow("import_declined");
    expect(h.reads()).toBe(0);
    expect(h.closed).toEqual([40]);
  });

  it("counts a consent page closed without an answer as a refusal", async () => {
    const h = harness([cookie({})]);
    const reading = h.exporter.read(ORIGIN);
    await settled();
    h.exporter.tabClosed(40);
    await expect(reading).rejects.toThrow("import_declined");
    expect(h.reads()).toBe(0);
  });

  it("counts no answer in time as a refusal", async () => {
    const h = harness([cookie({})], 20);
    const reading = h.exporter.read(ORIGIN);
    await expect(reading).rejects.toThrow("import_declined");
    expect(h.reads()).toBe(0);
    expect(h.page()).toBeNull();
  });

  it("asks once when the same server asks again while its page is open", async () => {
    const h = harness([cookie({})]);
    const first = h.exporter.read(ORIGIN);
    const second = h.exporter.read(ORIGIN);
    await settled();
    expect(h.opened).toHaveLength(1);
    h.exporter.answer(h.opened[0]!, true);
    expect((await first).cookies).toHaveLength(1);
    expect((await second).cookies).toHaveLength(1);
  });

  it("is a command the link accepts from a server", () => {
    expect(
      parseCommandMessage({
        type: "desktop-browser-command",
        id: "c1",
        command: { op: "read-cookies" },
      }),
    ).toEqual({ id: "c1", command: { op: "read-cookies" } });
  });
});
