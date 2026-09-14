/**
 * Plugin configuration: the options a plugin package DECLARES (`package.json#penguin
 * .configuration`, a small schema of typed fields) and the values an admin gives them on the
 * Settings dialog's Plugins page, stored server-wide and handed to the plugin's
 * modules through the `PluginConfig` mechanism (a module `requires` it from `PluginConfigModule`).
 *
 * The shape is VS Code's `contributes.configuration` cut down to what a settings page can
 * draw without knowing the plugin: a titled group of fields, each a string, a secret, a
 * boolean, a number or a Project picker, with a default and a description. The schema is
 * read off the manifest without running the package, so the page can list and validate a
 * plugin's options whether or not its modules booted.
 *
 * Values live in `server_settings` under `plugin-config:<package name>`, one JSON document
 * per package — server-global, like the proxy: plugins load once per process (the closure
 * over every Project's list, PRFC-0010), so their options are the process's too. A secret is
 * stored in the clear beside the other settings the server keeps and is masked at every API
 * surface; a masked value sent back keeps the stored one, the models-page rule.
 *
 * Delivery is a read plus a watch. `get` merges what is stored onto the schema's defaults,
 * so a plugin reads a complete document on its first boot; `watch` fires after every save,
 * which is how a plugin applies an edit without a restart or a re-assembly of the App.
 *
 * A package is not the only thing with options. A module contributes a settings group to
 * `PluginConfigProvider.groups` — a schema drawn exactly like a package's, plus live notices,
 * plus `parent` to draw one group inside another — so a core capability (the sandbox) and the
 * plugins that extend it (its backends' own options) get their form from the same page code
 * rather than each shipping a page of its own. Groups are asked for per call, like the
 * package schemas: what they list may change as backends load.
 */
import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Slot } from "@prismshadow/penguin-core/kernel";
import type {
  PluginConfigEntry,
  PluginConfigField,
  PluginConfigNotice,
  PluginConfiguration,
} from "../api/types.js";
import type { Hmr } from "../hmr/capabilities.js";
import { Settings } from "../mechanisms/settings.js";
import { maskApiKey } from "../services/project-config-service.js";
import { pluginHostFrom } from "./host.js";

export type { PluginConfigField, PluginConfigNotice, PluginConfiguration } from "../api/types.js";

const FIELD_TYPES = new Set<PluginConfigField["type"]>([
  "string",
  "secret",
  "boolean",
  "number",
  "project",
  "enum",
  "list",
]);

/** A field name: what the manifest and the stored document are keyed by. */
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Reads a package's `penguin.configuration`. Undefined when the package declares none; a
 * declared one that is malformed throws, naming the file — a schema the page cannot draw is
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
      const options = f.options;
      if (!Array.isArray(options) || options.length === 0) {
        throw new Error(`${where}: configuration.properties.${name}.options must list the choices`);
      }
      field.options = options.map((o, i) => {
        const opt = (o ?? {}) as Record<string, unknown>;
        if (typeof opt.value !== "string" || typeof opt.title !== "string") {
          throw new Error(
            `${where}: configuration.properties.${name}.options[${i}] needs a string value and title`,
          );
        }
        return {
          value: opt.value,
          title: opt.title,
          ...(typeof opt.titleZh === "string" ? { titleZh: opt.titleZh } : {}),
        };
      });
    }
    if (field.type === "list" && f.maxItems !== undefined) {
      if (typeof f.maxItems !== "number" || !Number.isInteger(f.maxItems) || f.maxItems < 1) {
        throw new Error(
          `${where}: configuration.properties.${name}.maxItems must be a positive integer`,
        );
      }
      field.maxItems = f.maxItems;
    }
    if (f.required !== undefined) {
      if (typeof f.required !== "boolean") {
        throw new Error(`${where}: configuration.properties.${name}.required must be a boolean`);
      }
      field.required = f.required;
    }
    if (f.default !== undefined) {
      if (!valueFits(field, f.default)) {
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
    default:
      return typeof value === "string";
  }
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
      if (items.length === 0) delete next[name];
      else next[name] = items;
      continue;
    }
    next[name] = typeof value === "string" ? value.trim() : value;
    if (next[name] === "") delete next[name];
  }
  for (const [name, field] of Object.entries(schema.properties)) {
    if (field.required === true && next[name] === undefined && field.default === undefined) {
      throw new PluginConfigError(name, `"${name}" is required`);
    }
  }
  return next;
}

