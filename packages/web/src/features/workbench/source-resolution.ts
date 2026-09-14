/**
 * The host half of the precise tier: what the page's framework said (`OriginEvidence`) becomes a
 * location in the user's own project — `source.file/line/column` in the payload, with the one honest
 * `confidence` the evidence supports.
 *
 * Three things happen here, in this order, and each one can fail on its own:
 *
 * 1. **Get the module's text.** From the host renderer, with an ordinary CORS `fetch` to the dev
 *    server the page came from (measured in M1's E5: the host origin reads the dev server directly,
 *    which is why no server-side proxy exists for this). Modules are cached: a pick is not the only
 *    thing that asks, and a design session re-picks the same file many times.
 * 2. **Turn the evidence into a generated position.** React 19 reported a *stack* of them, so the walk
 *    steps over React's own runtime frames and stops at the element's creator — which is reported even
 *    when the creator is a dependency, flagged, rather than traded for the line that uses it; React 18
 *    reported an offset inside a component's compiled text, which becomes a position once that text is
 *    found in the module it was served from.
 * 3. **Map it through the module's source map** — inline when the dev server inlined one, otherwise the
 *    `.map` the module names (`sourceMapOf`) — and make the path relative to the Session's workspace,
 *    because a payload says where the element is *in the project*.
 *
 * Nothing is guessed and nothing is repaired: a module with no map, a position with no
 * mapping on its line, or a framework that reports no position all end at `confidence: "none"`, and
 * the panel says so. Reporting a plausible-looking line from a neighbouring mapping is exactly what
 * PRD §6 rule 2 forbids, so the consumer refuses to do it (see `sourcemap.ts`).
 */
import { createConsumer, externalSourceMapUrlOf, inlineSourceMapOf } from "./sourcemap";
import type { SourceMapV3 } from "./sourcemap";
import type { PayloadSource, Confidence } from "./element-payload";
import type { OriginEvidence } from "./framework-sniffer";

export interface ResolveContext {
  /** The page the element was picked on — the base for a module URL the framework named as a path. */
  pageUrl: string;
  /** The Session's workspace: what a source path is made relative to. */
  projectRoot: string;
  /** How to read a module's text. Injectable so the mapping is testable without a dev server. */
  fetchText: (url: string) => Promise<string | null>;
  /**
   * The module URLs the page loaded, for the one case where the framework named no module: the
   * component's text is searched for in them. Optional — the primary routes do not need it.
   */
  moduleUrls?: string[];
}

