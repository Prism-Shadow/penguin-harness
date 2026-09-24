/**
 * The built-in browser's address bar rules (features/builtin-browser/address.ts): what a typed
 * line loads — the address as typed, a bare host with a scheme, or a Bing search — and how a
 * page's address, title and favicon are shown back.
 */
import { describe, expect, it } from "vitest";
import {
  BLANK_URL,
  SEARCH_URL,
  displayAddress,
  faviconSrc,
  isBlankUrl,
  isWebUrl,
  normalizeAddress,
  tabLabel,
} from "../src/features/builtin-browser/address";

const search = (q: string) => `${SEARCH_URL}${encodeURIComponent(q)}`;

describe("normalizeAddress", () => {
  it("loads nothing for blank input", () => {
    expect(normalizeAddress("")).toBeNull();
    expect(normalizeAddress("   ")).toBeNull();
  });

  it("takes web addresses as typed, normalised by the URL parser", () => {
    expect(normalizeAddress("https://www.amazon.com/your-orders/orders")).toBe(
      "https://www.amazon.com/your-orders/orders",
    );
    expect(normalizeAddress("  HTTP://Example.COM  ")).toBe("http://example.com/");
    expect(normalizeAddress("http://localhost:3000")).toBe("http://localhost:3000/");
  });

  it("gives a bare public host https", () => {
    expect(normalizeAddress("amazon.com")).toBe("https://amazon.com/");
    expect(normalizeAddress("amazon.com/your-orders")).toBe("https://amazon.com/your-orders");
    expect(normalizeAddress("www.example.co.uk:8443/a?b=1#c")).toBe(
      "https://www.example.co.uk:8443/a?b=1#c",
    );
    expect(normalizeAddress("wikipedia.org?search=penguin")).toBe(
      "https://wikipedia.org/?search=penguin",
    );
  });

  it("gives loopback and IP addresses plain http", () => {
    expect(normalizeAddress("localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizeAddress("app.localhost/x")).toBe("http://app.localhost/x");
    expect(normalizeAddress("127.0.0.1:8080/api")).toBe("http://127.0.0.1:8080/api");
    expect(normalizeAddress("192.168.1.1")).toBe("http://192.168.1.1/");
    expect(normalizeAddress("[::1]:3000")).toBe("http://[::1]:3000/");
  });

  it("accepts an internationalised domain name", () => {
    expect(normalizeAddress("例子.测试")).toBe("https://xn--fsqu00a.xn--0zwm56d/");
  });

  it("searches for anything that is not an address", () => {
    expect(normalizeAddress("penguin")).toBe(search("penguin"));
    expect(normalizeAddress("how to use amazon.com")).toBe(search("how to use amazon.com"));
    expect(normalizeAddress("1.5")).toBe(search("1.5"));
    expect(normalizeAddress("企鹅 浏览器")).toBe(search("企鹅 浏览器"));
    expect(normalizeAddress("https://")).toBe(search("https://"));
  });

  it("never loads another scheme: file, script and data text is a search", () => {
    for (const text of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<b>x</b>",
      "chrome://settings",
      "mailto:someone@example.com",
      "about:config",
    ]) {
      expect(normalizeAddress(text)).toBe(search(text));
    }
  });

  it("keeps the blank page a new tab starts on", () => {
    expect(normalizeAddress("about:blank")).toBe(BLANK_URL);
    expect(normalizeAddress("ABOUT:BLANK")).toBe(BLANK_URL);
  });

  it("does not take an out-of-range IPv4 address for a host", () => {
    expect(normalizeAddress("999.1.1.1")).toBe(search("999.1.1.1"));
  });
});

describe("address display", () => {
  it("shows a blank tab's address as empty", () => {
    expect(displayAddress(BLANK_URL)).toBe("");
    expect(displayAddress("")).toBe("");
    expect(displayAddress("https://example.com/")).toBe("https://example.com/");
    expect(isBlankUrl(BLANK_URL)).toBe(true);
    expect(isBlankUrl("https://example.com/")).toBe(false);
  });

  it("recognises the pages the system browser may open", () => {
    expect(isWebUrl("https://example.com/")).toBe(true);
    expect(isWebUrl("http://localhost:3000/")).toBe(true);
    expect(isWebUrl(BLANK_URL)).toBe(false);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("not a url")).toBe(false);
  });

  it("names a tab by its title, else its host, else its address", () => {
    expect(tabLabel({ title: " Your Orders ", url: "https://amazon.com/" }, "New tab")).toBe(
      "Your Orders",
    );
    expect(tabLabel({ title: "", url: "https://www.amazon.com/x" }, "New tab")).toBe(
      "www.amazon.com",
    );
    expect(tabLabel({ title: "", url: BLANK_URL }, "New tab")).toBe("New tab");
    expect(tabLabel({ title: "", url: "" }, "New tab")).toBe("New tab");
  });
});

describe("faviconSrc", () => {
  const app = "http://127.0.0.1:7788";

  it("loads a web favicon from another origin, and an image data URL", () => {
    expect(faviconSrc("https://www.amazon.com/favicon.ico", app)).toBe(
      "https://www.amazon.com/favicon.ico",
    );
    expect(faviconSrc("data:image/png;base64,AAAA", app)).toBe("data:image/png;base64,AAAA");
  });

  it("refuses the app's own origin, other schemes and nothing", () => {
    // A page may name any URL as its icon; one on the app's origin would carry its cookie.
    expect(faviconSrc(`${app}/api/me`, app)).toBeNull();
    expect(faviconSrc("javascript:alert(1)", app)).toBeNull();
    expect(faviconSrc("data:text/html,<b>x</b>", app)).toBeNull();
    expect(faviconSrc("", app)).toBeNull();
    expect(faviconSrc(undefined, app)).toBeNull();
  });
});
