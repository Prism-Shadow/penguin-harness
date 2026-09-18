import { describe, expect, it } from "vitest";
import {
  appOriginFor,
  classifyWindowOpen,
  desktopLoginUrl,
  hidesOnClose,
  isAppUrl,
  isAuthorizationBridgeUrl,
  isExternalScheme,
  isLocalSurfaceUrl,
  parsePortFile,
  restartDelayMs,
  urlForLog,
} from "../src/util.js";

describe("parsePortFile", () => {
  it("accepts a port with surrounding whitespace", () => {
    expect(parsePortFile("17365\n")).toBe(17365);
    expect(parsePortFile("  80  ")).toBe(80);
  });
  it("rejects garbage, empty, zero, and out-of-range values", () => {
    expect(parsePortFile("")).toBeNull();
    expect(parsePortFile("abc")).toBeNull();
    expect(parsePortFile("0")).toBeNull();
    expect(parsePortFile("65536")).toBeNull();
    expect(parsePortFile("12 34")).toBeNull();
  });
});

describe("app origin and login URL", () => {
  it("builds the localhost origin and the one-shot login URL", () => {
    expect(appOriginFor(7364)).toBe("http://localhost:7364");
    expect(desktopLoginUrl("http://localhost:7364", "a b/c")).toBe(
      "http://localhost:7364/api/auth/claim?token=a%20b%2Fc",
    );
  });
});

describe("isAppUrl", () => {
  const origin = "http://localhost:7364";
  it("accepts only the app origin", () => {
    expect(isAppUrl("http://localhost:7364/chat", origin)).toBe(true);
    expect(isAppUrl("http://localhost:7365/", origin)).toBe(false);
    expect(isAppUrl("http://127.0.0.1:7364/preview/x", origin)).toBe(false);
    expect(isAppUrl("https://example.com", origin)).toBe(false);
    expect(isAppUrl("not a url", origin)).toBe(false);
    expect(isAppUrl("http://localhost:7364/", null)).toBe(false);
  });
});

describe("isLocalSurfaceUrl", () => {
  const origin = "http://localhost:7364";
  it("accepts the app origin and its loopback counterpart on the same port", () => {
    // The counterpart is where Workspace previews are served: a preview window must be
    // able to reach it, which the stricter app-origin rule would deny.
    expect(isLocalSurfaceUrl("http://localhost:7364/chat", origin)).toBe(true);
    expect(isLocalSurfaceUrl("http://127.0.0.1:7364/preview/tok/x.html", origin)).toBe(true);
  });
  it("rejects other ports, other hosts, other schemes, and junk", () => {
    expect(isLocalSurfaceUrl("http://127.0.0.1:7365/preview/x", origin)).toBe(false);
    expect(isLocalSurfaceUrl("http://example.com:7364/", origin)).toBe(false);
    expect(isLocalSurfaceUrl("https://localhost:7364/", origin)).toBe(false);
    expect(isLocalSurfaceUrl("not a url", origin)).toBe(false);
    expect(isLocalSurfaceUrl("http://localhost:7364/", null)).toBe(false);
  });
});

