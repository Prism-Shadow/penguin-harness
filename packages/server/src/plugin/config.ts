/**
 * Plugin configuration: the settings a module DECLARES and the values an admin gives them on
 * the Settings dialog's Plugins page, stored server-wide and read back by the declaring module
 * itself through the `PluginConfig` mechanism (a module `requires` it from `PluginConfigModule`).
 *
 * A declaration is a contribution to `PluginConfigProvider.groups`: pure manifest data, so a
 * plugin's lands in its generated `ifaces.json` beside every other contribution, and the page
 * can list and validate it without running the package. Its shape is VS Code's
 * `contributes.configuration` cut down to what a settings page can draw without knowing the
 * module — a titled group of fields (a string, a secret, a boolean, a number, a choice among
 * options, a list of lines, or a table of fixed rows) — plus a `parent` that draws the group
 * inside another's card.
 * The group's name is the contribution's id. A group whose status changes at run time (the
 * sandbox's backends) contributes that as code to `PluginConfigPage.status`.
 *
 * Values live in `server_settings` under `plugin-config:<group>`, one JSON document per group
 * — server-global, like the proxy: plugins load once per process (the closure over every
 * Project's list, PRFC-0010), so their options are the process's too. A secret is stored in
 * the clear beside the other settings the server keeps and is masked at every API surface; a
 * masked value sent back keeps the stored one, the models-page rule.
 *
 * Delivery is a pull. The module that declared a group reads it: `get` merges what is stored
 * onto the declared defaults, so a first boot reads a complete document; `watch` fires after
 * every save, which is how a module applies an edit without a restart or a re-assembly of the
 * App. Nothing else carries the values on its behalf, so each reader turns the document into
 * its own typed settings at its own boundary. Declaring data on the slot does not order the
 * boot (a data-only contribution), which is what lets one module both declare and require.
 *
 * Two nodes, for the same ordering reason. `PluginConfigProvider` holds the values and takes
 * the declarations; `PluginConfigPage` (config-page.ts) is what the admin API reads — the
 * entries with their live notices — and takes the status code. A status contributor (the sandbox's, which reads
 * the sandbox service) is created before the page, and a sandbox backend reading its own
 * group is created after the provider: one node for both would close that circle.
 */
import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Slot } from "@prismshadow/penguin-core/kernel";
import type {
  PluginConfigEntry,
  PluginConfigField,
  PluginConfigOption,
  PluginConfigTableColumn,
  PluginConfigTableRow,
  PluginConfiguration,
} from "../api/types.js";
import { Settings } from "../mechanisms/settings.js";
import { maskApiKey } from "../services/project-config-service.js";

export type { PluginConfigField, PluginConfigNotice, PluginConfiguration } from "../api/types.js";

const FIELD_TYPES = new Set<PluginConfigField["type"]>([
  "string",
  "secret",
  "boolean",
  "number",
  "enum",
  "list",
  "table",
]);

/** A field name: what the manifest and the stored document are keyed by. */
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A table row's id: what its stored cells are keyed by. */
const ROW_ID = /^[a-z][a-z0-9-]*$/;

const COLUMN_TYPES = new Set<PluginConfigTableColumn["type"]>(["string", "boolean", "enum"]);

/** An enum's options, checked: every one a string value with a title. */
function parseOptions(options: unknown, where: string): PluginConfigOption[] {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error(`${where}.options must list the choices`);
  }
  return options.map((o, i) => {
    const opt = (o ?? {}) as Record<string, unknown>;
    if (typeof opt.value !== "string" || typeof opt.title !== "string") {
      throw new Error(`${where}.options[${i}] needs a string value and title`);
    }
    return {
      value: opt.value,
      title: opt.title,
      ...(typeof opt.titleZh === "string" ? { titleZh: opt.titleZh } : {}),
    };
  });
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Whether a value is of a table column's type. */
function cellFits(column: PluginConfigTableColumn, value: unknown): boolean {
  if (column.type === "boolean") return typeof value === "boolean";
  if (column.type === "enum") {
    return typeof value === "string" && (column.options ?? []).some((o) => o.value === value);
  }
  return typeof value === "string";
}

