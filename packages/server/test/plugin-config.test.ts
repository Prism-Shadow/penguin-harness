/**
 * Plugin configuration: a module DECLARES a settings group as a contribution (manifest data),
 * an admin fills it in on the Plugins page through /api/admin/plugin-config, and the module
 * reads the document back through the PluginConfig mechanism — defaults merged in, secrets
 * masked at the API and kept when the mask is sent back, every save handed to the watchers.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { PluginConfigResponse } from "../src/api/types.js";
import {
  PluginConfigError,
  PluginConfigStore,
  applyUpdate,
  parsePluginConfiguration,
} from "../src/plugin/config.js";
import { PluginHost } from "../src/plugin/host.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SCHEMA = parsePluginConfiguration(
  {
    title: "Acme",
    titleZh: "Acme 机器人",
    properties: {
      token: { type: "secret", title: "Token", required: true },
      project: { type: "string", title: "Project" },
      agent: { type: "string", title: "Agent", default: "default_agent" },
      enabled: { type: "boolean", title: "Enabled", default: true },
      limit: { type: "number", title: "Limit" },
    },
  },
  "acme/package.json",
)!;

describe("parsePluginConfiguration", () => {
  it("reads a declared schema and leaves an undeclared one undefined", () => {
    expect(parsePluginConfiguration(undefined, "x")).toBeUndefined();
    expect(SCHEMA.title).toBe("Acme");
    expect(Object.keys(SCHEMA.properties)).toEqual([
      "token",
      "project",
      "agent",
      "enabled",
      "limit",
    ]);
    expect(SCHEMA.properties.agent).toEqual({
      type: "string",
      title: "Agent",
      default: "default_agent",
    });
  });

  it("refuses a schema the page could not draw, naming the file", () => {
    const bad = (properties: unknown) => () =>
      parsePluginConfiguration({ properties }, "acme/package.json");
    // A Project picker is not a field type: a Project is named by its id, a string.
    expect(bad({ a: { type: "project", title: "A" } })).toThrow(/\.a\.type must be one of/);
    expect(bad({ a: { type: "colour", title: "A" } })).toThrow(
      /acme\/package.json.*\.a\.type must be one of/,
    );
    expect(bad({ a: { type: "string" } })).toThrow(/\.a\.title is required/);
    expect(bad({ "bad name": { type: "string", title: "A" } })).toThrow(
      /"bad name" is not a valid name/,
    );
    expect(bad({ a: { type: "number", title: "A", default: "1" } })).toThrow(
      /\.a\.default does not fit a number/,
    );
    expect(bad([])).toThrow(/properties must be an object/);
    expect(bad({ a: { type: "enum", title: "A" } })).toThrow(/\.a\.options must list the choices/);
    expect(bad({ a: { type: "enum", title: "A", options: [{ value: "x" }] } })).toThrow(
      /options\[0\] needs a string value and title/,
    );
    expect(
      bad({ a: { type: "enum", title: "A", options: [{ value: "x", title: "X" }], default: "y" } }),
    ).toThrow(/\.a\.default does not fit a enum/);
    expect(bad({ a: { type: "list", title: "A", maxItems: 0 } })).toThrow(
      /maxItems must be a positive integer/,
    );
  });
});

describe("applyUpdate", () => {
  it("checks types, keeps a secret sent back masked, clears on null or empty, and enforces required", () => {
    const stored = { token: "secret-token-value", project: "p" };
    const next = applyUpdate(SCHEMA, stored, { token: "secr…alue", agent: " a1 ", limit: 3 });
    expect(next).toEqual({ token: "secret-token-value", project: "p", agent: "a1", limit: 3 });
    expect(applyUpdate(SCHEMA, next, { agent: null, limit: "" })).toEqual({
      token: "secret-token-value",
      project: "p",
    });
    expect(() => applyUpdate(SCHEMA, stored, { limit: "3" })).toThrow(
      new PluginConfigError("limit", '"limit" must be a number'),
    );
    expect(() => applyUpdate(SCHEMA, stored, { colour: "red" })).toThrow(/"colour" is not a field/);
    expect(() => applyUpdate(SCHEMA, stored, { token: null })).toThrow(/"token" is required/);
    // A required field with a default is never missing.
    expect(() => applyUpdate(SCHEMA, {}, { token: "t" })).not.toThrow();
  });

  it("holds an enum to its choices and a list to trimmed, distinct lines under its cap", () => {
    const schema = parsePluginConfiguration(
      {
        properties: {
          mode: {
            type: "enum",
            title: "Mode",
            options: [
              { value: "a", title: "A" },
              { value: "b", title: "B" },
            ],
          },
          paths: { type: "list", title: "Paths", maxItems: 2 },
        },
      },
      "x",
    )!;
    expect(applyUpdate(schema, {}, { mode: "b", paths: [" /x ", "/x", "", "/y"] })).toEqual({
      mode: "b",
      paths: ["/x", "/y"],
    });
    expect(() => applyUpdate(schema, {}, { mode: "c" })).toThrow('"mode" must be one of a, b');
    expect(() => applyUpdate(schema, {}, { paths: "/x" })).toThrow(
      '"paths" must be a list of strings',
    );
    expect(() => applyUpdate(schema, {}, { paths: ["/a", "/b", "/c"] })).toThrow(
      '"paths" may hold at most 2 entries',
    );
    // An empty list clears the field.
    expect(applyUpdate(schema, { paths: ["/x"] }, { paths: [] })).toEqual({});
  });
});

describe("PluginConfigStore", () => {
  it("merges defaults, stores under the package's key, masks, and fires the watchers", () => {
    const kv = new Map<string, string>();
    const store = new PluginConfigStore({
      settings: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
      groups: () => [{ name: "@acme/bot", configuration: SCHEMA }],
    });
    expect(store.saved("@acme/bot")).toBe(false);
    expect(store.get("@acme/bot")).toEqual({ agent: "default_agent", enabled: true });
    expect(store.get("@acme/other")).toEqual({});
    const seen: Record<string, unknown>[] = [];
    const off = store.watch("@acme/bot", (v) => seen.push(v));
    const entry = store.set("@acme/bot", { token: "secret-token-value", enabled: false });
    expect(entry.values).toEqual({ token: "secr…alue", agent: "default_agent", enabled: false });
    expect(store.saved("@acme/bot")).toBe(true);
    expect(kv.get("plugin-config:@acme/bot")).toBe(
      '{"token":"secret-token-value","enabled":false}',
    );
    expect(seen).toEqual([{ token: "secret-token-value", agent: "default_agent", enabled: false }]);
    off();
    store.set("@acme/bot", { agent: "x" });
    expect(seen).toHaveLength(1);
    expect(() => store.set("@acme/other", {})).toThrow(/no settings group named "@acme\/other"/);
    expect(store.describe().map((e) => e.name)).toEqual(["@acme/bot"]);
  });
});

describe("/api/admin/plugin-config", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    const host = new PluginHost();
    host.use({
      specifier: "@acme/bot",
      modules: [
        {
          // A plugin module declaring its group: pure data, the way a generated ifaces.json carries it.
          manifest: parseManifest({
            name: "AcmeBot",
            requires: {},
            provides: {},
            contributes: { "PluginConfigProvider.groups": [{ id: "acme-bot", ...SCHEMA }] },
            children: [],
          }),
          create: () => ({ api: {} }),
        },
      ],
      replaces: [],
    });
    t = await createTestApp({ plugins: host });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("lists the declared groups, and is for admins only", async () => {
    const res = await admin.get("/api/admin/plugin-config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PluginConfigResponse;
    // The sandbox's group is ordered ahead of the rest.
    expect(body.plugins[0]!.name).toBe("sandbox");
    expect(body.plugins.slice(1)).toEqual([
      {
        name: "acme-bot",
        configuration: SCHEMA,
        values: { agent: "default_agent", enabled: true },
      },
    ]);
    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    expect((await member.get("/api/admin/plugin-config")).status).toBe(403);
    expect(
      (await member.put("/api/admin/plugin-config", { name: "acme-bot", values: {} })).status,
    ).toBe(403);
  });

  it("saves one package's values, masks the secret, and refuses what the schema refuses", async () => {
    const saved = await admin.put("/api/admin/plugin-config", {
      name: "acme-bot",
      values: { token: "secret-token-value", project: "default_project" },
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as PluginConfigResponse;
    expect(body.plugins.find((e) => e.name === "acme-bot")!.values).toEqual({
      token: "secr…alue",
      project: "default_project",
      agent: "default_agent",
      enabled: true,
    });
    expect(JSON.stringify(body)).not.toContain("secret-token-value");

    const invalid = await admin.put("/api/admin/plugin-config", {
      name: "acme-bot",
      values: { limit: "many" },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "plugin_config_invalid", message: '"limit" must be a number' },
    });
    const unknown = await admin.put("/api/admin/plugin-config", {
      name: "acme-plain",
      values: {},
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "plugin_config_unknown" } });
    const shapeless = await admin.put("/api/admin/plugin-config", {
      name: "acme-bot",
      values: [],
    });
    expect(shapeless.status).toBe(400);
  });
});