describe("classifyWindowOpen", () => {
  const origin = "http://localhost:7364";

  it("gives the Workspace preview hand-off a window of the app", () => {
    // It mints the preview token with the session cookie, so the system browser would get a 401.
    expect(
      classifyWindowOpen(
        "http://localhost:7364/api/sessions/s-1/files/preview-redirect?path=out%2Fpelican-bike.html",
        origin,
      ),
    ).toBe("window");
  });

  it("gives a page on the preview host a window of the app", () => {
    expect(
      classifyWindowOpen("http://127.0.0.1:7364/preview/tok.sig/out/pelican-bike.html", origin),
    ).toBe("window");
  });

  it("gives a detached terminal a window of the app", () => {
    // The opener keeps the returned window to put the tab back when it closes.
    expect(classifyWindowOpen("http://localhost:7364/terminal?id=t-1", origin)).toBe("window");
  });

  it("refuses a relative chat link resolved onto an SPA route", () => {
    // The reported reply's [pelican-bike.html](pelican-bike.html), as the chat page resolves it:
    // a window here was a second copy of the App, one more per click.
    expect(classifyWindowOpen("http://localhost:7364/chat/pelican-bike.html", origin)).toBe("deny");
    expect(classifyWindowOpen("http://localhost:7364/", origin)).toBe("deny");
    expect(classifyWindowOpen("http://localhost:7364/chat/s-1#user-content-fn-1", origin)).toBe(
      "deny",
    );
  });

  it("refuses near misses of the allowed shapes", () => {
    for (const url of [
      // Other API routes, and the hand-off's path with a segment added or taken away.
      "http://localhost:7364/api/sessions/s-1/files/content?path=a.html",
      "http://localhost:7364/api/sessions/s-1/files/preview-redirect/extra",
      "http://localhost:7364/api/sessions/files/preview-redirect",
      // Dot segments resolve before the path is matched.
      "http://localhost:7364/api/sessions/s-1/files/preview-redirect/../../../../chat",
      "http://localhost:7364/terminal/other",
      // A preview path on the app host, and a non-preview path on the preview host: the
      // preview host 302s that back to the App.
      "http://localhost:7364/preview/tok/x.html",
      "http://127.0.0.1:7364/chat/pelican-bike.html",
      "http://127.0.0.1:7364/terminal?id=t-1",
      // The IPv6 loopback on the same port is this instance too, but serves no preview.
      "http://[::1]:7364/preview/tok/x.html",
    ]) {
      expect(classifyWindowOpen(url, origin), url).toBe("deny");
    }
  });

  it("sends other sites and other local ports to the system browser", () => {
    expect(classifyWindowOpen("https://example.com/docs", origin)).toBe("external");
    expect(classifyWindowOpen("mailto:someone@example.com", origin)).toBe("external");
    // A dev server a conversation started lives on its own port.
    expect(classifyWindowOpen("http://localhost:3000/", origin)).toBe("external");
    expect(classifyWindowOpen("http://127.0.0.1:3000/preview/x", origin)).toBe("external");
    // Another scheme on the same port is not this instance either.
    expect(classifyWindowOpen("https://localhost:7364/chat", origin)).toBe("external");
  });

  it("never hands a non-web scheme or junk to the system", () => {
    for (const url of [
      "file:///C:/Windows/System32/calc.exe",
      "javascript:alert(1)",
      "vscode://file/home/user/a.ts",
      "not a url",
    ]) {
      expect(classifyWindowOpen(url, origin), url).toBe("deny");
    }
  });

  it("with no origin yet, a non-web scheme is still refused", () => {
    expect(classifyWindowOpen("file:///etc/passwd", null)).toBe("deny");
  });

  it("refuses the Penguin Go authorization bridge, which only the main window may open", () => {
    // The main window's handler allows the bridge before it classifies anything. Every window
    // shares this classification, so a preview page asking for about:blank gets no window.
    expect(isAuthorizationBridgeUrl("about:blank")).toBe(true);
    expect(classifyWindowOpen("about:blank", origin)).toBe("deny");
  });
});

describe("isAuthorizationBridgeUrl", () => {
  it("accepts only the inert blank window used while authorization starts", () => {
    expect(isAuthorizationBridgeUrl("about:blank")).toBe(true);
    expect(isAuthorizationBridgeUrl("about:blank#other")).toBe(false);
    expect(isAuthorizationBridgeUrl("about:srcdoc")).toBe(false);
    expect(isAuthorizationBridgeUrl("https://example.com")).toBe(false);
  });
});

describe("isExternalScheme", () => {
  it("accepts web pages and mail links only", () => {
    expect(isExternalScheme("https://example.com")).toBe(true);
    expect(isExternalScheme("http://localhost:3000/")).toBe(true);
    expect(isExternalScheme("mailto:someone@example.com")).toBe(true);
    expect(isExternalScheme("file:///etc/passwd")).toBe(false);
    expect(isExternalScheme("ms-settings:privacy")).toBe(false);
    expect(isExternalScheme("data:text/html,<p>x</p>")).toBe(false);
    expect(isExternalScheme("/relative")).toBe(false);
  });
});

describe("urlForLog", () => {
  it("keeps origin and path, and drops what can carry a token", () => {
    expect(urlForLog("http://localhost:7364/api/auth/claim?token=secret#frag")).toBe(
      "http://localhost:7364/api/auth/claim",
    );
    expect(urlForLog("file:///home/user/secret.txt")).toBe("a file: URL");
    expect(urlForLog("not a url")).toBe("an unparsable URL");
  });
});

describe("restartDelayMs", () => {
  it("doubles from 1s and caps at 8s", () => {
    expect([0, 1, 2, 3, 4].map(restartDelayMs)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });
});

describe("hidesOnClose", () => {
  const state = (over: Partial<Parameters<typeof hidesOnClose>[0]> = {}) => ({
    quitting: false,
    trayShown: true,
    closeToTray: true,
    ...over,
  });

  it("hides the window only while a tray icon can bring it back", () => {
    expect(hidesOnClose(state())).toBe(true);
    expect(hidesOnClose(state({ closeToTray: false }))).toBe(false);
  });

  it("lets the close through when there is no tray icon", () => {
    // The Appearance switch turned it off, or the platform could not host one. A hidden
    // window with nothing to restore it is a running app the user cannot reach: the close
    // has to proceed instead, leaving the app in the Dock on macOS and quitting elsewhere.
    expect(hidesOnClose(state({ trayShown: false }))).toBe(false);
    expect(hidesOnClose(state({ trayShown: false, closeToTray: false }))).toBe(false);
  });

  it("never intercepts the close a quit runs", () => {
    expect(hidesOnClose(state({ quitting: true }))).toBe(false);
  });
});