/** A `table` field's columns and rows, checked: every row declares every column, and fits it. */
function parseTable(
  f: Record<string, unknown>,
  where: string,
): { columns: PluginConfigTableColumn[]; rows: PluginConfigTableRow[] } {
  if (!Array.isArray(f.columns) || f.columns.length === 0) {
    throw new Error(`${where}.columns must list the columns`);
  }
  const columns = f.columns.map((raw, i): PluginConfigTableColumn => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const at = `${where}.columns[${i}]`;
    if (typeof c.name !== "string" || !FIELD_NAME.test(c.name)) {
      throw new Error(`${at}.name is not a valid name`);
    }
    if (
      typeof c.type !== "string" ||
      !COLUMN_TYPES.has(c.type as PluginConfigTableColumn["type"])
    ) {
      throw new Error(`${at}.type must be one of ${[...COLUMN_TYPES].join(", ")}`);
    }
    if (typeof c.title !== "string" || c.title === "") throw new Error(`${at}.title is required`);
    return {
      name: c.name,
      type: c.type as PluginConfigTableColumn["type"],
      title: c.title,
      ...(typeof c.titleZh === "string" ? { titleZh: c.titleZh } : {}),
      ...(c.type === "enum" ? { options: parseOptions(c.options, at) } : {}),
    };
  });
  if (!Array.isArray(f.rows) || f.rows.length === 0) {
    throw new Error(`${where}.rows must list the rows`);
  }
  const ids = new Set<string>();
  const rows = f.rows.map((raw, i): PluginConfigTableRow => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const at = `${where}.rows[${i}]`;
    if (typeof r.id !== "string" || !ROW_ID.test(r.id) || ids.has(r.id)) {
      throw new Error(`${at}.id must be a unique lower-case id`);
    }
    ids.add(r.id);
    const values = isRecord(r.values) ? r.values : {};
    for (const column of columns) {
      if (!cellFits(column, values[column.name])) {
        throw new Error(`${at}.values.${column.name} does not fit its column`);
      }
    }
    const row: PluginConfigTableRow = {
      id: r.id,
      values: Object.fromEntries(columns.map((c) => [c.name, values[c.name] as string | boolean])),
    };
    if (r.valuesZh !== undefined) {
      if (!isRecord(r.valuesZh)) throw new Error(`${at}.valuesZh must be an object`);
      for (const [name, v] of Object.entries(r.valuesZh)) {
        if (columns.find((c) => c.name === name)?.type !== "string" || typeof v !== "string") {
          throw new Error(`${at}.valuesZh.${name} must be a string column's text`);
        }
      }
      row.valuesZh = r.valuesZh as Record<string, string>;
    }
    if (r.locked !== undefined) {
      if (!Array.isArray(r.locked) || !r.locked.every((n) => columns.some((c) => c.name === n))) {
        throw new Error(`${at}.locked must list columns of the table`);
      }
      row.locked = r.locked as string[];
    }
    return row;
  });
  return { columns, rows };
}

/**
 * A `table` field as read: every declared row, in order, with the stored cells laid over the
 * declared ones. A cell a save changed drops its Chinese text — the name an administrator gave
 * is the name in every language. Stored rows the table does not declare are left out.
 */
export function resolveTable(field: PluginConfigField, stored: unknown): PluginConfigTableRow[] {
  const cells = isRecord(stored) ? stored : {};
  return (field.rows ?? []).map((row) => {
    const own = isRecord(cells[row.id]) ? (cells[row.id] as Record<string, unknown>) : {};
    const values = { ...row.values };
    for (const column of field.columns ?? []) {
      const v = own[column.name];
      if (v !== undefined && cellFits(column, v)) values[column.name] = v as string | boolean;
    }
    const zh = Object.entries(row.valuesZh ?? {}).filter(
      ([name]) => values[name] === row.values[name],
    );
    const { valuesZh: _declared, ...rest } = row;
    return { ...rest, values, ...(zh.length > 0 ? { valuesZh: Object.fromEntries(zh) } : {}) };
  });
}

/**
 * One update of a `table` field folded onto its stored cells. Each cell is checked against its
 * column and named `<field>.<row>.<column>` when refused; a cell set back to its declared value
 * (or sent empty) is dropped, so only the cells that differ are stored; a row the table does not
 * declare is dropped; a locked cell may not change.
 */
