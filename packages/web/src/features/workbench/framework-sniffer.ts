/**
 * Where an element came from, asked of the page's own framework — the guest-side half of the precise
 * tier (M3). It answers one question and stops: *which module, and where in it*. Turning that into a
 * `file:line:column` in the user's project is the host's job (`source-resolution.ts`), because it
 * needs the module's text and its inline source map, and the guest is the one place we must keep
 * small, read-only and cheap.
 *
 * Nothing here is invented, and each route is a measurement rather than a guess (M1, archived in
 * `创作库/ui-design-workbench调研/实测脚本/`):
 *
 * - **React 19** dropped `_debugSource` and carries a `_debugStack` instead: a V8 stack whose frames
 *   name the module and the generated position. The stack is handed over **whole and in order**, and
 *   the guest does not try to pick one: React's own `jsxDEV` is the first frame, the user's component
 *   is the second, and which of them is *the* location cannot be decided here. Whether a frame is a
 *   dependency takes the module's text and the project root — the host's business (`source-resolution
 *   .ts`), and the reason the guest used to answer with a wrong frame: a pre-bundled dependency
 *   (`/@fs/…/deps/react_jsx-dev-runtime.js`) has no `/node_modules/` in its URL, but its *mapped*
 *   source does, so the guest-side filter could not see it. Frames must be parsed from the *raw* text:
 *   an anonymous arrow callback produces a frame with no function name and no parentheses, and its URL
 *   carries a port — a pattern that assumes either loses that frame and silently falls back to an
 *   outer one, which is how the `.map()` case was reported one line wrong before the regex was fixed.
 *   Only **this element's own fiber** may hand over a stack, and the chain is not searched for one
 *   (M3.3): an ancestor's `_debugStack` names where the *ancestor* was created, so an element a
 *   dependency made with a runtime that captures no stack would have been reported at the user's line
 *   that calls the library — `exact`, and false.
 * - **React 18** has no usable line numbers, so the element is located by the component's own
 *   compiled text: find the nearest function-component fiber, take its source text, and find the
 *   `jsxDEV(...)` call that produced this element — by tag, then by class. The scan has to balance
 *   brackets (the "`i = open + 1` trap": the next search must continue *inside* the call, or nested
 *   JSX is missed) and skip over string literals, because a `)` inside a prop string ends a call that
 *   has not ended.
 * - **Svelte 5** answers outright: dev-mode compilation writes `element.__svelte_meta = {loc: {file,
 *   line, column}}` pointing at the component source. No mapping needed.
 * - **Vue 3** answers with a file and no line (`instance.type.__file`), because the compiler hoists
 *   static attributes into `_hoisted_N` constants. Honest answer: file only.
 *
 * The function is serialized with `toString()` and handed to the guest, so it must be
 * **self-contained**: every helper it uses is declared inside it, and it must not touch anything from
 * this module's scope (a reference to an outer binding compiles fine and fails silently in the page).
 */
/** What the page's framework said about an element's origin — the raw evidence, before mapping. */
export type OriginEvidence =
  /**
   * The frames of a V8 stack the framework captured when it created the element (React 19's
   * `_debugStack`), **in order**: the module URL and generated position of each. More than one frame
   * is the norm, not an exception — React's own `jsxDEV` is frame one, the user's component is frame
   * two — and which frame is *the* location is not a question the guest can answer: it takes the
   * module text and the project root, which is the host's business (`source-resolution.ts`).
   */
  | {
      via: "frames";
      frames: { url: string; line: number; column: number; fn: string | null }[];
    }
  /**
   * A component's compiled text plus the offset of the JSX call inside it (React 18). The host finds
   * the text in the module it was served from and turns the offset into a generated position.
   * `candidates` counts the calls that matched this element: more than one is the `.map()` case, and
   * it must never be reported as exact.
   */
  | {
      via: "component-text";
      component: string | null;
      fnText: string;
      offset: number;
      moduleHint: string | null;
      candidates: number;
    }
  /**
   * A source location the framework itself reports (Svelte 5's `__svelte_meta.loc`), **in the
   * framework's own base**: the line counts from one, the column from zero. Nothing is corrected here
   * — the guest reports what it read — and the host makes the payload's one convention out of it
   * (`source-resolution.ts`).
   */
  | { via: "source-loc"; file: string; line: number; column: number }
  /** A file with no position (Vue 3's `__file`). */
  | { via: "file-only"; file: string; component: string | null };

