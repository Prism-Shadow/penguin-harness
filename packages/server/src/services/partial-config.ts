/**
 * A package's `system_config.yaml` with no `system_prompt` is not a whole config: a hand-written
 * package (the `agent-porting` Skill's) writes only the keys it changes. It is laid over the
 * template's config — objects merged key by key, arrays and scalars taken whole — and the result
 * must pass the checks a write through the config route passes.
 */
import { Document } from "yaml";
import { defaultSystemConfig } from "@prismshadow/penguin-core";
import type { AgentConfigUpdateRequest } from "../api/types.js";
import { AgentConfigService } from "./agent-config-service.js";

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function overlay(base: unknown, top: unknown): unknown {
  if (!isObject(base) || !isObject(top)) return top;
  const out: Fields = { ...base };
  for (const [key, value] of Object.entries(top)) out[key] = overlay(base[key], value);
  return out;
}

const camel = (key: string): string => key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

/** A config in the config route's request form, the form its checks read. */
function asUpdate(config: Fields): NonNullable<AgentConfigUpdateRequest["config"]> {
  const update: Fields = {};
  for (const [key, value] of Object.entries(config)) {
    update[camel(key)] = isObject(value)
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), v]))
      : value;
  }
  const tools = isObject(config.tools) ? config.tools : {};
  return { ...update, toolsBuiltin: tools.builtin, mcpServers: tools.mcpServers } as NonNullable<
    AgentConfigUpdateRequest["config"]
  >;
}

/** The template's config with `partial` laid over it; a 400 for a value the config route refuses. */
export function overTemplate(partial: Fields): Fields {
  const merged = overlay(defaultSystemConfig(), partial) as Fields;
  AgentConfigService.applyConfigFields(new Document({}), asUpdate(merged));
  return merged;
}
