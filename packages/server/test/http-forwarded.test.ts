/**
 * Reading where the browser addressed a request (http/forwarded.ts): the forwarded headers
 * count only when trusted, only their client-facing hop, and only in a shape a URL can take.
 */
import { describe, expect, it } from "vitest";
import { clientOrigin, forwardedHeaders, forwardedPrefix } from "../src/http/forwarded.js";
import { requestOrigin } from "../src/http/routes/model-oauth.js";

describe("forwarded headers", () => {
  it("reads the three headers and leaves absent ones out", () => {
    const headers = new Headers({
      "x-forwarded-host": "hub.example.test",
      "x-forwarded-prefix": "/p",
    });
    expect(forwardedHeaders((name) => headers.get(name))).toEqual({
      host: "hub.example.test",
      prefix: "/p",
    });
  });

  it("is ignored outright when not trusted", () => {
    const fwd = { proto: "https", host: "hub.example.test", prefix: "/server/m1" };
    expect(clientOrigin("http://localhost:7364/api/x", fwd, false)).toBe("http://localhost:7364");
    expect(forwardedPrefix(fwd, false)).toBe("");
  });

  it("takes the client-facing hop and falls back per field on a malformed value", () => {
    expect(
      clientOrigin(
        "http://localhost:7364/api/x",
        { proto: "https, http", host: "a.example.test:8443, b" },
        true,
      ),
    ).toBe("https://a.example.test:8443");
    expect(
      clientOrigin("http://localhost:7364/api/x", { proto: "ftp", host: "evil.test/x?" }, true),
    ).toBe("http://localhost:7364");
    expect(clientOrigin("http://localhost:7364/api/x", { host: "[::1]:53531" }, true)).toBe(
      "http://[::1]:53531",
    );
  });

  it("accepts a prefix of plain path segments only", () => {
    expect(forwardedPrefix({ prefix: "/server/Qm9h-c_1/" }, true)).toBe("/server/Qm9h-c_1");
    expect(forwardedPrefix({ prefix: "/a, /b" }, true)).toBe("/a");
    for (const bad of ["//evil.test", "/a/../b", "server/x", "/a?b", "/a#b", "/a b", "/"]) {
      expect(forwardedPrefix({ prefix: bad }, true)).toBe("");
    }
  });
});

describe("callback origin with a prefix", () => {
  it("appends the forwarded prefix to the forwarded origin", () => {
    expect(
      requestOrigin(
        "http://localhost:7364/api/projects/p/model-oauth/start",
        { proto: "http", host: "hub.example.test:53531", prefix: "/server/m1" },
        true,
      ),
    ).toBe("http://hub.example.test:53531/server/m1");
    expect(
      requestOrigin(
        "http://localhost:7364/api/x",
        { host: "hub.example.test", prefix: "/server/m1" },
        false,
      ),
    ).toBe("http://localhost:7364");
  });
});
