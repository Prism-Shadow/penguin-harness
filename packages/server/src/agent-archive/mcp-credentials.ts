/**
 * MCP credentials in an Agent archive's `system_config.yaml`.
 *
 * On export, every literal credential in an MCP entry is blanked and named in
 * `manifest.redacted` by where it was (`mcp:<server>:<location>`):
 *
 * - an `env` or `headers` value whose name looks like a credential: `env:<NAME>`, `headers:<NAME>`;
 * - in `oauth`, a value (at any depth) whose name looks like one — a client secret, a token:
 *   `oauth:<path>`;
 * - in `url`, the password of its user info (`url:password`) and every query parameter whose
 *   name looks like a credential (`url:query:<name>`);
 * - in `args`, the value of a `--<name>=<value>` argument and the argument after a `--<name>`
 *   flag whose name looks like a credential (`args:<i>`), and in a URL-shaped argument the same
 *   two places as in `url` (`args:<i>:password`, `args:<i>:query:<name>`).
 *
 * A value written as `${KEY}` vault references is not a secret — the vault holds it — and travels
 * as written. Everything else in the config travels as written. On an overwrite, a blanked value
 * is filled back from the Agent's own config at the same place; after an import, what is still
 * blank, and every vault key the entries reference, is what the user must fill.
 *
 * The YAML is edited as a document, so its comments and layout survive and a config with nothing
 * to blank or restore is left byte for byte. A config using YAML aliases is first expanded, so
 * that a credential reached through an alias is not missed.
 */
