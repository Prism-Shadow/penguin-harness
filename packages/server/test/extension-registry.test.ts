/**
 * Extension registry tests: the shared index format (strict whole-document validation —
 * one malformed row fails the artifact, unlike extensions.json's per-entry tolerance),
 * the builtin registry serving the embedded four sandbox backends, the HTTP registry
 * running a fetched document through the same validator (fetch stubbed, no network),
 * and GET /api/extensions behind the auth gate.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionIndexEntry, ExtensionIndexResponse } from "../src/api/types.js";
import {
  BUILTIN_REGISTRY_SOURCE,
  builtinExtensionRegistry,
  httpExtensionRegistry,
  parseExtensionIndex,
} from "../src/extension/registry.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const VALID_ENTRY: ExtensionIndexEntry = {
  name: "@example/penguin-extension-demo",
  version: "1.0.0",
  description: "A demo extension.",
  authors: ["Example"],
  license: "MIT",
};

describe("parseExtensionIndex", () => {
  it("accepts a flat array of per-version entries and preserves order", () => {
    const doc = [
      VALID_ENTRY,
      { ...VALID_ENTRY, version: "1.1.0", keywords: ["linux"], updatedAt: 1755600000 },
    ];
    const parsed = parseExtensionIndex(doc, "test");
    expect(parsed.map((e) => e.version)).toEqual(["1.0.0", "1.1.0"]);
  });

  it("rejects a non-array document and names the source", () => {
    expect(() => parseExtensionIndex({ extensions: [] }, "https://x.example/index.json")).toThrow(
      /https:\/\/x\.example\/index\.json is not an array/,
    );
  });

  it("rejects the whole document on one malformed entry, naming its position", () => {
    for (const bad of [
      null,
      { ...VALID_ENTRY, version: 2 },
      { ...VALID_ENTRY, authors: "Example" },
      { ...VALID_ENTRY, keywords: [1] },
      { ...VALID_ENTRY, updatedAt: "yesterday" },
    ]) {
      expect(() => parseExtensionIndex([VALID_ENTRY, bad], "test")).toThrow(
        /malformed entry at index 1/,
      );
    }
  });
});

describe("builtinExtensionRegistry", () => {
  it("serves the four sandbox backends, valid under the shared format", async () => {
    const registry = builtinExtensionRegistry();
    expect(registry.source).toBe(BUILTIN_REGISTRY_SOURCE);
    const entries = await registry.index();
    expect(entries.map((e) => e.name)).toEqual([
      "@prismshadow/penguin-extension-sandbox-bwrap",
      "@prismshadow/penguin-extension-sandbox-seatbelt",
      "@prismshadow/penguin-extension-sandbox-mxc",
      "@prismshadow/penguin-extension-sandbox-dsh",
    ]);
    for (const entry of entries) {
      expect(entry.categories).toEqual(["sandbox"]);
      expect(entry.license).toBe("Apache-2.0");
    }
  });
});

describe("httpExtensionRegistry", () => {
  const url = "https://registry.example/index.json";

  it("fetches the index URL and validates the document with the shared parser", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return new Response(JSON.stringify([VALID_ENTRY]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const entries = await httpExtensionRegistry(url, fetchImpl).index();
    expect(seen).toEqual([url]);
    expect(entries).toEqual([VALID_ENTRY]);
  });

  it("fails on an HTTP error status, on non-JSON, and on a malformed document", async () => {
    const respond =
      (body: string, status = 200) =>
      async () =>
        new Response(body, { status });
    await expect(httpExtensionRegistry(url, respond("[]", 503)).index()).rejects.toThrow(
      /HTTP 503/,
    );
    await expect(httpExtensionRegistry(url, respond("not json")).index()).rejects.toThrow(
      /not valid JSON/,
    );
    await expect(httpExtensionRegistry(url, respond('{"extensions":[]}')).index()).rejects.toThrow(
      /not an array/,
    );
  });
});

describe("GET /api/extensions", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("requires auth, then serves the builtin index", async () => {
    expect((await t.app.request("/api/extensions")).status).toBe(401);

    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/extensions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExtensionIndexResponse;
    expect(body.extensions).toHaveLength(4);
    expect(body.extensions.every((p) => p.name.startsWith("@prismshadow/penguin-extension-"))).toBe(
      true,
    );
  });
});
