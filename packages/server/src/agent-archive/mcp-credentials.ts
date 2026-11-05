/**
 * MCP credentials in an Agent archive's `system_config.yaml`.
 *
 * On export, every literal credential in an MCP entry is blanked and named in
 * `manifest.redacted` by where it was (`mcp:<server>:<place>`), a name counting as a credential's
 * by credential-names.ts:
 *
 * - an `env` or `headers` value under such a name: `env:<NAME>`, `headers:<NAME>`;
 * - in `oauth`, a value (at any depth) under such a name — a client secret, a token:
 *   `oauth:<path>`;
 * - in `url`, the password of its user info (`url:password`) and each query parameter under such
 *   a name (`url:query:<name>`);
 * - in `args`, the value of a `--<name>=<value>` argument and the argument after a `--<name>`
 *   flag (`args:--<name>`), and in a URL-shaped argument the same two places as in `url`, named
 *   by the URL's origin (`args:<scheme>://<host>:password`, `args:<scheme>://<host>:query:<name>`).
 *
 * A value written as `${KEY}` vault references is not a secret — the vault holds it — and travels
 * as written. Everything else in the config travels as written.
 *
 * On an overwrite, a blanked value is filled back from the Agent's own config only when the
 * incoming entry is the same server — the same name and the same command (stdio) or the same URL
 * origin (http) — and the place has the same name there, once on each side. Anything less certain
 * is not filled, and the place stays in `toFill`: a value never goes to another address or into
 * another flag. After an import, what is still blank, and every vault key the entries reference,
 * is what the user must fill.
 *
 * The YAML is edited as a document, so its comments and layout survive and a config with nothing
 * to blank or restore is left byte for byte. A config using YAML aliases is first expanded, so
 * that a credential reached through an alias is not missed.
 */
import { VAULT_REF_PATTERN } from "@prismshadow/penguin-core";
import { Document, Scalar, isAlias, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
import { HttpError } from "../http/errors.js";
import { isCredentialName } from "./credential-names.js";

/** One secret inside one string of the document: the scalar holding it and where in its text. */
interface Span {
  server: string;
  /** `mcp:<server>:<place>`. */
  label: string;
  node: Scalar;
  start: number;
  end: number;
}

const isReference = (text: string): boolean => [...text.matchAll(VAULT_REF_PATTERN)].length > 0;

const URL_HEAD = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(?:[^/?#@]*@)?([^/?#]*)/;

/** `scheme://host[:port]`, lower-cased, of a URL-shaped string; null when it is not one. */
function originOf(text: string): string | null {
  const head = URL_HEAD.exec(text);
  return head === null ? null : `${head[1]!.toLowerCase()}://${head[2]!.toLowerCase()}`;
}

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
      if (eq > 0 && isCredentialName(decodeURIComponentSafe(pair.slice(0, eq)))) {
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
  const add = (node: Scalar, place: string, start: number, end: number): void => {
    out.push({ server, label: `mcp:${server}:${place}`, node, start, end });
  };
  const whole = (node: unknown, place: string): void => {
    // A number is a credential too (a PIN, a numeric key) once its name says so.
    if (isScalar(node) && (typeof node.value === "string" || typeof node.value === "number")) {
      add(node, place, 0, String(node.value).length);
    }
  };
  for (const field of ["env", "headers"] as const) {
    const values = config.get(field, true);
    if (!isMap(values)) continue;
    for (const pair of values.items) {
      const name = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      if (isCredentialName(name)) whole(pair.value, `${field}:${name}`);
    }
  }
  const oauth = (node: unknown, at: string): void => {
    if (!isMap(node)) return;
    for (const pair of node.items) {
      const name = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      const path = at === "" ? name : `${at}.${name}`;
      if (isMap(pair.value)) oauth(pair.value, path);
      else if (isCredentialName(name)) whole(pair.value, `oauth:${path}`);
    }
  };
  oauth(config.get("oauth", true), "");
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
      const inline = /^(--?)([A-Za-z][A-Za-z0-9_.-]*)=/.exec(text);
      if (inline !== null && isCredentialName(inline[2]!)) {
        add(item, `args:${inline[1]}${inline[2]}`, inline[0].length, text.length);
      } else if (
        previousFlag !== null &&
        isCredentialName(previousFlag) &&
        flagName(text) === null
      ) {
        add(item, `args:${String((previous as Scalar).value)}`, 0, text.length);
      } else {
        const origin = originOf(text);
        if (origin === null) return;
        for (const span of urlSpans(text, `args:${origin}`)) {
          add(item, span.label, span.start, span.end);
        }
      }
    });
  }
  return out;
}

