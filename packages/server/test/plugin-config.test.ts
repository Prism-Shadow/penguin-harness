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
  resolveTable,
} from "../src/plugin/config.js";
import { PluginConfigPage } from "../src/plugin/config-page.js";
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
    expect(bad({ a: { type: "number", title: "A", maximum: "30" } })).toThrow(
      /\.a\.maximum must be a number/,
    );
    expect(bad({ a: { type: "number", title: "A", maximum: 3, default: 5 } })).toThrow(
      /\.a\.default does not fit/,
    );
    expect(bad({ a: { type: "string", title: "A", pattern: "(" } })).toThrow(
      /\.a\.pattern is not a valid regular expression/,
    );
    expect(bad({ a: { type: "string", title: "A", advanced: "yes" } })).toThrow(
      /\.a\.advanced must be a boolean/,
    );
  });

  it("keeps a field's advanced mark, and leaves it off a field not marked", () => {
    const schema = parsePluginConfiguration(
      {
        properties: {
          basic: { type: "boolean", title: "Basic", advanced: false },
          tuned: { type: "number", title: "Tuned", advanced: true },
        },
      },
      "acme/package.json",
    )!;
    expect(schema.properties.tuned).toEqual({ type: "number", title: "Tuned", advanced: true });
    expect(schema.properties.basic).toEqual({ type: "boolean", title: "Basic" });
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

  it("holds a number to its range and every line of a patterned field to its pattern", () => {
    const schema = parsePluginConfiguration(
      {
        properties: {
          seconds: { type: "number", title: "Seconds", minimum: 1, maximum: 30, default: 5 },
          paths: {
            type: "list",
            title: "Paths",
            pattern: "^/",
            patternErrorMessage: "must list absolute paths",
          },
          host: { type: "string", title: "Host", pattern: "^[a-z]+$" },
        },
      },
      "x",
    )!;
    expect(applyUpdate(schema, {}, { seconds: 30, paths: ["/a"], host: "box" })).toEqual({
      seconds: 30,
      paths: ["/a"],
      host: "box",
    });
    expect(() => applyUpdate(schema, {}, { seconds: 0 })).toThrow('"seconds" must be at least 1');
    expect(() => applyUpdate(schema, {}, { seconds: 600 })).toThrow('"seconds" must be at most 30');
    expect(() => applyUpdate(schema, {}, { paths: ["/a", " .ssh "] })).toThrow(
      '"paths" must list absolute paths: .ssh',
    );
    expect(() => applyUpdate(schema, {}, { host: "Box" })).toThrow(
      '"host" does not match ^[a-z]+$: Box',
    );
    // Clearing is never a violation.
    expect(applyUpdate(schema, { host: "box" }, { host: "" })).toEqual({});
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

describe("PluginConfigPage actions", () => {
  /** A page node over one sandbox card and a backend card drawn inside it. */
  function page(run: () => Promise<{ ok: boolean; message: string; settled?: Promise<void> }>) {
    const saves: string[] = [];
    const node = new PluginConfigPage() as unknown as {
      entries: unknown;
      pluginConfigAdmin: {
        run(name: string, action: string): Promise<Record<string, unknown>>;
      };
      setup(ctx: unknown): void;
    };
    node.entries = {
      describe: () => [
        { name: "sandbox", configuration: { properties: {} }, values: {} },
        { name: "backend", parent: "sandbox", configuration: { properties: {} }, values: {} },
      ],
      set: () => {
        throw new Error("unused");
      },
    };
    node.setup({
      contributions: {
        status: [
          {
            data: { group: "sandbox" },
            code: { notices: () => [], saved: async () => void saves.push("sandbox") },
          },
          {
            data: { group: "backend" },
            code: { notices: () => [], actions: () => [{ id: "go", title: "Go" }], run },
          },
        ],
      },
    });
    return { admin: node.pluginConfigAdmin, saves };
  }

  it("settles the card that draws the group once an action returns, as a save would", async () => {
    const { admin, saves } = page(async () => ({ ok: true, message: "done" }));
    expect(await admin.run("backend", "go")).toEqual({ ok: true, message: "done" });
    expect(saves).toEqual(["sandbox"]);
  });

  it("settles only when started work ends, and never sends the promise to the page", async () => {
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => (finish = resolve));
    const { admin, saves } = page(async () => ({ ok: true, message: "started", settled }));
    const result = await admin.run("backend", "go");
    expect(result).toEqual({ ok: true, message: "started" });
    expect(saves).toEqual([]);
    finish();
    await settled;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saves).toEqual(["sandbox"]);
  });
});

const parse = (config: Record<string, unknown>) =>
  parsePluginConfiguration(config, "acme/package.json");
const NAME = { name: "name", type: "string", title: "Name" };
const LEVEL = {
  name: "level",
  type: "enum",
  title: "Level",
  options: [
    { value: "low", title: "Low", description: "Quiet", descriptionZh: "安静" },
    { value: "high", title: "High" },
  ],
};
/** What a refused update throws, or null. */
const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};

describe("a table field", () => {
  const TABLE = parse({
    properties: {
      presets: {
        type: "table",
        title: "Presets",
        columns: [NAME, { name: "enabled", type: "boolean", title: "In menu" }, LEVEL],
        rows: [
          {
            id: "fixed",
            values: { name: "Fixed", enabled: true, level: "high" },
            valuesZh: { name: "固定" },
            locked: ["level"],
          },
          {
            id: "free",
            values: { name: "Free", enabled: false, level: "low" },
            description: "For quiet work",
            descriptionZh: "适合安静的工作",
          },
        ],
        pin: { column: "enabled", on: "Pinned", off: "Not pinned" },
      },
    },
  })!;
  const field = TABLE.properties.presets!;
  const FREE = {
    id: "free",
    values: { name: "Free", enabled: false, level: "low" },
    description: "For quiet work",
    descriptionZh: "适合安静的工作",
  };

  const on = [{ name: "on", type: "boolean", title: "On" }];
  const row = { id: "a", values: { on: true } };
  it.each([
    [{ rows: [] }, /presets\.columns must list the columns/],
    [{ columns: on, rows: [] }, /presets\.rows must list the rows/],
    [{ columns: [{ name: "n", type: "list", title: "N" }], rows: [] }, /columns\[0\]\.type must/],
    [{ columns: on, rows: [{ id: "a", values: {} }] }, /rows\[0\]\.values\.on does not fit/],
    [{ columns: on, rows: [{ ...row, locked: ["off"] }] }, /rows\[0\]\.locked must list columns/],
    [{ columns: on, rows: [row, row] }, /rows\[1\]\.id must be a unique/],
    [{ columns: on, rows: [{ ...row, id: "$added" }] }, /rows\[0\]\.id must be a unique lower/],
    [{ columns: on, rows: [row], default: {} }, /a table's rows are its defaults/],
    [{ columns: on, rows: [row], pin: { column: "on", on: "P" } }, /needs an on and an off text/],
    [
      {
        columns: [NAME],
        rows: [{ id: "a", values: { name: "A" } }],
        pin: { column: "name", on: "P", off: "N" },
      },
      /pin\.column must name a boolean column/,
    ],
    [{ columns: on, rows: [row], rowChoice: { field: "x" } }, /needs a field and a title/],
  ])("refuses a table the page could not draw (%#)", (presets, error) => {
    expect(() =>
      parse({ properties: { presets: { type: "table", title: "P", ...presets } } }),
    ).toThrow(error);
  });

  it("keeps the pin, and a row's and an option's description for the \"?\"", () => {
    expect(field.pin).toEqual({ column: "enabled", on: "Pinned", off: "Not pinned" });
    expect(field.columns![2]!.options![0]).toEqual(LEVEL.options[0]);
  });

  it("reads as its declared rows when nothing is stored, and lays stored cells over them", () => {
    expect(resolveTable(field, undefined)).toEqual([
      {
        id: "fixed",
        values: { name: "Fixed", enabled: true, level: "high" },
        valuesZh: { name: "固定" },
        locked: ["level"],
      },
      FREE,
    ]);
    // A renamed row is called that in every language; a stored row it does not declare is left out.
    const read = resolveTable(field, { fixed: { name: "Mine" }, gone: { name: "x" } });
    expect(read.map((r) => r.id)).toEqual(["fixed", "free"]);
    expect(read[0]).toEqual({
      id: "fixed",
      values: { name: "Mine", enabled: true, level: "high" },
      locked: ["level"],
    });
  });

  it("ignores a stored value for a locked cell: a hand-edited document cannot remap it", () => {
    const stored = { fixed: { name: "Mine", level: "low" } };
    expect(resolveTable(field, stored)[0]!.values.level).toBe("high");
    // A save of another cell does not carry the stored locked value along.
    expect(
      applyUpdate(TABLE, { presets: stored }, { presets: { free: { enabled: true } } }),
    ).toEqual({ presets: { fixed: { name: "Mine" }, free: { enabled: true } } });
  });

  it("stores only the cells that differ from the declaration", () => {
    const next = applyUpdate(
      TABLE,
      {},
      {
        presets: {
          fixed: { name: " Mine ", enabled: true, level: "high" },
          free: { name: "Free", enabled: true, level: "low" },
        },
      },
    );
    expect(next).toEqual({ presets: { fixed: { name: "Mine" }, free: { enabled: true } } });
    // A cell set back to its declared value, or emptied, is dropped; nothing left, nothing stored.
    expect(
      applyUpdate(TABLE, next, { presets: { fixed: { name: "" }, free: { enabled: false } } }),
    ).toEqual({});
    expect(applyUpdate(TABLE, next, { presets: null })).toEqual({});
  });

  it.each([
    [{ free: { level: "max" } }, '"presets.free.level" must be one of low, high'],
    [{ free: { enabled: "yes" } }, '"presets.free.enabled" must be a boolean'],
    [{ free: { colour: "red" } }, '"presets.free.colour" is not a column of this table'],
    [{ free: "on" }, '"presets.free" must be an object of cells'],
    [[], '"presets" must be an object of rows'],
    [{ fixed: { level: "low" } }, '"presets.fixed.level" cannot be changed'],
  ])("refuses the update %j, naming the cell", (cells, message) => {
    expect(refusal(() => applyUpdate(TABLE, {}, { presets: cells }))).toEqual(
      new PluginConfigError("presets", message),
    );
  });

  it("takes a locked cell's own value, and drops rows it does not declare", () => {
    const update = { fixed: { level: "high", name: "A" }, ghost: { name: "B" } };
    expect(applyUpdate(TABLE, {}, { presets: update })).toEqual({
      presets: { fixed: { name: "A" } },
    });
  });
});

describe("a table's row choice", () => {
  const table = (rowChoice: unknown, options: string[]) =>
    parse({
      properties: {
        rows: {
          type: "table",
          title: "Rows",
          columns: [NAME],
          rows: [
            { id: "a", values: { name: "A" } },
            { id: "b", values: { name: "B" } },
          ],
          rowChoice,
        },
        pick: {
          type: "enum",
          title: "Pick",
          options: options.map((value) => ({ value, title: value })),
        },
      },
    });

  it("names an enum of the group whose options are the row ids, kept as a marker", () => {
    const choice = {
      field: "pick",
      title: "Default",
      titleZh: "默认",
      description: "x",
      before: "name",
    };
    expect(table(choice, ["b", "a"])!.properties.rows!.rowChoice).toEqual({
      field: "pick",
      title: "Default",
      titleZh: "默认",
    });
  });

  it.each([
    ["nope", ["a", "b"]],
    ["pick", ["a"]],
  ])("refuses a choice of %s over options %j", (target, options) => {
    expect(() => table({ field: target, title: "Default" }, options)).toThrow(
      /rowChoice\.field must name an enum/,
    );
  });
});

describe("a group's switch", () => {
  const group = (sw: unknown) =>
    parse({
      switch: sw,
      properties: {
        on: { type: "boolean", title: "Enable" },
        note: { type: "string", title: "Note" },
      },
    });

  it("names a boolean field of the group, or is absent", () => {
    expect(group("on")!.switch).toBe("on");
    expect(group(undefined)!.switch).toBeUndefined();
  });

  it.each([
    ["note", /switch must name a boolean field/],
    ["nope", /switch must name a boolean field/],
    [1, /switch must be a string/],
  ])("refuses the switch %j", (sw, error) => {
    expect(() => group(sw)).toThrow(error);
  });
});

describe("an extensible table's save", () => {
  const SCHEMA_X = parse({
    properties: {
      rows: {
        type: "table",
        title: "Rows",
        columns: [NAME, LEVEL],
        rows: [
          { id: "a", values: { name: "A", level: "low" } },
          { id: "b", values: { name: "B", level: "high" } },
        ],
        rowChoice: { field: "pick", title: "Default" },
        extensible: { add: "Add", values: { name: "New", level: "low" } },
      },
      pick: {
        type: "enum",
        title: "Pick",
        options: [
          { value: "a", title: "A" },
          { value: "b", title: "B" },
        ],
      },
    },
  })!;
  const field = SCHEMA_X.properties.rows!;
  const MINE = { mine: { name: "Mine", level: "high" } };

  it("keeps well-formed added rows, trimmed, and an order of ids that exist", () => {
    const next = applyUpdate(
      SCHEMA_X,
      {},
      {
        rows: {
          $added: { mine: { name: " Mine ", level: "high" } },
          $order: ["mine", "ghost", "b", "mine"],
        },
      },
    );
    expect(next).toEqual({ rows: { $added: MINE, $order: ["mine", "b"] } });
    // Rows the order does not list follow it, in their own order.
    const read = resolveTable(field, next.rows);
    expect(read.map((r) => r.id)).toEqual(["mine", "b", "a"]);
    expect(read[0]).toEqual({ id: "mine", values: MINE.mine, added: true });
  });

  it.each([
    [{ mine: { name: "Mine" } }, '"rows.mine.level" must be one of low, high'],
    [{ mine: { name: "Mine", level: "max" } }, '"rows.mine.level" must be one of low, high'],
    [{ mine: { name: " ", level: "low" } }, '"rows.mine.name" may not be empty'],
    [{ $order: { name: "X", level: "low" } }, '"rows.$order" is not an id a new row may take'],
    [{ $added: { name: "X", level: "low" } }, '"rows.$added" is not an id a new row may take'],
    [{ a: { name: "X", level: "low" } }, '"rows.a" is not an id a new row may take'],
  ])("refuses the added rows %j", (added, message) => {
    expect(() => applyUpdate(SCHEMA_X, {}, { rows: { $added: added } })).toThrow(message);
  });

  it("drops a malformed added row on read (stored by hand, or by an older table)", () => {
    const $added = {
      bad: { name: "Bad" },
      worse: { name: "W", level: "max" },
      ok: { name: "Ok", level: "low" },
    };
    expect(resolveTable(field, { $added }).map((r) => r.id)).toEqual(["a", "b", "ok"]);
  });

  it("refuses a save that leaves the row choice pointing at a removed row", () => {
    const stored = applyUpdate(SCHEMA_X, {}, { rows: { $added: MINE }, pick: "mine" });
    expect(stored.pick).toBe("mine");
    expect(refusal(() => applyUpdate(SCHEMA_X, stored, { rows: { $added: {} } }))).toEqual(
      new PluginConfigError(
        "pick",
        '"pick" must name a row of "rows": "mine" is not one (choose another row before deleting it)',
      ),
    );
    // Choosing another row in the same save lets the deletion through; no choice at all is fine.
    expect(applyUpdate(SCHEMA_X, stored, { rows: { $added: {} }, pick: "a" })).toEqual({
      pick: "a",
    });
    expect(applyUpdate(SCHEMA_X, {}, { rows: { a: { name: "Renamed" } } })).toEqual({
      rows: { a: { name: "Renamed" } },
    });
  });
});