/** Where a module path points, as a URL this host can fetch. */
export function moduleUrlOf(hint: string, pageUrl: string): string | null {
  if (/^https?:\/\//.test(hint)) return hint;
  try {
    // Vite serves files outside the project root under `/@fs`, and inside it under their path; the
    // `/@fs` form works for both, which is why the sniffer hands over the absolute path it saw.
    return new URL(hint.startsWith("/") ? `/@fs${hint}` : `/${hint}`, pageUrl).href;
  } catch {
    return null;
  }
}

/**
 * A source path as the project sees it: forward slashes, no leading slash, and no absolute prefix.
 * The payload's `file` is read by an Agent next to `projectRoot`, so a path that still contains the
 * machine's own directory layout would be noise at best.
 */
export function projectRelative(file: string, projectRoot: string): string {
  let path = file;
  const asUrl = path.match(/^[a-z][a-z0-9+.-]*:\/\//i);
  if (asUrl !== null) {
    try {
      path = new URL(path).pathname;
    } catch {
      /* keep the raw value; the checks below will do what they can */
    }
  }
  path = path.replace(/^\/@fs\//, "/");
  const root = projectRoot.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  if (root !== "" && (path === root || path.startsWith(`${root}/`))) path = path.slice(root.length);
  return path.replace(/^\/+/, "");
}

/** Line and column of a character offset in a module's text. 1-based line, 0-based column. */
export function positionOf(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const line = before.split("\n").length;
  return { line, column: offset - (before.lastIndexOf("\n") + 1) };
}

/**
 * A `sources` entry as an address. A dev server writes them *relative to the module*: the map inside
 * `/src/Badge.jsx` says `Badge.jsx`, and reading that as a project path loses the directory the page
 * was served from — measured in M1, whose PoC resolved the entry against the module URL for exactly
 * this reason. So a relative entry is resolved against the module it was found in; one that is already
 * absolute (`/src/Badge.jsx`) or a URL is taken as it stands.
 */
export function sourcePathOf(source: string, moduleUrl: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source) || source.startsWith("/")) return source;
  try {
    return new URL(source, moduleUrl).href;
  } catch {
    return source;
  }
}

function snippetFor(
  map: { sources?: string[]; sourcesContent?: (string | null)[] },
  source: string,
  line: number,
): string | undefined {
  const index = (map.sources ?? []).indexOf(source);
  if (index === -1) return undefined;
  const content = map.sourcesContent?.[index];
  if (content === undefined || content === null) return undefined;
  const text = content.split("\n")[line - 1];
  return text === undefined ? undefined : text.trim();
}

function thirdParty(file: string, moduleUrl: string): boolean {
  return file.includes("node_modules/") || moduleUrl.includes("/node_modules/");
}

/**
 * Is this frame React's own runtime rather than the page's code? The element's *creator* is the first
 * frame that is not, so this question has to be answered before anyone can be named, and it is a
 * question about modules, not about function names (which bundlers rewrite freely):
 *
 * - the package itself — `/node_modules/react/…`, `/node_modules/react-dom/…`;
 * - Vite's pre-bundled form — `…/deps/react_jsx-dev-runtime.js`, `…/deps/react-dom_client.js`,
 *   `…/deps/react.js` — which is the shape a dev server actually serves and which contains no
 *   `node_modules` anywhere in its URL.
 *
 * `react-markdown` and its kindred must not match: those are dependencies the *user* renders, and
 * their frames are the element's own creator, which the payload is supposed to name.
 */
export function isReactRuntime(moduleUrl: string, mappedFile: string | null): boolean {
  const withoutQuery = (value: string): string => value.split("?")[0] ?? "";
  // The package itself. `node_modules` is required: a user's own `src/react/…` directory is the user's
  // code, and skipping it would report an outer component in its place.
  const packageDir = /\/node_modules\/react(?:-dom)?\//;
  // Vite's pre-bundled form — the shape a dev server actually serves, with no `node_modules` anywhere
  // in the URL: `deps/react.js`, `deps/react_jsx-dev-runtime.js`, `deps/react-dom_client.js`.
  const runtimeFile =
    /\/(?:react|react-dom|react_jsx-dev-runtime|react_jsx_runtime|react-dom_client|react_dom_client)\.m?js$/;
  return [withoutQuery(moduleUrl), mappedFile === null ? "" : withoutQuery(mappedFile)].some(
    (path) => path !== "" && (packageDir.test(path) || runtimeFile.test(path)),
  );
}

/**
 * The map of a module the host has already read: the inline one when the dev server put it there, and
 * otherwise the side-car `.map` the module names, fetched through the same reader.
 *
 * Both forms are needed, and which one appears is the dev server's decision rather than ours: measured
 * in M3.3, Vite 7 inlines the map of its small pre-bundled chunks and serves the large ones — the
 * `deps/react-markdown.js` an element created by a dependency is reported from — with
 * `//# sourceMappingURL=react-markdown.js.map` beside them. Without the second form a library-created
 * element answers "no location" while the map that would have located it sits one request away.
 */
async function sourceMapOf(
  moduleText: string,
  moduleUrl: string,
  context: ResolveContext,
): Promise<SourceMapV3 | null> {
  const inline = inlineSourceMapOf(moduleText);
  if (inline !== null) return inline;
  const named = externalSourceMapUrlOf(moduleText);
  if (named === null) return null;
  let mapUrl: string;
  try {
    mapUrl = new URL(named, moduleUrl).href;
  } catch {
    return null;
  }
  const text = await context.fetchText(mapUrl);
  if (text === null) return null;
  try {
    return JSON.parse(text) as SourceMapV3;
  } catch {
    // A map that is not JSON is no map; the caller reports `none` rather than guessing.
    return null;
  }
}

/** Map a generated position through the module's source map — inline, or the `.map` beside it. */
async function mapGenerated(
  moduleText: string,
  moduleUrl: string,
  generated: { line: number; column: number },
  context: ResolveContext,
): Promise<PayloadSource> {
  const map = await sourceMapOf(moduleText, moduleUrl, context);
  if (map === null) return { confidence: "none" };
  const consumer = createConsumer(map);
  // The browser reports 1-based columns; the map's columns are 0-based (see `sourcemap.ts`).
  const position = consumer.originalPositionFor({
    line: generated.line,
    column: generated.column - 1,
  });
  if (position.source === null || position.line === null || position.column === null) {
    return { confidence: "none" };
  }
  const file = projectRelative(sourcePathOf(position.source, moduleUrl), context.projectRoot);
  const snippet = snippetFor(map, position.source, position.line);
  const source: PayloadSource = {
    file,
    line: position.line,
    column: position.column + 1,
    confidence: "exact",
    ...(snippet === undefined ? {} : { jsxSnippet: snippet }),
    ...(thirdParty(file, moduleUrl) ? { moduleIsThirdParty: true } : {}),
  };
  return source;
}

/**
 * Resolve one piece of origin evidence into the payload's source half. Never throws: a location that
 * cannot be worked out is reported as `none`, which is a fact about our knowledge rather than a
 * failure of the feature.
 */
export async function resolveSource(
  origin: OriginEvidence | null,
  context: ResolveContext,
): Promise<PayloadSource> {
  if (origin === null) return { confidence: "none" };

  if (origin.via === "source-loc") {
    // The framework reported the position itself; there is nothing to map. The *line* is taken as it
    // stands — Svelte 5 counts them from one, like everyone else — and the **column is not**: the
    // framework's own base is zero, the same base V8 and source maps use and the opposite of what a
    // payload means by `column`. Both of the other routes already make that conversion (the browser's
    // 1-based report loses one before the map is asked, and gains it back afterwards), so leaving this
    // one alone would put two different bases in the same field. Measured in M3.4: `Badge.svelte`
    // reported `5:0` against a truth table of `5:1`, off by exactly one on all three elements.
    const file = projectRelative(origin.file, context.projectRoot);
    const source: PayloadSource = {
      file,
      line: origin.line,
      column: origin.column + 1,
      confidence: "exact",
    };
    return thirdParty(file, origin.file) ? { ...source, moduleIsThirdParty: true } : source;
  }

  if (origin.via === "file-only") {
    const file = projectRelative(origin.file, context.projectRoot);
    const source: PayloadSource = {
      file,
      confidence: "file-only",
      ...(origin.component === null ? {} : { component: origin.component }),
    };
    return thirdParty(file, origin.file) ? { ...source, moduleIsThirdParty: true } : source;
  }

  if (origin.via === "frames") {
    // React 19 handed over its stack, in the runtime's order, and the frame to report is the
    // element's **creator**: the first frame that is not React's own runtime. React's stack always
    // opens with the JSX factory's `jsxDEV` and carries the renderer's frames below the creator, so
    // stepping over React's runtime leaves exactly the component (or anonymous callback) that wrote
    // this element.
    //
    // It is deliberately *not* "the first frame that is not a dependency". When a library renders the
    // element, the creator **is** the library, and the PRD wants that said out loud: the payload names
    // the dependency's own file and sets `moduleIsThirdParty`, so an Agent is sent to "传参 or 包一层"
    // instead of being handed the line that merely *uses* the library and told the element lives there.
    for (const frame of origin.frames) {
      // Cheap pass first: the served module's own name can say React already (Vite's pre-bundled
      // `deps/react_jsx-dev-runtime.js` has no `node_modules` in its URL at all).
      if (isReactRuntime(frame.url, null)) continue;
      const moduleText = await context.fetchText(frame.url);
      if (moduleText === null) {
        // The creator's module could not be read. An outer frame belongs to a *different* component,
        // so it is not a substitute: the answer is "no location", with the name still known.
        return frame.fn === null
          ? { confidence: "none" }
          : { confidence: "none", component: frame.fn };
      }
      const mapped = await mapGenerated(
        moduleText,
        frame.url,
        { line: frame.line, column: frame.column },
        context,
      );
      // Second pass, on what the map says: this frame is React's renderer, not the creator.
      if (isReactRuntime(frame.url, mapped.file ?? null)) continue;
      if (mapped.confidence === "none") {
        // No mapping on this line: this frame tells us nothing about *where*, and a neighbouring
        // mapping is not allowed to stand in for it.
        return frame.fn === null
          ? { confidence: "none" }
          : { confidence: "none", component: frame.fn };
      }
      // A creator inside a dependency keeps `exact` — where it is *is* known, and `mapGenerated`
      // already added `moduleIsThirdParty` to say that editing it there changes nothing.
      return frame.fn === null ? mapped : { ...mapped, component: frame.fn };
    }
    // Nothing but React's own runtime in the stack: no code we can point at wrote this element.
    return { confidence: "none", moduleIsThirdParty: true };
  }

  // React 18: the component text has to be found in the module it was served from, and the offset
  // inside it turned into a position. More than one candidate means the element was written inside
  // something like a `map()` — a location that may be another sibling's, so it is never `exact`.
  const moduleUrl =
    origin.moduleHint === null
      ? await findModuleWith(context, origin.fnText)
      : moduleUrlOf(origin.moduleHint, context.pageUrl);
  if (moduleUrl === null) return { confidence: "none", candidates: origin.candidates };
  if (moduleUrl.includes("/node_modules/")) {
    return { confidence: "none", moduleIsThirdParty: true, candidates: origin.candidates };
  }
  const moduleText = await context.fetchText(moduleUrl);
  if (moduleText === null) return { confidence: "none", candidates: origin.candidates };
  const at = moduleText.indexOf(origin.fnText);
  if (at === -1) return { confidence: "none", candidates: origin.candidates };
  const mapped = await mapGenerated(
    moduleText,
    moduleUrl,
    positionOf(moduleText, at + origin.offset),
    context,
  );
  const confidence: Confidence = origin.candidates > 1 ? "ambiguous" : mapped.confidence;
  return {
    ...mapped,
    confidence,
    candidates: origin.candidates,
    ...(origin.component === null ? {} : { component: origin.component }),
  };
}

/**
 * The fallback when the framework named no module: the component's own text is a long, distinctive
 * string, so the module that contains it is the module it was compiled from. The page's loaded
 * scripts are the candidates (`performance` entries), which costs nothing and covers the case where
 * `_debugSource` is absent.
 */
async function findModuleWith(context: ResolveContext, fnText: string): Promise<string | null> {
  const sources = context.moduleUrls ?? [];
  for (const url of sources) {
    const text = await context.fetchText(url);
    if (text !== null && text.includes(fnText)) return url;
  }
  return null;
}

/**
 * The module reader the panel uses: an ordinary CORS `fetch` to the user's dev server, with the
 * text cached per URL. `credentials: "omit"` because this is someone's dev server and not a session
 * we have: the request carries no cookie, exactly like the port probe.
 */
export function createModuleReader(): (url: string) => Promise<string | null> {
  const cache = new Map<string, string | null>();
  return async (url: string): Promise<string | null> => {
    const cached = cache.get(url);
    if (cached !== undefined) return cached;
    let text: string | null = null;
    try {
      const response = await fetch(url, { mode: "cors", credentials: "omit" });
      text = response.ok ? await response.text() : null;
    } catch {
      // A dev server that went away mid-session, or one without CORS: the answer is "no text",
      // which `resolveSource` already knows how to report honestly.
      text = null;
    }
    cache.set(url, text);
    return text;
  };
}