function applyTableUpdate(
  name: string,
  field: PluginConfigField,
  stored: unknown,
  update: unknown,
): Record<string, Record<string, string | boolean>> {
  if (!isRecord(update)) {
    throw new PluginConfigError(name, `"${name}" must be an object of rows`);
  }
  const before = isRecord(stored) ? stored : {};
  const next: Record<string, Record<string, string | boolean>> = {};
  for (const row of field.rows ?? []) {
    const cells: Record<string, string | boolean> = {};
    const kept = isRecord(before[row.id]) ? (before[row.id] as Record<string, unknown>) : {};
    for (const column of field.columns ?? []) {
      const v = kept[column.name];
      if (v !== undefined && cellFits(column, v)) cells[column.name] = v as string | boolean;
    }
    const sent = update[row.id];
    if (sent !== undefined) {
      if (!isRecord(sent)) {
        throw new PluginConfigError(name, `"${name}.${row.id}" must be an object of cells`);
      }
      for (const [columnName, raw] of Object.entries(sent)) {
        const at = `${name}.${row.id}.${columnName}`;
        const column = (field.columns ?? []).find((c) => c.name === columnName);
        if (column === undefined) {
          throw new PluginConfigError(name, `"${at}" is not a column of this table`);
        }
        const value = typeof raw === "string" ? raw.trim() : raw;
        if (value === null || value === "" || value === row.values[columnName]) {
          delete cells[columnName];
          continue;
        }
        if (!cellFits(column, value)) {
          throw new PluginConfigError(
            name,
            column.type === "enum"
              ? `"${at}" must be one of ${(column.options ?? []).map((o) => o.value).join(", ")}`
              : `"${at}" must be a ${column.type}`,
          );
        }
        if (row.locked?.includes(columnName)) {
          throw new PluginConfigError(name, `"${at}" cannot be changed`);
        }
        cells[columnName] = value as string | boolean;
      }
    }
    if (Object.keys(cells).length > 0) next[row.id] = cells;
  }
  return next;
}

/**
 * Validates a declared configuration. Undefined when there is none; a malformed one throws,
 * naming where it was declared — a schema the page cannot draw is
 * a load failure of that plugin, not something to guess at.
 */
