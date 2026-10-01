/**
 * The helpers vite.config.ts is built from.
 *
 * - The dev server's `/api` proxy defaults to the development backend (7368, not the installed
 *   server's 7364), follows PORT, treats an empty PORT as unset rather than as port 80, and is
 *   replaced outright by PENGUIN_API_PROXY unless that is empty.
 * - KaTeX's stylesheet ships woff2 only: the woff and truetype fallbacks are dropped, and a
 *   stylesheet without them is left untouched.
 */
import { describe, expect, it } from "vitest";
import { apiProxyTarget, dropNonWoff2FontSources } from "../vite.config.js";

describe("apiProxyTarget", () => {
  it("defaults to the development backend, not the installed server's 7364", () => {
    expect(apiProxyTarget({})).toBe("http://127.0.0.1:7368");
  });

  it("treats an empty PORT as unset rather than as port 80", () => {
    expect(apiProxyTarget({ PORT: "" })).toBe("http://127.0.0.1:7368");
  });

  it("follows PORT so moving the backend moves the proxy with it", () => {
    expect(apiProxyTarget({ PORT: "9999" })).toBe("http://127.0.0.1:9999");
  });

  it("PENGUIN_API_PROXY replaces the whole target, PORT and all", () => {
    expect(apiProxyTarget({ PORT: "9999", PENGUIN_API_PROXY: "http://10.0.0.2:8080" })).toBe(
      "http://10.0.0.2:8080",
    );
  });

  it("an empty PENGUIN_API_PROXY falls back instead of proxying to nowhere", () => {
    expect(apiProxyTarget({ PENGUIN_API_PROXY: "" })).toBe("http://127.0.0.1:7368");
  });
});

describe("KaTeX fonts ship locally, woff2 only", () => {
  const SRC = `@font-face{font-display:block;font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(fonts/KaTeX_Main-Regular.woff) format("woff"),url(fonts/KaTeX_Main-Regular.ttf) format("truetype")}`;

  it("keeps the woff2 source and drops the woff and truetype ones", () => {
    const stripped = dropNonWoff2FontSources(SRC);
    expect(stripped).toContain('url(fonts/KaTeX_Main-Regular.woff2) format("woff2")');
    expect(stripped).not.toContain(".woff)");
    expect(stripped).not.toContain(".ttf)");
    expect(stripped).toContain("font-family:KaTeX_Main");
  });

  it("leaves a stylesheet that has no fallbacks untouched", () => {
    const only = `@font-face{src:url(fonts/A.woff2) format("woff2")}`;
    expect(dropNonWoff2FontSources(only)).toBe(only);
  });
});
