/**
 * Dev-server `/api` proxy target resolution (vite.config.ts). The interesting case is an
 * empty `PORT=`: shells export it, `.env` files carry it, and resolving it to a bare
 * `http://127.0.0.1:` sends every API call to port 80 without ever failing — a wrong backend
 * is far harder to notice than a broken one, so the empty case is pinned here.
 */
import { describe, expect, it } from "vitest";
import { apiProxyTarget } from "../vite.config.js";

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