export function parsePluginConfiguration(
  doc: unknown,
  where: string,
): PluginConfiguration | undefined {
  if (doc === undefined) return undefined;
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`${where}: configuration must be an object`);
  }
  const d = doc as Record<string, unknown>;
  const str = (key: string): string | undefined => {
    const v = d[key];
    if (v === undefined) return undefined;
    if (typeof v !== "string") throw new Error(`${where}: configuration.${key} must be a string`);
    return v;
  };
  if (d.properties === null || typeof d.properties !== "object" || Array.isArray(d.properties)) {
    throw new Error(`${where}: configuration.properties must be an object of fields`);
  }
  const properties: Record<string, PluginConfigField> = {};
  for (const [name, raw] of Object.entries(d.properties as Record<string, unknown>)) {
    if (!FIELD_NAME.test(name)) {
      throw new Error(`${where}: configuration field "${name}" is not a valid name`);
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${where}: configuration.properties.${name} must be an object`);
    }
    const f = raw as Record<string, unknown>;
    const type = f.type;
    if (typeof type !== "string" || !FIELD_TYPES.has(type as PluginConfigField["type"])) {
      throw new Error(
        `${where}: configuration.properties.${name}.type must be one of ${[...FIELD_TYPES].join(", ")}`,
      );
    }
    if (typeof f.title !== "string" || f.title === "") {
      throw new Error(`${where}: configuration.properties.${name}.title is required`);
    }
    const field: PluginConfigField = { type: type as PluginConfigField["type"], title: f.title };
    for (const key of ["titleZh", "description", "descriptionZh", "placeholder"] as const) {
      const v = f[key];
      if (v === undefined) continue;
      if (typeof v !== "string") {
        throw new Error(`${where}: configuration.properties.${name}.${key} must be a string`);
      }
      field[key] = v;
    }
    if (field.type === "enum") {
      field.options = parseOptions(f.options, `${where}: configuration.properties.${name}`);
    }
    if (field.type === "table") {
      Object.assign(field, parseTable(f, `${where}: configuration.properties.${name}`));
      if (f.default !== undefined) {
        throw new Error(
          `${where}: configuration.properties.${name}.default: a table's rows are its defaults`,
        );
      }
    }
    if (field.type === "list" && f.maxItems !== undefined) {
      if (typeof f.maxItems !== "number" || !Number.isInteger(f.maxItems) || f.maxItems < 1) {
        throw new Error(
          `${where}: configuration.properties.${name}.maxItems must be a positive integer`,
        );
      }
      field.maxItems = f.maxItems;
    }
    if (field.type === "number") {
      for (const key of ["minimum", "maximum"] as const) {
        const v = f[key];
        if (v === undefined) continue;
        if (typeof v !== "number" || !Number.isFinite(v)) {
          throw new Error(`${where}: configuration.properties.${name}.${key} must be a number`);
        }
        field[key] = v;
      }
    }
    if ((field.type === "string" || field.type === "list") && f.pattern !== undefined) {
      if (typeof f.pattern !== "string") {
        throw new Error(`${where}: configuration.properties.${name}.pattern must be a string`);
      }
      try {
        new RegExp(f.pattern, "u");
      } catch {
        throw new Error(
          `${where}: configuration.properties.${name}.pattern is not a valid regular expression`,
        );
      }
      field.pattern = f.pattern;
      if (f.patternErrorMessage !== undefined) {
        if (typeof f.patternErrorMessage !== "string") {
          throw new Error(
            `${where}: configuration.properties.${name}.patternErrorMessage must be a string`,
          );
        }
        field.patternErrorMessage = f.patternErrorMessage;
      }
    }
    if (f.required !== undefined) {
      if (typeof f.required !== "boolean") {
        throw new Error(`${where}: configuration.properties.${name}.required must be a boolean`);
      }
      field.required = f.required;
    }
    if (f.advanced !== undefined) {
      if (typeof f.advanced !== "boolean") {
        throw new Error(`${where}: configuration.properties.${name}.advanced must be a boolean`);
      }
      if (f.advanced) field.advanced = true;
    }
    if (f.default !== undefined) {
      if (!valueFits(field, f.default) || valueViolation(name, field, f.default) !== undefined) {
        throw new Error(
          `${where}: configuration.properties.${name}.default does not fit a ${field.type} field`,
        );
      }
      field.default = f.default as PluginConfigField["default"];
    }
    properties[name] = field;
  }
  return {
    ...(str("title") !== undefined ? { title: str("title")! } : {}),
    ...(str("titleZh") !== undefined ? { titleZh: str("titleZh")! } : {}),
    ...(str("description") !== undefined ? { description: str("description")! } : {}),
    ...(str("descriptionZh") !== undefined ? { descriptionZh: str("descriptionZh")! } : {}),
    properties,
  };
}

/** Whether a value is of a field's type (a Project is named by its id, a string). */
export function valueFits(field: PluginConfigField, value: unknown): boolean {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "enum":
      return typeof value === "string" && (field.options ?? []).some((o) => o.value === value);
    case "list":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "table":
      return isRecord(value);
    default:
      return typeof value === "string";
  }
}

/**
 * Why a value of the right type is still refused — outside the field's range, or a value (a
 * list's line) that does not match its pattern — or undefined when it is accepted.
 */
export function valueViolation(
  name: string,
  field: PluginConfigField,
  value: unknown,
): string | undefined {
  if (typeof value === "number") {
    if (field.minimum !== undefined && value < field.minimum) {
      return `"${name}" must be at least ${field.minimum}`;
    }
    if (field.maximum !== undefined && value > field.maximum) {
      return `"${name}" must be at most ${field.maximum}`;
    }
    return undefined;
  }
  if (field.pattern === undefined) return undefined;
  const pattern = new RegExp(field.pattern, "u");
  const bad = (Array.isArray(value) ? value : [value]).find(
    (v) => typeof v === "string" && !pattern.test(v),
  );
  if (bad === undefined) return undefined;
  return field.patternErrorMessage !== undefined
    ? `"${name}" ${field.patternErrorMessage}: ${bad}`
    : `"${name}" does not match ${field.pattern}: ${bad}`;
}

/** The schema's defaults, as the document a plugin with nothing stored reads. */
export function defaultsOf(schema: PluginConfiguration): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    if (field.default !== undefined) out[name] = field.default;
  }
  return out;
}

