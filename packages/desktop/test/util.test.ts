import { describe, expect, it } from "vitest";
import {
  appOriginFor,
  desktopLoginUrl,
  isAppUrl,
  isLocalSurfaceUrl,
  isRendererCrash,
  parsePortFile,
  restartDelayMs,
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
      "http://localhost:7364/api/auth/desktop-login?token=a%20b%2Fc",
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

describe("restartDelayMs", () => {
  it("doubles from 1s and caps at 8s", () => {
    expect([0, 1, 2, 3, 4].map(restartDelayMs)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });
});

describe("isRendererCrash", () => {
  it("treats every abnormal end of the render process as a crash", () => {
    for (const reason of ["crashed", "oom", "killed", "abnormal-exit", "launch-failed"]) {
      expect(isRendererCrash(reason)).toBe(true);
    }
  });

  it("excludes a clean exit, which is the window on its way out", () => {
    expect(isRendererCrash("clean-exit")).toBe(false);
  });
});
