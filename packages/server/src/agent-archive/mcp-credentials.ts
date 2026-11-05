/**
 * MCP credentials in an Agent archive's `system_config.yaml`.
 *
 * On export, every MCP `env` / `headers` value whose name looks like a credential is blanked and
 * named (`mcp:<server>:<env|headers>:<NAME>`) — unless the value is written as `${KEY}` vault
 * references, which is how an entry keeps its secret in the vault rather than in the config:
 * a reference is not a secret, and it travels. On an overwrite, a blanked value is filled back
 * from the Agent's own config when it has one under the same server and name. After an import,
 * what is still blank, and every vault key the entries reference that the vault does not hold,
 * is what the user must fill.
 *
 * The YAML is edited as a document, so its comments and layout survive; a config with nothing
 * to blank or restore is left byte for byte.
 */
import { VAULT_REF_PATTERN } from "@prismshadow/penguin-core";
import { Scalar, isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { Document, Pair } from "yaml";

/** An MCP `env` / `headers` name whose value is a credential as far as an export is concerned. */
const SECRET_NAME = /key|token|secret|password|passwd|auth|credential|cookie|bearer/i;

const FIELDS = ["env", "headers"] as const;

/** One credential-looking value of one MCP entry, as it sits in the document. */
interface CredentialSlot {
  /** `mcp:<server>:<env|headers>:<NAME>`. */
  label: string;
  pair: Pair;
  value: unknown;
}

function credentialSlots(doc: Document): CredentialSlot[] {
  const out: CredentialSlot[] = [];
  const servers = doc.getIn(["tools", "mcpServers"], true);
  if (!isSeq(servers)) return out;
  for (const server of servers.items) {
    if (!isMap(server)) continue;
    const serverName = String(server.get("name") ?? "");
    const config = server.get("config", true);
    if (!isMap(config)) continue;
    for (const field of FIELDS) {
      const values = config.get(field, true);
      if (!isMap(values)) continue;
      for (const pair of values.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        if (!SECRET_NAME.test(key)) continue;
        const value = isScalar(pair.value) ? pair.value.value : pair.value;
        out.push({ label: `mcp:${serverName}:${field}:${key}`, pair: pair as Pair, value });
      }
    }
  }
  return out;
}

const isBlank = (value: unknown): boolean => value === "" || value === null || value === undefined;

/** A value written with `${KEY}` vault references keeps its secret in the vault. */
function isReference(value: unknown): boolean {
  return typeof value === "string" && [...value.matchAll(VAULT_REF_PATTERN)].length > 0;
}

/** The config's facts an archive's manifest repeats. */
export interface ConfigFacts {
  name?: string;
  description?: string;
  version: number;
}

function factsOf(doc: Document): ConfigFacts {
  const js = (doc.toJS() ?? {}) as { name?: unknown; description?: unknown; version?: unknown };
  return {
    ...(typeof js.name === "string" ? { name: js.name } : {}),
    ...(typeof js.description === "string" ? { description: js.description } : {}),
    version: typeof js.version === "number" && Number.isInteger(js.version) ? js.version : 1,
  };
}

/** `system_config.yaml` as an export writes it: literal credential values blanked and named. */
export function redactSystemConfig(text: string): ConfigFacts & {
  text: string;
  redacted: string[];
} {
  const doc = parseDocument(text);
  const redacted: string[] = [];
  for (const slot of credentialSlots(doc)) {
    if (isBlank(slot.value) || isReference(slot.value)) continue;
    slot.pair.value = new Scalar("");
    redacted.push(slot.label);
  }
  return { ...factsOf(doc), text: redacted.length > 0 ? doc.toString() : text, redacted };
}

/**
 * `incoming` with each blank credential value filled from `current` (the Agent being
 * overwritten) where it holds a value under the same server, field and name; null when there was
 * nothing to fill.
 */
export function restoreCredentials(incoming: string, current: string): string | null {
  const known = new Map<string, unknown>();
  for (const slot of credentialSlots(parseDocument(current))) {
    if (!isBlank(slot.value)) known.set(slot.label, slot.value);
  }
  const doc = parseDocument(incoming);
  let filled = false;
  for (const slot of credentialSlots(doc)) {
    const value = known.get(slot.label);
    if (!isBlank(slot.value) || value === undefined) continue;
    slot.pair.value = new Scalar(value);
    filled = true;
  }
  return filled ? doc.toString() : null;
}

/** What the config still needs: blank credential values, and the vault keys its entries reference. */
export function credentialsToFill(text: string): { blank: string[]; vaultRefs: string[] } {
  const doc = parseDocument(text);
  const blank = credentialSlots(doc)
    .filter((slot) => isBlank(slot.value))
    .map((slot) => slot.label);
  const vaultRefs = new Set<string>();
  const servers = (doc.toJS() as { tools?: { mcpServers?: unknown } } | null)?.tools?.mcpServers;
  const scan = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(VAULT_REF_PATTERN)) {
        if (match[1] !== "PLUGIN_ROOT") vaultRefs.add(match[1]!);
      }
    } else if (Array.isArray(value)) value.forEach(scan);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(scan);
  };
  if (Array.isArray(servers)) servers.forEach(scan);
  return { blank, vaultRefs: [...vaultRefs] };
}