/** One settings group a module contributes: a schema like a package's, and where it is drawn. */
export interface SettingsGroup {
  /** The store key and the name the page saves under; unique among groups and packages. */
  name: string;
  configuration: PluginConfiguration;
  /** Another entry's name: this group is drawn inside that entry's card and saved with it. */
  parent?: string;
  notices?: PluginConfigNotice[];
}

/** The code half of a `groups` contribution: the groups as they stand now. */
export interface SettingsGroupSource {
  groups(): SettingsGroup[];
}

/** What a plugin module reads: its own document, and a watch on it. */
export abstract class PluginConfig extends Interface<{
  /** The stored values merged onto the schema's defaults; `{}` for a name no entry answers to. */
  get(name: string): Record<string, unknown>;
  /** Fires with the new document after every save of `name`; returns the unsubscribe. */
  watch(name: string, cb: (values: Record<string, unknown>) => void): () => void;
  /** Whether anything was ever saved under `name` — what tells a default from a choice. */
  saved(name: string): boolean;
}>() {}

export interface PluginConfigSlots {
  /**
   * A settings group, drawn on the Plugins page before the packages' own options. The data
   * half orders the contributions; the code half answers the groups, asked per call.
   */
  groups: Slot<{ order: number }, SettingsGroupSource>;
}

/** What the settings page reads and writes. */
export abstract class PluginConfigAdmin extends Interface<{
  /** Every contributed group, then every loaded package that declares a configuration; values masked. */
  describe(): PluginConfigEntry[];
  /** Validates and stores one update; answers that entry, masked. */
  set(name: string, update: Record<string, unknown>): PluginConfigEntry;
}>() {}

export interface PluginConfigStoreDeps {
  settings: Pick<Settings, "get" | "set">;
  /** Every entry, contributed groups first — read per call, since a swap replaces the host and backends load late. */
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
      throw new PluginConfigError(null, `no settings group or loaded plugin named "${name}"`);
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
      ...(group.notices !== undefined && group.notices.length > 0
        ? { notices: group.notices }
        : {}),
    };
  }
}

/**
 * The store as a node: values in the settings repo; entries from the contributed groups, then
 * the packages the process's plugin host loaded.
 */
@Module()
export class PluginConfigProvider {
  @Use() private readonly settings!: Settings;
  @Use() private readonly hmr!: Hmr;
  @Provide() pluginConfig!: PluginConfig;
  @Provide() pluginConfigAdmin!: PluginConfigAdmin;
  setup({ contributions }: ClassCtx) {
    const hmr = this.hmr;
    const sources = [...(contributions.groups ?? [])]
      .sort((a, b) => ((a.data.order as number) ?? 0) - ((b.data.order as number) ?? 0))
      .map((c) => c.code as SettingsGroupSource);
    const store = new PluginConfigStore({
      settings: this.settings,
      groups: () => {
        const contributed = sources.flatMap((source) => source.groups());
        // Claimed per call rather than captured: the host belongs to the process, and a hot
        // swap hands the same one to the next platform. A host from a generation before
        // configurations existed answers none.
        const host = pluginHostFrom(hmr.resources) as {
          configurations?: () => ReadonlyMap<string, PluginConfiguration>;
        };
        const packages =
          typeof host.configurations === "function" ? [...host.configurations()] : [];
        return [
          ...contributed,
          ...packages.map(([name, configuration]) => ({ name, configuration })),
        ];
      },
    });
    this.pluginConfig = store;
    this.pluginConfigAdmin = store;
  }
}
