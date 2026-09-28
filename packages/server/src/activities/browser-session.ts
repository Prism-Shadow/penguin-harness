/**
 * One page of the test browser, opened on a URL.
 *
 * Quality checks and acceptance tests open an activity's player with this, using the
 * executable `TestBrowser.executablePath()` names and the link `TestBrowser.playUrl()`
 * signs. It is a plain module, not a kernel service: a browser and a page are live objects
 * that must not cross the kernel boundary, and each caller owns the one it opened — it
 * calls `close()` in a `finally`, whatever happened on the page.
 *
 * The launcher is injectable, so a test drives a fake and never starts a browser.
 */
import type { Browser, LaunchOptions, Page } from "playwright-core";

/** The part of a Playwright browser a session uses. */
export type SessionBrowser = Pick<Browser, "newContext" | "close">;

/** Starts a browser. The default is `playwright-core`'s `chromium.launch`. */
export type BrowserLauncher = (options: LaunchOptions) => Promise<SessionBrowser>;

export interface Viewport {
  width: number;
  height: number;
}

export interface OpenPageOptions {
  /** How long the browser may take to start and the page to load, and each page action. */
  timeoutMs: number;
  launcher?: BrowserLauncher;
  /**
   * Record the page to a WebM in this directory, at the viewport's size. The file is written
   * when the page's context closes (see video-render.ts).
   */
  recordVideoDir?: string;
}

export interface BrowserSession {
  page: Page;
  /** Closes the browser. Safe to call more than once. */
  close(): Promise<void>;
}

/** `playwright-core`'s Chromium launcher, loaded only when a browser is really wanted. */
async function chromiumLauncher(): Promise<BrowserLauncher> {
  const { chromium } = await import("playwright-core");
  return (options) => chromium.launch(options);
}

/**
 * Starts the browser, opens `url` in a fresh context at `viewport`, and returns the page.
 * Anything that fails before the page is handed over closes the browser here; after that,
 * closing it is the caller's.
 */
export async function openPage(
  executablePath: string,
  url: string,
  viewport: Viewport,
  options: OpenPageOptions,
): Promise<BrowserSession> {
  const launch = options.launcher ?? (await chromiumLauncher());
  const browser = await launch({ executablePath, headless: true, timeout: options.timeoutMs });
  let closed: Promise<void> | null = null;
  const close = () => (closed ??= browser.close().catch(() => {}));
  try {
    const context = await browser.newContext({
      viewport,
      ...(options.recordVideoDir
        ? { recordVideo: { dir: options.recordVideoDir, size: viewport } }
        : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    await page.goto(url, { timeout: options.timeoutMs, waitUntil: "load" });
    return { page, close };
  } catch (error) {
    await close();
    throw error;
  }
}