/**
 * The config parsed for editing; one that uses YAML aliases comes expanded (`aliased`), every
 * alias a copy of the node it named.
 */
function parseEditable(text: string): { doc: Document; aliased: boolean } {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new HttpError(
      422,
      "invalid_config",
      "The Agent's system_config.yaml does not parse; fix it before exporting the Agent.",
    );
  }
  let aliased = false;
  visit(doc, {
    Alias() {
      aliased = true;
      return visit.BREAK;
    },
  });
  // toJS() hands an aliased node back as one shared object; without this, the new document
  // would alias it again.
  return {
    doc: aliased ? new Document(doc.toJS(), { aliasDuplicateObjects: false }) : doc,
    aliased,
  };
}

const editable = (text: string): Document => parseEditable(text).doc;

/** Whether a config text parses as YAML. */
export function configParses(text: string): boolean {
  return parseDocument(text).errors.length === 0;
}

interface ServerEntry {
  name: string;
  /** `command:<command>` for stdio, `url:<origin>` for http; what makes it the same server. */
  identity: string;
  spans: Span[];
}

/** Every MCP entry of the document with its secret spans. */
function serversOf(doc: Document): ServerEntry[] {
  const servers = doc.getIn(["tools", "mcpServers"], true);
  if (!isSeq(servers)) return [];
  return servers.items.flatMap((server) => {
    if (!isMap(server) || isAlias(server)) return [];
    const name = String(server.get("name") ?? "");
    const config = server.get("config", true);
    const command = isMap(config) ? config.get("command") : undefined;
    const url = isMap(config) ? config.get("url") : undefined;
    const identity =
      typeof command === "string"
        ? `command:${command}`
        : typeof url === "string"
          ? `url:${originOf(url) ?? url}`
          : "";
    return [{ name, identity, spans: entrySpans(name, config) }];
  });
}

const spansOf = (doc: Document): Span[] => serversOf(doc).flatMap((server) => server.spans);

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
  const { doc, aliased } = parseEditable(text);
  const secret = spansOf(doc).filter((span) => {
    const value = textOf(span);
    return value !== "" && !isReference(value);
  });
  // Short values would match unrelated text; an anchor's copy of one is blanked by its own span.
  const values = [...new Set(secret.map(textOf))].filter((value) => value.length >= 6);
  rewrite(secret, () => "");
  if (aliased) {
    // The node an alias named is still in the document, wherever its anchor was: a secret
    // reached through one is taken out of every string that holds it.
    visit(doc, {
      Scalar(_key, node) {
        if (typeof node.value !== "string") return;
        let text = node.value;
        for (const value of values) text = text.split(value).join("");
        node.value = text;
      },
    });
  }
  return {
    ...factsOf(doc),
    text: secret.length > 0 ? doc.toString() : text,
    redacted: secret.map((span) => span.label),
  };
}

/** The spans of `server` keyed by label, keeping only the labels it has once. */
function uniqueByLabel(server: ServerEntry): Map<string, Span> {
  const counts = new Map<string, number>();
  for (const span of server.spans) counts.set(span.label, (counts.get(span.label) ?? 0) + 1);
  return new Map(
    server.spans.filter((span) => counts.get(span.label) === 1).map((span) => [span.label, span]),
  );
}

/**
 * `incoming` with each blank credential filled from `current` (the config being replaced), only
 * where the incoming entry is the same server (one entry of that name on each side, with the
 * same command or URL origin) and the place has the same name, once on each side; null when there
 * was nothing to fill.
 */
export function restoreCredentials(incoming: string, current: string): string | null {
  const theirs = serversOf(editable(current));
  const doc = editable(incoming);
  const ours = serversOf(doc);
  const fills: Array<{ span: Span; value: string }> = [];
  for (const server of ours) {
    const sameName = (list: ServerEntry[]) => list.filter((s) => s.name === server.name);
    const mine = sameName(theirs);
    if (mine.length !== 1 || sameName(ours).length !== 1) continue;
    if (server.identity === "" || mine[0]!.identity !== server.identity) continue;
    const known = uniqueByLabel(mine[0]!);
    for (const [label, span] of uniqueByLabel(server)) {
      const value = known.get(label);
      if (textOf(span) === "" && value !== undefined && textOf(value) !== "") {
        fills.push({ span, value: textOf(value) });
      }
    }
  }
  if (fills.length === 0) return null;
  const byLabel = new Map(fills.map((fill) => [fill.span, fill.value]));
  rewrite(
    fills.map((fill) => fill.span),
    (span) => byLabel.get(span)!,
  );
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