/** A stored document as it may leave the server: every secret masked, everything else as is. */
export function maskValues(
  schema: PluginConfiguration,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    const v = values[name];
    if (v === undefined) continue;
    out[name] = field.type === "secret" && typeof v === "string" && v !== "" ? maskApiKey(v) : v;
  }
  return out;
}

/** What `set` refuses, with the field it refuses. */
export class PluginConfigError extends Error {
  constructor(
    readonly field: string | null,
    message: string,
  ) {
    super(message);
    this.name = "PluginConfigError";
  }
}

/**
 * One update, validated against the schema and folded onto the stored document.
 *
 * Every field the request names is checked for its type; a secret sent as the masked value
 * the page read keeps what is stored, an empty string or null clears it; a required field
 * may not end up empty. Fields the request omits keep their stored value, so a page can
 * save one field at a time.
 */
export function applyUpdate(
  schema: PluginConfiguration,
  stored: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...stored };
  for (const [name, value] of Object.entries(update)) {
    const field = schema.properties[name];
    if (field === undefined)
      throw new PluginConfigError(name, `"${name}" is not a field of this configuration`);
    if (value === null || value === "") {
      delete next[name];
      continue;
    }
    if (field.type === "secret" && typeof value === "string") {
      const current = stored[name];
      if (typeof current === "string" && current !== "" && value === maskApiKey(current)) continue;
    }
    if (field.type === "table") {
      const cells = applyTableUpdate(name, field, stored[name], value);
      if (Object.keys(cells).length === 0) delete next[name];
      else next[name] = cells;
      continue;
    }
    if (!valueFits(field, value)) {
      throw new PluginConfigError(
        name,
        field.type === "enum"
          ? `"${name}" must be one of ${(field.options ?? []).map((o) => o.value).join(", ")}`
          : field.type === "list"
            ? `"${name}" must be a list of strings`
            : `"${name}" must be a ${field.type}`,
      );
    }
    if (field.type === "list") {
      const items = [...new Set((value as string[]).map((v) => v.trim()).filter((v) => v !== ""))];
      if (field.maxItems !== undefined && items.length > field.maxItems) {
        throw new PluginConfigError(name, `"${name}" may hold at most ${field.maxItems} entries`);
      }
      const violation = valueViolation(name, field, items);
      if (violation !== undefined) throw new PluginConfigError(name, violation);
      if (items.length === 0) delete next[name];
      else next[name] = items;
      continue;
    }
    next[name] = typeof value === "string" ? value.trim() : value;
    if (next[name] === "") {
      delete next[name];
      continue;
    }
    const violation = valueViolation(name, field, next[name]);
    if (violation !== undefined) throw new PluginConfigError(name, violation);
  }
  for (const [name, field] of Object.entries(schema.properties)) {
    if (field.required === true && next[name] === undefined && field.default === undefined) {
      throw new PluginConfigError(name, `"${name}" is required`);
    }
  }
  return next;
}

/** A settings group as a module declares it: a configuration, and where the page draws it. */
export interface SettingsGroupDecl extends PluginConfiguration {
  /** Another group's name (its contribution id): this one is drawn inside that card and saved with it. */
  parent?: string;
  /** Position among the groups: lower first (absent = 100), then declaration order. */
  order?: number;
}

/** One settings group as the store holds it: named by its contribution id. */
export interface SettingsGroup {
  name: string;
  configuration: PluginConfiguration;
  parent?: string;
}

/** What a module reads: the group it declared, and a watch on it. */
@Interface()
export abstract class PluginConfig {
  /** The stored values merged onto the declared defaults; `{}` for a name no group answers to. */
  abstract get(name: string): Record<string, unknown>;
  /** Fires with the new document after every save of `name`; returns the unsubscribe. */
  abstract watch(name: string, cb: (values: Record<string, unknown>) => void): () => void;
  /** Whether anything was ever saved under `name` — what tells a default from a choice. */
  abstract saved(name: string): boolean;
  /** The configuration `name` was declared with (what `resolveTable` reads a table by); undefined for none. */
  abstract schema(name: string): PluginConfiguration | undefined;
}