import { VAULT_REF_PATTERN } from "@prismshadow/penguin-core";
import { Document, Scalar, isAlias, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
import { HttpError } from "../http/errors.js";

/** A name whose value is a credential as far as an export is concerned. */
const SECRET_NAME = /key|token|secret|password|passwd|auth|credential|cookie|bearer/i;

/** One secret inside one string of the document: the scalar holding it and where in its text. */
interface Span {
  /** `mcp:<server>:<location>`. */
  label: string;
  node: Scalar;
  start: number;
  end: number;
}

const isReference = (text: string): boolean => [...text.matchAll(VAULT_REF_PATTERN)].length > 0;

/** The spans of a URL's secrets: its user-info password and its credential-named query values. */
function urlSpans(text: string, at: string): Array<{ label: string; start: number; end: number }> {
  const out: Array<{ label: string; start: number; end: number }> = [];
  const userinfo = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#@:]*:([^/?#@]*)@/.exec(text);
  if (userinfo !== null) {
    const end = userinfo[0].length - 1;
    out.push({ label: `${at}:password`, start: end - userinfo[1]!.length, end });
  }
  const query = text.indexOf("?");
  if (query >= 0) {
    const hash = text.indexOf("#", query);
    const stop = hash < 0 ? text.length : hash;
    let pos = query + 1;
    for (const pair of text.slice(query + 1, stop).split("&")) {
      const eq = pair.indexOf("=");
      if (eq > 0 && SECRET_NAME.test(decodeURIComponentSafe(pair.slice(0, eq)))) {
        out.push({
          label: `${at}:query:${pair.slice(0, eq)}`,
          start: pos + eq + 1,
          end: pos + pair.length,
        });
      }
      pos += pair.length + 1;
    }
  }
  return out;
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A command-line flag's name (`--api-key`, `-token`), or null for anything else. */
function flagName(text: string): string | null {
  const flag = /^--?([A-Za-z][A-Za-z0-9_.-]*)$/.exec(text);
  return flag === null ? null : flag[1]!;
}

/** Every secret span of one MCP entry's config map. */
function entrySpans(server: string, config: unknown): Span[] {
  if (!isMap(config)) return [];
  const out: Span[] = [];
  const add = (node: Scalar, label: string, start: number, end: number): void => {
    out.push({ label: `mcp:${server}:${label}`, node, start, end });
  };
  const whole = (node: unknown, label: string): void => {
    // A number is a credential too (a PIN, a numeric key) once its name says so.
    if (isScalar(node) && (typeof node.value === "string" || typeof node.value === "number")) {
      add(node, label, 0, String(node.value).length);
    }
  };
  for (const field of ["env", "headers"] as const) {
    const values = config.get(field, true);
    if (!isMap(values)) continue;
    for (const pair of values.items) {
      const name = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      if (SECRET_NAME.test(name)) whole(pair.value, `${field}:${name}`);
    }
  }
  const oauth = (node: unknown, at: string): void => {
    if (!isMap(node)) return;
    for (const pair of node.items) {
      const name = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      if (isMap(pair.value)) oauth(pair.value, `${at}.${name}`);
      else if (SECRET_NAME.test(name))
        whole(pair.value, `${at}.${name}`.replace(/^oauth\./, "oauth:"));
    }
  };
  oauth(config.get("oauth", true), "oauth");
  const url = config.get("url", true);
  if (isScalar(url) && typeof url.value === "string") {
    for (const span of urlSpans(url.value, "url")) add(url, span.label, span.start, span.end);
  }
  const args = config.get("args", true);
  if (isSeq(args)) {
    args.items.forEach((item, i) => {
      if (!isScalar(item) || typeof item.value !== "string") return;
      const text = item.value;
      const previous = args.items[i - 1];
      const previousFlag =
        isScalar(previous) && typeof previous.value === "string" ? flagName(previous.value) : null;
      const inline = /^--?([A-Za-z][A-Za-z0-9_.-]*)=/.exec(text);
      if (inline !== null && SECRET_NAME.test(inline[1]!)) {
        add(item, `args:${i}`, inline[0].length, text.length);
      } else if (
        previousFlag !== null &&
        SECRET_NAME.test(previousFlag) &&
        flagName(text) === null
      ) {
        add(item, `args:${i}`, 0, text.length);
      } else if (text.includes("://")) {
        for (const span of urlSpans(text, `args:${i}`)) add(item, span.label, span.start, span.end);
      }
    });
  }
  return out;
}

/** The config parsed for editing; one whose MCP list goes through YAML aliases comes expanded. */
function editable(text: string): Document {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new HttpError(500, "invalid_config", "The Agent's system_config.yaml does not parse.");
  }
  let aliased = false;
  visit(doc, {
    Alias() {
      aliased = true;
      return visit.BREAK;
    },
  });
  return aliased ? new Document(doc.toJS()) : doc;
}

/** Every secret span of every MCP entry in the document. */
function spansOf(doc: Document): Span[] {
  const servers = doc.getIn(["tools", "mcpServers"], true);
  if (!isSeq(servers)) return [];
  return servers.items.flatMap((server) =>
    isMap(server) && !isAlias(server)
      ? entrySpans(String(server.get("name") ?? ""), server.get("config", true))
      : [],
  );
}

/** Replaces each span's text, the later spans of one scalar first so earlier offsets hold. */
function rewrite(spans: Span[], next: (span: Span) => string): void {
  const byNode = new Map<Scalar, Span[]>();
  for (const span of spans) byNode.set(span.node, [...(byNode.get(span.node) ?? []), span]);
  for (const [node, list] of byNode) {
    let text = String(node.value);
    for (const span of [...list].sort((a, b) => b.start - a.start)) {
      text = text.slice(0, span.start) + next(span) + text.slice(span.end);
    }
    node.value = text;
  }
}

const textOf = (span: Span): string => String(span.node.value).slice(span.start, span.end);

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

/** `system_config.yaml` as an export writes it: literal credentials blanked and named. */
export function redactSystemConfig(text: string): ConfigFacts & {
  text: string;
  redacted: string[];
} {
  const doc = editable(text);
  const secret = spansOf(doc).filter((span) => {
    const value = textOf(span);
    return value !== "" && !isReference(value);
  });
  rewrite(secret, () => "");
  return {
    ...factsOf(doc),
    text: secret.length > 0 ? doc.toString() : text,
    redacted: secret.map((span) => span.label),
  };
}

/**
 * `incoming` with each blank credential filled from `current` (the config being replaced) where
 * it holds a value at the same place; null when there was nothing to fill.
 */
export function restoreCredentials(incoming: string, current: string): string | null {
  const known = new Map<string, string>();
  for (const span of spansOf(editable(current))) {
    const value = textOf(span);
    if (value !== "") known.set(span.label, value);
  }
  const doc = editable(incoming);
  const blanks = spansOf(doc).filter((span) => textOf(span) === "" && known.has(span.label));
  if (blanks.length === 0) return null;
  rewrite(blanks, (span) => known.get(span.label)!);
  return doc.toString();
}

/** What the config still needs: blank credentials, and the vault keys its entries reference. */
export function credentialsToFill(text: string): { blank: string[]; vaultRefs: string[] } {
  const doc = editable(text);
  const blank = spansOf(doc)
    .filter((span) => textOf(span) === "")
    .map((span) => span.label);
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
