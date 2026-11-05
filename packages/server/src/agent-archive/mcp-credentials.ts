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
 *   flag (`args:--<name>`);
 * - whatever its name, in any string of the entry (an `env` value, a header, an argument, a
 *   field of its own): the password of a URL's user info and each query parameter under such a
 *   name (`<place>:password`, `<place>:query:<name>`, with `url` and an `env` or header name as
 *   the place, and in `args` the URL's origin: `args:<scheme>://<host>:password`), and the value
 *   of each such pair in a connection string (`Server=db;Password=…;` gives
 *   `<place>:conn:Password`).
 *
 * A value written as `${KEY}` vault references is not a secret — the vault holds it — and travels
 * as written. Everything else in the config travels as written.
 *
 * On an overwrite, a blanked value is filled back from the Agent's own config only when the
 * incoming entry is the same server — the same name, and for stdio the same command with the
 * same arguments once their secrets are taken out (in any order), for http the same URL origin —
 * and the place has the same name there, once on each side. Anything less certain
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

/** Where a URL's authority (`user:password@host:port`) starts and ends in `text`, from `://`. */
function authorityOf(text: string): { start: number; end: number } | null {
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(text);
  if (scheme === null) return null;
  const start = scheme[0].length;
  const stop = text.slice(start).search(/[/?#]/);
  return { start, end: stop < 0 ? text.length : start + stop };
}

/** `scheme://host[:port]`, lower-cased, of a URL-shaped string; null when it is not one. */
function originOf(text: string): string | null {
  const authority = authorityOf(text);
  if (authority === null) return null;
  const at = text.lastIndexOf("@", authority.end - 1);
  const host = text.slice(at >= authority.start ? at + 1 : authority.start, authority.end);
  return `${text.slice(0, authority.start - 3).toLowerCase()}://${host.toLowerCase()}`;
}

interface Found {
  label: string;
  start: number;
  end: number;
}

/**
 * The spans of a URL's secrets, `text` starting with the URL: the password of its user info
 * (`<at>:password`) and each query parameter under a credential's name (`<at>:query:<name>`).
 */
function urlSpans(text: string, at: string): Found[] {
  const out: Found[] = [];
  const authority = authorityOf(text);
  if (authority === null) return out;
  // The host follows the last `@`: a password holding one, unescaped, is still all password.
  const host = text.lastIndexOf("@", authority.end - 1);
  const colon = text.indexOf(":", authority.start);
  if (host >= authority.start && colon >= 0 && colon < host) {
    out.push({ label: `${at}:password`, start: colon + 1, end: host });
  }
  const query = text.indexOf("?", authority.end);
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

/** Every URL inside `text` (`scheme://…` up to a space or a quote), with where it starts. */
function urlsIn(text: string): Array<{ start: number; url: string }> {
  return [...text.matchAll(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g)].map((match) => ({
    start: match.index ?? 0,
    url: match[0],
  }));
}

/**
 * The values of a connection string's credential pairs (`Server=db;User Id=app;Password=…;`),
 * each named `<at>:conn:<key>`; nothing for a string that is not one.
 */
function connectionSpans(text: string, at: string): Found[] {
  const out: Found[] = [];
  if (!text.includes(";") || !text.includes("=")) return out;
  let pos = 0;
  while (pos < text.length) {
    const eq = text.indexOf("=", pos);
    if (eq < 0) break;
    const semi = text.indexOf(";", pos);
    if (semi >= 0 && semi < eq) {
      pos = semi + 1; // A part without a value.
      continue;
    }
    const key = text.slice(pos, eq).trim();
    let start = eq + 1;
    while (text[start] === " ") start += 1;
    let end: number;
    const quote = text[start];
    if (quote === '"' || quote === "'") {
      start += 1;
      const close = text.indexOf(quote, start);
      end = close < 0 ? text.length : close;
      const next = text.indexOf(";", end);
      pos = next < 0 ? text.length : next + 1;
    } else {
      const next = text.indexOf(";", start);
      end = next < 0 ? text.length : next;
      pos = end + 1;
      while (end > start && text[end - 1] === " ") end -= 1;
    }
    if (/^[A-Za-z][A-Za-z0-9 _.-]*$/.test(key) && isCredentialName(key)) {
      out.push({ label: `${at}:conn:${key}`, start, end });
    }
  }
  return out;
}

/** The spans with none overlapping an earlier (or, at one start, a longer) one. */
function withoutOverlaps(spans: Found[]): Found[] {
  const kept: Found[] = [];
  let reached = -1;
  for (const span of [...spans].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (span.start < reached) continue;
    kept.push(span);
    reached = Math.max(reached, span.end);
  }
  return kept;
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

const keyOf = (key: unknown): string => (isScalar(key) ? String(key.value) : String(key));

/** The place a value at `path` in an entry's config is named by in a label. */
function placeOf(path: ReadonlyArray<string | number>): string {
  const [field, ...rest] = path;
  if (field === "env" || field === "headers" || field === "oauth") {
    return `${field}:${rest.join(".")}`;
  }
  return path.join(".");
}

/** Every secret span of one MCP entry's config map. */
function entrySpans(server: string, config: unknown): Span[] {
  if (!isMap(config)) return [];
  const out: Span[] = [];
  const whole = new Set<Scalar>();
  const add = (node: Scalar, place: string, start: number, end: number): void => {
    out.push({ server, label: `mcp:${server}:${place}`, node, start, end });
  };
  const blank = (node: unknown, place: string): void => {
    // A number is a credential too (a PIN, a numeric key) once its name says so.
    if (isScalar(node) && (typeof node.value === "string" || typeof node.value === "number")) {
      add(node, place, 0, String(node.value).length);
      whole.add(node);
    }
  };
  // By name: a value whose name is a credential's goes whole.
  for (const field of ["env", "headers"] as const) {
    const values = config.get(field, true);
    if (!isMap(values)) continue;
    for (const pair of values.items) {
      const name = keyOf(pair.key);
      if (isCredentialName(name)) blank(pair.value, `${field}:${name}`);
    }
  }
  const oauth = (node: unknown, at: string): void => {
    if (!isMap(node)) return;
    for (const pair of node.items) {
      const name = keyOf(pair.key);
      const path = at === "" ? name : `${at}.${name}`;
      if (isMap(pair.value)) oauth(pair.value, path);
      else if (isCredentialName(name)) blank(pair.value, `oauth:${path}`);
    }
  };
  oauth(config.get("oauth", true), "");
  // In `args`, a flag names the value: `--<name>=<value>`, or the argument after `--<name>`.
  const args = config.get("args", true);
  const argBase = new Map<Scalar, string>();
  if (isSeq(args)) {
    args.items.forEach((item, i) => {
      if (!isScalar(item) || typeof item.value !== "string") return;
      const text = item.value;
      const previous = args.items[i - 1];
      const previousText =
        isScalar(previous) && typeof previous.value === "string" ? previous.value : null;
      const previousFlag = previousText === null ? null : flagName(previousText);
      const inline = /^(--?)([A-Za-z][A-Za-z0-9_.-]*)=/.exec(text);
      if (inline !== null) argBase.set(item, `args:${inline[1]}${inline[2]}`);
      else if (previousFlag !== null) argBase.set(item, `args:${previousText}`);
      if (inline !== null && isCredentialName(inline[2]!)) {
        add(item, `args:${inline[1]}${inline[2]}`, inline[0].length, text.length);
        whole.add(item);
      } else if (
        previousFlag !== null &&
        isCredentialName(previousFlag) &&
        flagName(text) === null
      ) {
        blank(item, `args:${previousText}`);
      }
    });
  }
  // Whatever its name, any string of the entry holding a URL with a password or a credential's
  // query parameter, or a connection string's credential pair, gives those parts up.
  const strings = (node: unknown, path: Array<string | number>): void => {
    if (isScalar(node)) {
      if (typeof node.value !== "string" || whole.has(node)) return;
      const text = node.value;
      const inArgs = path[0] === "args" && path.length === 2;
      const found: Found[] = [];
      for (const { start, url } of urlsIn(text)) {
        const at = inArgs ? `args:${originOf(url)}` : placeOf(path);
        for (const span of urlSpans(url, at)) {
          found.push({ ...span, start: start + span.start, end: start + span.end });
        }
      }
      found.push(...connectionSpans(text, inArgs ? (argBase.get(node) ?? "args") : placeOf(path)));
      for (const span of withoutOverlaps(found)) add(node, span.label, span.start, span.end);
    } else if (isMap(node)) {
      for (const pair of node.items) strings(pair.value, [...path, keyOf(pair.key)]);
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => strings(item, [...path, i]));
    }
  };
  strings(config, []);
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
  /**
   * What makes it the same server: for stdio its command and its arguments with their secrets
   * taken out (in any order, so a different package is a different server); for http its URL's
   * origin.
   */
  identity: string;
  spans: Span[];
}

/** An entry's arguments with every secret span cut out, sorted. */
function maskedArgs(config: unknown, spans: readonly Span[]): string[] {
  const args = isMap(config) ? config.get("args", true) : undefined;
  if (!isSeq(args)) return [];
  return args.items
    .map((item) => {
      if (!isScalar(item)) return JSON.stringify((item as { toJSON?: () => unknown })?.toJSON?.());
      let text = String(item.value);
      const mine = spans.filter((span) => span.node === item).sort((a, b) => b.start - a.start);
      for (const span of mine) text = text.slice(0, span.start) + text.slice(span.end);
      return text;
    })
    .sort();
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
    const spans = entrySpans(name, config);
    const identity =
      typeof command === "string"
        ? `command:${command} args:${JSON.stringify(maskedArgs(config, spans))}`
        : typeof url === "string"
          ? `url:${originOf(url) ?? url}`
          : "";
    return [{ name, identity, spans }];
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
 * where the incoming entry is the same server (one entry of that name on each side with the same
 * identity: see `ServerEntry`) and the place has the same name, once on each side; null when
 * there was nothing to fill.
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
