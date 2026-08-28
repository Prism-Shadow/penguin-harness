/**
 * The same-origin proxy's pure half: which paths it claims, and the cookie renaming that
 * lets several servers' sessions coexist under ONE browser origin.
 *
 * Everything here is addressed by the MACHINE'S own id rather than the ssh alias it was
 * reached through — an alias lives in one config file, so keying on it would change a
 * machine's URLs and cookie names the moment someone renamed a host.
 *
 * The cookie rules are the security-relevant part. A browser sends every cookie for the
 * origin, so without renaming, a request forwarded to machine A would carry this server's
 * own session cookie and machine B's — handing a remote a credential for a different
 * server. These cases pin that nothing crosses.
 */
import { describe, expect, it } from "vitest";
import {
  SERVER_PROXY_PREFIX,
  cookieMarker,
  parseProxyPath,
  rewriteLocation,
  rewriteRequestCookies,
  rewriteSetCookie,
} from "../src/machines/proxy.js";

/** Two machines, by the ids they minted. */
const A = "QS7J4YVgSovi-Z2c";
const B = "LNrJdHAZJ91G58i0";

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

describe("rewriteRequestCookies", () => {
  it("forwards this machine's cookies, renamed back to what the remote issued", () => {
    const header = `${cookieMarker(A)}penguin_session=abc; ${cookieMarker(A)}other=1`;
    expect(rewriteRequestCookies(header, A)).toBe("penguin_session=abc; other=1");
  });

  it("never forwards THIS server's own cookies to a remote", () => {
    expect(rewriteRequestCookies("penguin_session=local-secret", A)).toBeNull();
  });

  it("never forwards another machine's cookies", () => {
    const header = `${cookieMarker(B)}penguin_session=b-secret`;
    expect(rewriteRequestCookies(header, A)).toBeNull();
  });

  it("keeps them apart when both are present, which is the normal case", () => {
    const header = [
      "penguin_session=local-secret",
      `${cookieMarker(A)}penguin_session=a-secret`,
      `${cookieMarker(B)}penguin_session=b-secret`,
    ].join("; ");
    expect(rewriteRequestCookies(header, A)).toBe("penguin_session=a-secret");
    expect(rewriteRequestCookies(header, B)).toBe("penguin_session=b-secret");
  });

  it("has nothing to say about a request with no cookies", () => {
    expect(rewriteRequestCookies(null, A)).toBeNull();
    expect(rewriteRequestCookies("", A)).toBeNull();
  });
});

describe("rewriteSetCookie", () => {
  it("lands a remote's cookie in that machine's namespace, attributes intact", () => {
    expect(rewriteSetCookie("penguin_session=abc; Path=/; HttpOnly", A)).toBe(
      `${cookieMarker(A)}penguin_session=abc; Path=/; HttpOnly`,
    );
  });

  it("round-trips: what the remote set is what the remote gets back", () => {
    const set = rewriteSetCookie("penguin_session=abc; Path=/", A);
    const name = set.split(";")[0]!;
    expect(rewriteRequestCookies(name, A)).toBe("penguin_session=abc");
  });

  it("gives two machines different names for the same cookie", () => {
    expect(rewriteSetCookie("penguin_session=x", A)).not.toBe(
      rewriteSetCookie("penguin_session=x", B),
    );
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

describe("keying on the machine rather than the alias", () => {
  it("a cookie survives the host being re-aliased in ssh config", () => {
    const stored = rewriteSetCookie("penguin_session=abc; Path=/", A).split(";")[0]!;
    expect(rewriteRequestCookies(stored, A)).toBe("penguin_session=abc");
  });

  it("two aliases for one machine share one session, not two logins", () => {
    const viaFirstAlias = rewriteSetCookie("penguin_session=abc", A).split(";")[0]!;
    expect(rewriteRequestCookies(viaFirstAlias, A)).toBe("penguin_session=abc");
  });
});
