/**
 * A source map consumer, written here rather than imported, for two measured reasons (M1's E6):
 * `node:module`'s `SourceMap` only exists in Node, and this panel lives in the host renderer process,
 * which runs `sandbox: true` with no Node and no preload; and `source-map-js` would be a new
 * dependency in a feature whose whole locating story is "no new dependency".
 *
 * The semantics are not invented — they were aligned point by point with `source-map-js`
 * (1225/1225 identical on a dense grid, M1 evidence `sm-compare`), including the one place the two
 * reference implementations disagree: a query whose generated line has no mapping of its own.
 * `source-map-js` answers "nothing" (the mapping it finds must be on the same generated line),
 * `node:module` falls back to the nearest mapping above. We take the conservative one: a fallback
 * gives a location that *looks* right on a line that was never mapped, and PRD §6 rule 2 forbids
 * reporting `exact` when the location may be wrong.
 *
 * Conventions, matching `source-map-js`: the query's `line` is 1-based and its `column` 0-based (the
 * browser reports columns 1-based, so a caller subtracts one), and the answer's `line` is 1-based
 * with a 0-based `column`.
 */

/** A source map v3 document, as it appears in a `sourceMappingURL` data URL. */
export interface SourceMapV3 {
  version?: number;
  file?: string;
  sourceRoot?: string;
  sources?: string[];
  sourcesContent?: (string | null)[];
  names?: string[];
  mappings: string;
}

export interface OriginalPosition {
  source: string | null;
  line: number | null;
  column: number | null;
  name: string | null;
}

interface Segment {
  genLine: number;
  genCol: number;
  source: number | null;
  srcLine: number | null;
  srcCol: number | null;
  name: number | null;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CHAR_TO_INT = new Int32Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i += 1) CHAR_TO_INT[BASE64.charCodeAt(i)] = i;

/** Decode one base64-VLQ segment into the integers it carries. */
function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (let i = 0; i < segment.length; i += 1) {
    const digit = CHAR_TO_INT[segment.charCodeAt(i)] ?? -1;
    if (digit === -1)
      throw new Error(`sourcemap: invalid base64 character ${JSON.stringify(segment[i] ?? "")}`);
    value += (digit & 31) * 2 ** shift;
    if ((digit & 32) === 0) {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
      continue;
    }
    shift += 5;
  }
  return out;
}

/** `mappings` split into one segment list per generated line (both 0-based). */
export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  let nameIdx = 0;
  for (const lineText of String(mappings ?? "").split(";")) {
    const segments: Segment[] = [];
    const genLine = lines.length;
    let genCol = 0;
    if (lineText !== "") {
      for (const text of lineText.split(",")) {
        if (text === "") continue;
        const values = decodeVlq(text);
        genCol += values[0] ?? 0;
        if (values.length === 1) {
          // A generated column with no source at all — the spec allows it, and it must not inherit
          // the previous segment's source.
          segments.push({ genLine, genCol, source: null, srcLine: null, srcCol: null, name: null });
          continue;
        }
        srcIdx += values[1] ?? 0;
        srcLine += values[2] ?? 0;
        srcCol += values[3] ?? 0;
        if (values.length > 4) nameIdx += values[4] ?? 0;
        segments.push({
          genLine,
          genCol,
          source: srcIdx,
          srcLine,
          srcCol,
          name: values.length > 4 ? nameIdx : null,
        });
      }
    }
    lines.push(segments);
  }
  return lines;
}

function joinSourceRoot(root: string | undefined, source: string): string {
  if (root === undefined || root === "") return source;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source) || source.startsWith("/")) return source;
  return root.endsWith("/") ? root + source : `${root}/${source}`;
}

/**
 * A consumer for one parsed source map. `data:` URLs in `sources` are deliberately left alone —
 * neither reference implementation resolves them, so neither do we; the caller decodes the map it
 * found in the module text and passes it in here.
 */
export function createConsumer(map: SourceMapV3) {
  const decoded = decodeMappings(map.mappings);
  const sources = (map.sources ?? []).map((s) => joinSourceRoot(map.sourceRoot, s));
  const sourcesContent = map.sourcesContent ?? null;

  const result = (segment: Segment | null): OriginalPosition => {
    if (segment === null || segment.source === null) {
      return { source: null, line: null, column: null, name: null };
    }
    return {
      source: sources[segment.source] ?? null,
      line: (segment.srcLine ?? 0) + 1,
      column: segment.srcCol,
      name: segment.name === null ? null : (map.names?.[segment.name] ?? null),
    };
  };

  /** GREATEST_LOWER_BOUND, within the queried generated line only — see this module's header. */
  function findSegment(line: number, column: number): Segment | null {
    const line0 = decoded[line - 1];
    if (line0 === undefined) return null;
    let found: Segment | null = null;
    for (const segment of line0) {
      if (segment.genCol <= column) found = segment;
      else break;
    }
    return found;
  }

  return {
    sources,
    sourcesContent,
    originalPositionFor(query: { line: number; column: number }): OriginalPosition {
      return result(findSegment(query.line, query.column));
    },
  };
}

/** The inline source map a development build appends to a module, decoded; null when there is none. */
export function inlineSourceMapOf(moduleText: string): SourceMapV3 | null {
  const match = String(moduleText).match(
    /\/\/#\s*sourceMappingURL=data:application\/json[^,]*,([A-Za-z0-9+/=]+)/,
  );
  const encoded = match?.[1];
  if (encoded === undefined) return null;
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as SourceMapV3;
  } catch {
    return null;
  }
}

/**
 * The *side-car* map a module names instead of carrying one — `//# sourceMappingURL=app.js.map` —
 * as the URL to fetch it from, or null when the module names none (or names a `data:` URL, which
 * `inlineSourceMapOf` handles). What a dev server does differs by file and is not a choice we get to
 * make: measured in M3.3, Vite 7 serves its small pre-bundled chunks with the map **inlined** and its
 * large ones (`deps/react-markdown.js`, 365 KB of source) with a `.map` **beside** them, and an
 * element a dependency created is only locatable through the second form.
 *
 * The returned URL is still relative to the module; the caller resolves it (`new URL(url, moduleUrl)`).
 */
export function externalSourceMapUrlOf(moduleText: string): string | null {
  // The last comment wins: a bundler appends its own after anything the sources contained.
  const matches = [...String(moduleText).matchAll(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/g)];
  const value = matches[matches.length - 1]?.[1];
  if (value === undefined || value.startsWith("data:")) return null;
  return value;
}
