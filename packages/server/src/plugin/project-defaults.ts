import { parsePluginTables, type PluginTables } from "@prismshadow/penguin-core";

/** Shipped server modules enabled on a Project that has never chosen its own list. */
export function projectPluginTables(value?: unknown): PluginTables {
  if (value === undefined) {
    return { all: { "@penguinharness/multimodal-tools": {} }, machines: {} };
  }
  return parsePluginTables(value) ?? { all: {}, machines: {} };
}