/** The element shape the sniffer reads — duck-typed, so a test can hand it a plain object. */
export interface SniffableElement {
  tagName?: string;
  classList?: ArrayLike<string>;
  getAttribute?: (name: string) => string | null;
  __svelte_meta?: { loc?: { file?: string; line?: number; column?: number } } | null;
  __vueParentComponent?: { type?: { __file?: string; name?: string } } | null;
}

interface FiberLike {
  tag?: number;
  type?: unknown;
  return?: FiberLike | null;
  _debugStack?: { stack?: string } | string | null;
  _debugSource?: { fileName?: string } | null;
}

/**
 * Ask the page what it knows about this element. Returns null when it is not a framework's element
 * (plain DOM), or when the framework is one whose dev data is absent (a production build).
 */
export function sniffOrigin(element: unknown): OriginEvidence | null {
  const el = element as SniffableElement | null;
  if (el === null || el === undefined) return null;

  // V8 frames, in the raw text: `at Badge (http://host:5199/src/Badge.jsx:18:26)` for a named frame
  // and `at http://host:5199/src/List.jsx:19:29` for an anonymous arrow callback. The URL is matched
  // with a port-tolerant pattern; `[^\s:)]+` would stop at the colon before the port.
  const FRAME = /at\s+(?:(.*?)\s+)?\(?((?:https?|file|blob):\/\/[^\s()]+):(\d+):(\d+)\)?\s*$/;

  const classListOf = (node: SniffableElement): string[] => {
    const list = node.classList;
    return list === undefined || list === null ? [] : Array.prototype.slice.call(list);
  };

  /**
   * Every V8 frame in a stack, in the order the runtime wrote them, up to `limit`. Nothing is filtered
   * here: a frame with no URL (native code) is dropped, and that is all. Which frame the element lives
   * in is decided by the host, which can read the module's text and recognise a dependency by its
   * mapped path; a guest-side `/node_modules/` filter looks right and is not — the pre-bundled form
   * (`/@fs/…/deps/react_jsx-dev-runtime.js`) carries no such segment.
   */
  const stackFrames = (
    stack: string,
    limit: number,
  ): { fn: string | null; url: string; line: number; column: number }[] => {
    const frames: { fn: string | null; url: string; line: number; column: number }[] = [];
    if (limit <= 0) return frames;
    for (const line of String(stack).split("\n")) {
      if (frames.length >= limit) break;
      const match = line.match(FRAME);
      if (match === null) continue;
      const url = match[2] ?? "";
      if (url === "") continue;
      frames.push({ fn: match[1] || null, url, line: Number(match[3]), column: Number(match[4]) });
    }
    return frames;
  };

  /** Every `jsxDEV(...)` call in a component's text, with its span and its props text. */
  const jsxCalls = (
    fnText: string,
  ): { start: number; target: string | null; propsText: string }[] => {
    const calls: { start: number; target: string | null; propsText: string }[] = [];
    const isOpen = (c: string): boolean => c === "(" || c === "[" || c === "{";
    const isClose = (c: string): boolean => c === ")" || c === "]" || c === "}";
    // Walk forward from `from` to the character that closes the group opened before it, ignoring
    // brackets inside string literals.
    const closeOf = (text: string, from: number): number => {
      let depth = 0;
      let quote: string | null = null;
      for (let i = from; i < text.length; i += 1) {
        const c = text[i] ?? "";
        if (quote !== null) {
          if (c === "\\") i += 1;
          else if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (isOpen(c)) depth += 1;
        else if (isClose(c)) {
          depth -= 1;
          if (depth === 0) return i;
        }
      }
      return text.length;
    };
    let i = 0;
    while ((i = fnText.indexOf("jsxDEV(", i)) !== -1) {
      const open = i + "jsxDEV".length;
      const end = closeOf(fnText, open);
      const inner = fnText.slice(open + 1, end);
      const head = inner.match(/^\s*("([^"]+)"|'([^']+)'|([A-Za-z_$][\w$.]*))/);
      const target = head === null ? null : (head[2] ?? head[3] ?? head[4] ?? null);
      const comma = inner.indexOf(",");
      const propsText = comma === -1 ? "" : inner.slice(comma + 1, closeOf(inner, comma + 1) + 1);
      calls.push({ start: i, target, propsText });
      i = open + 1; // Continue inside the call: nested elements are calls too.
    }
    return calls;
  };

  // ---------------------------------------------------------------- React (18 and 19)
  let fiberKey: string | null = null;
  for (const key of Object.keys(el)) {
    if (key.indexOf("__reactFiber$") === 0 || key.indexOf("__reactInternalInstance$") === 0) {
      fiberKey = key;
      break;
    }
  }
  if (fiberKey !== null) {
    const fiber = (el as unknown as Record<string, FiberLike | null>)[fiberKey];
    // **Only this element's own fiber's stack counts**, and the chain is not searched for one.
    // `_debugStack` is captured where the element was created, so the picked node's own fiber carries
    // the JSX call that wrote *this* element; an ancestor fiber's stack carries the call that created
    // *the ancestor* — the JSX factory in a component is the ancestor's own element. Where the two
    // differ, taking the ancestor is a lie that looks like an answer: measured in M3.3, the `<h1>`
    // react-markdown builds has its own stack (React's development jsx runtime, which Vite serves, does
    // capture one), but an element created by a runtime that does not would have sent us up to the
    // user's component and reported **the line that uses the library** as `exact` — the guess §6 rule 2
    // forbids. With the element's own stack absent, the honest answers below are "React 18 route" (no
    // stack anywhere) or "no location".
    const raw =
      fiber === null || fiber === undefined
        ? null
        : typeof fiber._debugStack === "string"
          ? fiber._debugStack
          : fiber._debugStack !== null &&
              fiber._debugStack !== undefined &&
              typeof fiber._debugStack.stack === "string"
            ? fiber._debugStack.stack
            : null;
    if (raw !== null) {
      // Hand the whole stack over, in order: React 19's `_debugStack` starts at React's own `jsxDEV`
      // and reaches the user's component a frame or two later, and only the host can tell which one
      // that is.
      const frames = stackFrames(raw, 10);
      if (frames.length > 0) return { via: "frames", frames };
    }
    // This element's own fiber has no stack (React 18): locate it inside its component's text.
    // The chain *is* walked here, and for a different question: which component rendered this DOM
    // node — the nearest function component above it — whose compiled text holds the JSX call.
    let moduleHint: string | null = null;
    for (
      let f: FiberLike | null = fiber ?? null, depth = 0;
      f !== null && depth < 60;
      f = f.return ?? null, depth += 1
    ) {
      if (moduleHint === null && f._debugSource !== null && f._debugSource !== undefined) {
        const fileName = f._debugSource.fileName;
        if (typeof fileName === "string") moduleHint = fileName;
      }
      if (f.tag !== 0 || typeof f.type !== "function") continue;
      const component = (f.type as { name?: string }).name ?? null;
      const fnText = Function.prototype.toString.call(f.type);
      const tag = String(el.tagName ?? "").toLowerCase();
      let candidates = jsxCalls(fnText).filter((call) => call.target === tag);
      const classes = classListOf(el);
      if (candidates.length > 1 && classes.length > 0) {
        // A class is a token inside the props text, not a quoted string on its own: `className:
        // "row body"` holds two of them, and comparing whole quoted values finds neither.
        const tokensOf = (propsText: string): string[] => propsText.split(/[^A-Za-z0-9_-]+/);
        const byClass = candidates.filter((call) => {
          const tokens = tokensOf(call.propsText);
          return classes.some((name) => tokens.indexOf(name) !== -1);
        });
        if (byClass.length > 0) candidates = byClass;
      }
      const first = candidates[0];
      if (first === undefined) return null;
      return {
        via: "component-text",
        component,
        fnText,
        offset: first.start,
        moduleHint,
        candidates: candidates.length,
      };
    }
  }

  // ---------------------------------------------------------------------------- Svelte 5
  // `loc` is dev-mode only and in the compiler's own base (1-based line, 0-based column — the column
  // is the one the host has to convert, and the only reason this evidence is not already a payload).
  const svelte = el.__svelte_meta;
  if (
    svelte !== null &&
    svelte !== undefined &&
    svelte.loc !== undefined &&
    typeof svelte.loc.file === "string"
  ) {
    return {
      via: "source-loc",
      file: svelte.loc.file,
      line: typeof svelte.loc.line === "number" ? svelte.loc.line : 0,
      column: typeof svelte.loc.column === "number" ? svelte.loc.column : 0,
    };
  }

  // ------------------------------------------------------------------------------ Vue 3
  const vue = el.__vueParentComponent;
  if (
    vue !== null &&
    vue !== undefined &&
    vue.type !== undefined &&
    typeof vue.type.__file === "string"
  ) {
    return { via: "file-only", file: vue.type.__file, component: vue.type.name ?? null };
  }

  return null;
}

/** The sniffer as the guest receives it: the function's own text, which is all it may depend on. */
export function sniffScript(): string {
  return sniffOrigin.toString();
}
