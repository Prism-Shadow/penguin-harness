/**
 * Pure-part tests for the OS-proxy injection (no Electron runtime): PAC-result parsing
 * and the "never override an existing variable" selection.
 */
import { describe, expect, it } from "vitest";
import { proxyUrlFromPacResult, unsetProxyVars } from "../src/os-proxy.js";

describe("proxyUrlFromPacResult", () => {
  it("maps PROXY to an http:// URL and HTTPS to an https:// URL", () => {
    expect(proxyUrlFromPacResult("PROXY 127.0.0.1:8888")).toBe("http://127.0.0.1:8888");
    expect(proxyUrlFromPacResult("HTTPS proxy.corp.example:443")).toBe(
      "https://proxy.corp.example:443",
    );
    expect(proxyUrlFromPacResult("proxy proxy.corp.example:3128")).toBe(
      "http://proxy.corp.example:3128",
    );
  });

  it("takes the first usable entry of a fallback list", () => {
    expect(proxyUrlFromPacResult("PROXY 10.0.0.1:8080; DIRECT")).toBe("http://10.0.0.1:8080");
    expect(proxyUrlFromPacResult("DIRECT; PROXY 10.0.0.1:8080")).toBe("http://10.0.0.1:8080");
  });

  it("yields nothing for DIRECT and for SOCKS entries (undici cannot speak SOCKS)", () => {
    expect(proxyUrlFromPacResult("DIRECT")).toBeNull();
    expect(proxyUrlFromPacResult("SOCKS5 127.0.0.1:1080")).toBeNull();
    expect(proxyUrlFromPacResult("SOCKS 127.0.0.1:1080; DIRECT")).toBeNull();
    expect(proxyUrlFromPacResult("")).toBeNull();
  });
});

describe("unsetProxyVars", () => {
  it("selects both variables on a clean environment", () => {
    expect(unsetProxyVars({}).map((v) => v.name)).toEqual(["HTTP_PROXY", "HTTPS_PROXY"]);
  });

  it("skips a variable already present in either spelling (never overridden)", () => {
    expect(unsetProxyVars({ HTTP_PROXY: "http://a:1" }).map((v) => v.name)).toEqual([
      "HTTPS_PROXY",
    ]);
    expect(unsetProxyVars({ https_proxy: "http://a:1" }).map((v) => v.name)).toEqual([
      "HTTP_PROXY",
    ]);
    expect(unsetProxyVars({ HTTP_PROXY: "http://a:1", https_proxy: "http://a:1" })).toEqual([]);
  });
});