export interface PluginConfigSlots {
  /** A settings group, as data: its id is its name, the data its configuration. */
  groups: Slot<SettingsGroupDecl>;
}

/** The entries as stored, before any live notice: what the page node builds on. */
@Interface()
export abstract class PluginConfigEntries {
  abstract describe(): PluginConfigEntry[];
  abstract set(name: string, update: Record<string, unknown>): PluginConfigEntry;
}

export interface PluginConfigStoreDeps {
  settings: Pick<Settings, "get" | "set">;
  groups: () => readonly SettingsGroup[];
}

export class PluginConfigStore {
  private readonly watchers = new Map<string, Set<(values: Record<string, unknown>) => void>>();

  constructor(private readonly deps: PluginConfigStoreDeps) {}

  private group(name: string): SettingsGroup | undefined {
    return this.deps.groups().find((g) => g.name === name);
  }

  private stored(name: string): Record<string, unknown> {
    const raw = this.deps.settings.get(`plugin-config:${name}`);
    if (raw === null) return {};
    try {
      const doc = JSON.parse(raw) as unknown;
      return doc !== null && typeof doc === "object" && !Array.isArray(doc)
        ? (doc as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  get(name: string): Record<string, unknown> {
    const group = this.group(name);
    if (group === undefined) return {};
    return { ...defaultsOf(group.configuration), ...this.stored(name) };
  }

  saved(name: string): boolean {
    return this.deps.settings.get(`plugin-config:${name}`) !== null;
  }

  schema(name: string): PluginConfiguration | undefined {
    return this.group(name)?.configuration;
  }

  watch(name: string, cb: (values: Record<string, unknown>) => void): () => void {
    const set = this.watchers.get(name) ?? new Set();
    set.add(cb);
    this.watchers.set(name, set);
    return () => void set.delete(cb);
  }

  describe(): PluginConfigEntry[] {
    return this.deps.groups().map((g) => this.entry(g));
  }

  set(name: string, update: Record<string, unknown>): PluginConfigEntry {
    const group = this.group(name);
    if (group === undefined) {
      throw new PluginConfigError(null, `no settings group named "${name}"`);
    }
    const next = applyUpdate(group.configuration, this.stored(name), update);
    this.deps.settings.set(`plugin-config:${name}`, JSON.stringify(next));
    const merged = { ...defaultsOf(group.configuration), ...next };
    for (const cb of this.watchers.get(name) ?? []) {
      try {
        cb(merged);
      } catch {
        // A watcher's failure is its own; the save has happened.
      }
    }
    return this.entry(group);
  }

  private entry(group: SettingsGroup): PluginConfigEntry {
    const { name, configuration } = group;
    return {
      name,
      configuration,
      values: maskValues(configuration, { ...defaultsOf(configuration), ...this.stored(name) }),
      ...(group.parent !== undefined ? { parent: group.parent } : {}),
    };
  }
}

/** The store as a node: values in the settings repo, groups from the declarations on its slot. */
@Module()
export class PluginConfigProvider {
  @Use() private readonly settings!: Settings;
  @Provide() pluginConfig!: PluginConfig;
  @Provide() pluginConfigEntries!: PluginConfigEntries;
  setup({ contributions }: ClassCtx) {
    const declared: Array<SettingsGroup & { order: number; index: number }> = [];
    for (const [index, c] of (contributions.groups ?? []).entries()) {
      const { parent, order, ...configuration } = c.data as unknown as SettingsGroupDecl;
      try {
        const parsed = parsePluginConfiguration(configuration, `${c.from}: group "${c.id}"`)!;
        declared.push({
          name: c.id,
          configuration: parsed,
          ...(typeof parent === "string" ? { parent } : {}),
          order: typeof order === "number" ? order : 100,
          index,
        });
      } catch (err) {
        // One malformed declaration drops that group, not the page.
        console.warn(`[plugin-config] ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    declared.sort((a, b) => a.order - b.order || a.index - b.index);
    const groups: SettingsGroup[] = declared.map(({ name, configuration, parent }) => ({
      name,
      configuration,
      ...(parent !== undefined ? { parent } : {}),
    }));
    const store = new PluginConfigStore({ settings: this.settings, groups: () => groups });
    this.pluginConfig = store;
    this.pluginConfigEntries = store;
  }
}
