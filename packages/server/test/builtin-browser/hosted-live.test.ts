/**
 * The hosted backend against a real Chrome, when the machine has one: a headless Chrome is
 * launched on a throwaway data root, opens a page of a local test site, is scanned, clicked and
 * typed into, shows a frame of the page, takes a viewer's click that changes the page, and
 * exits when the browser is disposed.
 *
 * Which Chrome: `PENGUIN_TEST_CHROME` names it; without that, on Linux, the one the server
 * itself would find. With neither the suite is skipped. A Chrome that was only found (not
 * named) and cannot start here — a CI image that forbids its sandbox — skips too: the launch
 * failure itself is covered against the fake pipe. On macOS and Windows the suite runs only
 * when the variable names a Chrome.
 */
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostedBrowserFrame } from "../../src/api/types.js";
import { findChrome, launchChrome } from "../../src/builtin-browser/hosted-chrome.js";
import type { CdpPipe } from "../../src/builtin-browser/hosted-chrome.js";
import { jpegSize } from "../../src/builtin-browser/hosted-view.js";
import { BrowserUnavailableError, BuiltinBrowser } from "../../src/builtin-browser/service.js";

const named = process.env.PENGUIN_TEST_CHROME;
const chromePath =
  named !== undefined && named !== "" ? named : process.platform === "linux" ? findChrome() : null;

const PAGE = `<!doctype html>
<title>Live test</title>
<style>body { margin: 0 } #go { position: absolute; left: 100px; top: 100px; width: 200px; height: 100px }</style>
<h1>Hosted Chrome</h1>
<button id="go" onclick="this.textContent = 'Clicked ' + (window.n = (window.n || 0) + 1)">Click me</button>
<input id="name" style="position: absolute; left: 100px; top: 300px">`;

const admin = { userId: "admin", isAdmin: true };

async function until(ready: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe.skipIf(chromePath === null)("the hosted backend on a real Chrome", () => {
  let root: string;
  let site: http.Server;
  let origin: string;
  let browser: BuiltinBrowser;
  const pipes: CdpPipe[] = [];
  const exits: Promise<unknown>[] = [];
  const logs: string[] = [];

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-hosted-live-"));
    site = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
    browser = new BuiltinBrowser({
      port: null,
      root,
      publish: () => {},
      log: (line) => logs.push(line),
      hosted: {
        host: {
          find: () => chromePath,
          launch: (file, profileDir) => {
            const pipe = launchChrome(file, profileDir);
            pipes.push(pipe);
            exits.push(new Promise((resolve) => pipe.onClose(resolve)));
            return pipe;
          },
        },
      },
    });
  });

  afterAll(async () => {
    browser.dispose();
    await Promise.all(exits);
    await browser.history.flush();
    await new Promise((resolve) => site.close(resolve));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("opens, scans, clicks and types, shows the page, takes a viewer's click, and exits", async (ctx) => {
    // The status starts nothing.
    expect(await browser.status(admin)).toMatchObject({ backend: "hosted", available: true });
    expect(pipes).toHaveLength(0);

    let tab;
    try {
      tab = await browser.openTab(admin, { url: `${origin}/` });
    } catch (err) {
      if (named === undefined && err instanceof BrowserUnavailableError) {
        // Found but not startable here; see the module doc.
        ctx.skip();
      }
      throw new Error(`Chrome did not start: ${String(err)}\n${logs.join("\n")}`);
    }
    expect(tab).toMatchObject({ url: `${origin}/`, loading: false });
    // Chrome names the page a moment after it has loaded.
    await until(
      async () => (await browser.listTabs(admin)).tabs[0]?.title === "Live test",
      "the tab's title",
    );
    // The blank page a tab is created on is nowhere to go back to.
    await until(
      async () => (await browser.listTabs(admin)).tabs[0]?.canGoBack === false,
      "the blank page to leave the history",
    );
    const status = await browser.status(admin);
    expect(status.backends[0]?.chrome).toMatchObject({ path: chromePath, running: true });
    expect(status.backends[0]?.chrome?.version).toMatch(/^\d+\.\d+/);
    const profile = path.join(root, "builtin-browser", "hosted-profile");
    expect((await fs.stat(profile)).isDirectory()).toBe(true);

    const scanned = await browser.scan(admin, "active", {});
    expect(scanned.content).toContain("Click me");

    const clicked = await browser.click(admin, "active", { selector: "#go" }, {});
    expect(clicked.status).toBe("success");
    const typed = await browser.type(admin, "active", { text: "hello", selector: "#name" });
    expect(typed.status).toBe("success");
    const read = await browser.exec(
      admin,
      "active",
      "return [document.querySelector('#go').textContent, document.querySelector('#name').value];",
      { noMonitor: true },
    );
    expect(read.value).toEqual(["Clicked 1", "hello"]);

    // A viewer: the page laid out to their panel, and a frame of it.
    const hosted = browser.hostedFor(admin);
    const frames: HostedBrowserFrame[] = [];
    const leave = hosted.viewOf(tab.id, { width: 800, height: 600 }).watch({
      write: async (frame) => void frames.push(frame),
      end: () => {},
    });
    // (A frame taken while the page is being laid out anew may still have the old shape.)
    const atPanelSize = (frame: HostedBrowserFrame) => frame.width === 800 && frame.height === 600;
    await until(() => frames.some(atPanelSize), "a frame at the panel's size");
    expect(jpegSize(frames.findLast(atPanelSize)!.data)).toEqual({ width: 800, height: 600 });

    // Their click on the picture lands on the page's button, and the picture follows.
    const seen = frames.length;
    await hosted.input(tab.id, {
      events: [
        { type: "mouse", action: "move", x: 200, y: 150 },
        { type: "mouse", action: "down", x: 200, y: 150, button: "left", buttons: 1 },
        { type: "mouse", action: "up", x: 200, y: 150, button: "left" },
      ],
    });
    await until(async () => {
      const text = await browser.exec(
        admin,
        "active",
        "return document.querySelector('#go').textContent;",
        { noMonitor: true },
      );
      return text.value === "Clicked 2";
    }, "the viewer's click to reach the page");
    await until(() => frames.length > seen, "a frame of the changed page");
    leave();

    browser.dispose();
    await Promise.all(exits);
    expect(pipes).toHaveLength(1);
  }, 120_000);
});
