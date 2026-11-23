import type { ILink, Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkClickTracker } from "../terminal-links";
import { terminalUrlProvider } from "../terminal-url-provider";

describe("plain terminal URLs", () => {
  let terminal: Terminal;
  let tracker: LinkClickTracker;

  beforeEach(async () => {
    vi.stubGlobal("self", globalThis);
    const xterm = await import("@xterm/xterm");
    terminal = new xterm.Terminal({ cols: 20, rows: 8, allowProposedApi: true });
    tracker = new LinkClickTracker(() => terminal.cols);
  });

  afterEach(() => terminal?.dispose());

  const write = (output: string) => new Promise<void>((done) => terminal.write(output, done));

  function linksAt(y: number): ILink[] {
    let result: ILink[] = [];
    terminalUrlProvider(terminal, tracker).provideLinks(y, (links) => {
      result = links ?? [];
    });
    return result;
  }

  it("resolves the first, middle and last rows of a URL extending into scrollback", async () => {
    const url = "https://example.org/" + "a".repeat(5100) + "?query=one#end";
    await write("visit " + url);
    const last = 6 + url.length;
    const lastRow = Math.ceil(last / terminal.cols);
    for (const y of [1, Math.floor(lastRow / 2), lastRow]) {
      const [link] = linksAt(y);
      expect(link?.text).toBe(url);
      expect(link?.range).toEqual({
        start: { x: 7, y: 1 },
        end: { x: ((last - 1) % 20) + 1, y: lastRow },
      });
    }
  });

  it("stops at both edges of a full circular scrollback buffer", async () => {
    terminal.options.scrollback = 2;
    const url = "https://a.co/" + "z".repeat(63);
    await write("q".repeat(400) + " " + url);
    const buffer = terminal.buffer.active;
    expect(buffer.length).toBe(10);
    expect(buffer.getLine(0)?.isWrapped).toBe(true);
    expect(linksAt(0)).toEqual([]);
    expect(linksAt(1)).toEqual([]);
    expect(linksAt(buffer.length)[0]?.text).toBe(url);
    expect(linksAt(buffer.length + 1)).toEqual([]);
  });

  it("keeps hard line breaks even when the preceding row is full", async () => {
    const first = "https://example.org/";
    await write(first + "\r\nnext?unrelated\r\n" + " ".repeat(17) + "https://a.b/");
    expect(linksAt(1).map((link) => link.text)).toEqual([first]);
    expect(linksAt(2)).toEqual([]);
    expect(linksAt(3)[0]?.text).toBe("https://a.b/");
    expect(linksAt(4)[0]?.text).toBe("https://a.b/");
  });

  it("maps wide and combined glyphs to cells and skips wide-character wrap padding", async () => {
    const url = "https://a.co/界e\u0301終";
    await write("ab界xx" + url + " end");
    for (const y of [1, 2]) {
      expect(linksAt(y)[0]).toMatchObject({
        text: url,
        range: { start: { x: 7, y: 1 }, end: { x: 5, y: 2 } },
      });
    }
  });

  it("keeps separate URLs on a row and excludes malformed authorities and trailing punctuation", async () => {
    terminal.resize(100, 8);
    await write("https://a.co/p, https://b.co/[x]/. https:///oops http://0x7f000001/ https://");
    expect(linksAt(1).map((link) => link.text)).toEqual(["https://a.co/p", "https://b.co/[x]/"]);
  });
});
