/**
 * The same-origin proxy's pure half: which paths it claims, and how a remote's redirects are
 * re-rooted. Everything is addressed by the MACHINE'S own id rather than the ssh alias.
 */
import { describe, expect, it } from "vitest";
import { SERVER_PROXY_PREFIX, parseProxyPath, rewriteLocation } from "../src/machines/proxy.js";

/** A machine, by the id it minted. */
const A = "QS7J4YVgSovi-Z2c";

describe("parseProxyPath", () => {
  it("claims /server/<machineId>/api/… and names both halves", () => {
    expect(parseProxyPath(`${SERVER_PROXY_PREFIX}${A}/api/me`)).toEqual({
      machineId: A,
      remotePath: "/api/me",
    });
  });

  it("needs no percent-encoding — a machine id is base64url by construction", () => {
    const path = `${SERVER_PROXY_PREFIX}${A}/api/me`;
    expect(path).not.toContain("%");
    expect(parseProxyPath(path)?.machineId).toBe(A);
  });

  it("forwards ONLY /api — a remote's pages are never proxied", () => {
    expect(parseProxyPath(`${SERVER_PROXY_PREFIX}${A}/`)).toBeNull();
    expect(parseProxyPath(`${SERVER_PROXY_PREFIX}${A}/index.html`)).toBeNull();
    expect(parseProxyPath(`${SERVER_PROXY_PREFIX}${A}/preview/x`)).toBeNull();
  });

  it("declines anything that is not the proxy prefix", () => {
    expect(parseProxyPath("/api/me")).toBeNull();
    expect(parseProxyPath("/server/")).toBeNull();
    expect(parseProxyPath(`/server/${A}`)).toBeNull();
  });
});

describe("rewriteLocation", () => {
  it("re-roots an absolute redirect under this machine's prefix", () => {
    expect(rewriteLocation("/api/login", A)).toBe(`${SERVER_PROXY_PREFIX}${A}/api/login`);
  });

  it("leaves an absolute URL alone — it is not ours to re-root", () => {
    expect(rewriteLocation("https://example.com/x", A)).toBe("https://example.com/x");
  });
});
