/**
 * The framework sniffer (`features/workbench/framework-sniffer.ts`) — the guest-side half of the
 * precise tier.
 *
 * Two things are under test, and the second is the one that fails silently in production:
 *
 * 1. **What it reads.** Each framework's dev-time data has a shape, and the shapes were measured, not
 *    assumed (M1). The fakes below are those shapes: a React fiber chain with a `_debugStack`, a
 *    React 18 function component whose own text contains the `jsxDEV` call, Svelte's `__svelte_meta`,
 *    Vue's `__vueParentComponent.type.__file`.
 * 2. **That the serialized function works alone.** The sniffer is handed to the page with
 *    `toString()`, so a reference to this module's scope would compile, serialize and then throw in
 *    the guest. The last test evaluates the actual text to prove it does not depend on anything but
 *    its argument.
 */
import { describe, expect, it } from "vitest";
import { sniffOrigin, sniffScript } from "../src/features/workbench/framework-sniffer";

/** A React fiber chain, in the shape React 19 leaves on a host element. */
function reactElement(options: {
  stack?: string;
  fiberTag?: number;
  fiberType?: unknown;
  fileName?: string;
  returnFiber?: unknown;
}): Record<string, unknown> {
  const fiber: Record<string, unknown> = { tag: options.fiberTag ?? 5, type: "span" };
  if (options.stack !== undefined) fiber["_debugStack"] = { stack: options.stack };
  if (options.fileName !== undefined) fiber["_debugSource"] = { fileName: options.fileName };
  if (options.returnFiber !== undefined) fiber["return"] = options.returnFiber;
  if (options.fiberType !== undefined) fiber["type"] = options.fiberType;
  return {
    tagName: "SPAN",
    classList: ["badge"],
    getAttribute: (name: string) => (name === "data-testid" ? "badge" : null),
    ["__reactFiber$abc123"]: fiber,
  };
}

const REACT19_STACK = [
  "Error",
  "    at Badge (http://127.0.0.1:5199/src/Badge.jsx:18:26)",
  "    at div",
  "    at App (http://127.0.0.1:5199/src/App.jsx:7:7)",
  "    at renderWithHooks (http://127.0.0.1:5199/node_modules/.vite/deps/react-dom_client.js:1234:5)",
].join("\n");

describe("React", () => {
  it("hands the whole stack over, in order, and picks no frame itself", () => {
    // Real React 19.2 data: the stack starts inside React's own `jsxDEV`. Deciding that frame one is
    // React's own and frame two is the user's takes the module text — a guest-side `/node_modules/`
    // filter misses it, because the pre-bundled dep is served from `/@fs/…/deps/…`. So the guest
    // reports every frame it can read and the host decides (see `source-resolution.ts`).
    expect(sniffOrigin(reactElement({ stack: REACT19_STACK }))).toEqual({
      via: "frames",
      frames: [
        { url: "http://127.0.0.1:5199/src/Badge.jsx", line: 18, column: 26, fn: "Badge" },
        { url: "http://127.0.0.1:5199/src/App.jsx", line: 7, column: 7, fn: "App" },
        {
          url: "http://127.0.0.1:5199/node_modules/.vite/deps/react-dom_client.js",
          line: 1234,
          column: 5,
          fn: "renderWithHooks",
        },
      ],
    });
  });

  it("keeps an anonymous arrow-callback frame, which has no name and no parentheses", () => {
    // The frame `at http://host:5199/src/List.jsx:19:29` is what a `.map()` callback produces. A
    // pattern that assumes `name (url)` — or that stops a URL at a colon — drops it and reports an
    // outer component instead, which is exactly how this was one line wrong before it was fixed.
    const stack = [
      "Error",
      "    at http://127.0.0.1:5199/src/List.jsx:19:29",
      "    at List (http://127.0.0.1:5199/src/List.jsx:18:76)",
    ].join("\n");
    expect(sniffOrigin(reactElement({ stack }))).toMatchObject({
      via: "frames",
      frames: [
        { url: "http://127.0.0.1:5199/src/List.jsx", line: 19, column: 29, fn: null },
        { url: "http://127.0.0.1:5199/src/List.jsx", line: 18, column: 76, fn: "List" },
      ],
    });
  });

  it("stops at ten frames, so a deep stack cannot be handed over whole", () => {
    const stack = [
      "Error",
      ...Array.from(
        { length: 40 },
        (_, i) => `    at C${i} (http://127.0.0.1:5199/src/C${i}.jsx:${i + 1}:${i + 2})`,
      ),
    ].join("\n");
    const origin = sniffOrigin(reactElement({ stack })) as {
      via: string;
      frames: { url: string }[];
    };
    expect(origin.frames).toHaveLength(10);
    expect(origin.frames[0]?.url).toBe("http://127.0.0.1:5199/src/C0.jsx");
  });

  it("passes a dependency's frames through rather than dropping them silently", () => {
    // The guest cannot tell a dependency from the user's code (that is the host's job), so a stack
    // that is nothing but dependencies is reported as such — and the host answers "third party".
    const stack = [
      "Error",
      "    at x (http://127.0.0.1:5199/node_modules/.vite/deps/react.js:1:1)",
    ].join("\n");
    expect(sniffOrigin(reactElement({ stack }))).toEqual({
      via: "frames",
      frames: [
        {
          url: "http://127.0.0.1:5199/node_modules/.vite/deps/react.js",
          line: 1,
          column: 1,
          fn: "x",
        },
      ],
    });
  });

  it("answers nothing when the stack holds no frame it can read", () => {
    expect(sniffOrigin(reactElement({ stack: "Error\n    at <anonymous>" }))).toBeNull();
  });

  it("finds the element inside its component's own text when there is no stack (React 18)", () => {
    const Badge = function Badge() {
      return jsxDEV("span", { className: "badge", "data-testid": "badge" }, undefined, false);
    };
    const ownerFiber = {
      tag: 0,
      type: Badge,
      _debugSource: { fileName: "/home/u/proj/src/Badge.jsx" },
    };
    const element = reactElement({ fiberTag: 5, returnFiber: ownerFiber });
    const origin = sniffOrigin(element);
    expect(origin).toMatchObject({
      via: "component-text",
      moduleHint: "/home/u/proj/src/Badge.jsx",
      candidates: 1,
    });
    // The component's name travels as a hint only: a bundler may rename the function expression, so
    // it is present but not asserted to any particular spelling.
    expect(typeof (origin as { component?: unknown }).component).toBe("string");
    // The offset points at the `jsxDEV(` call that wrote this element, inside the component's text.
    const text = (origin as { fnText: string; offset: number }).fnText;
    const at = (origin as { offset: number }).offset;
    expect(text.slice(at, at + 13)).toBe('jsxDEV("span"');
  });

  it("does not take a stack that belongs to an ancestor fiber", () => {
    // Measured in M3.3: an element a dependency created can have no stack of its own (a runtime that
    // captures none), while the component that *uses* the dependency has one. Its frames name the
    // line that renders the library — `<Markdown>` — not the line that wrote this element, so the
    // chain is never searched for a stack: the answer is "no location", not the user's usage line.
    const render = (kind: unknown, props: unknown): unknown => [kind, props];
    const App = function App() {
      return render("Markdown", null);
    };
    const ancestor = {
      tag: 0,
      type: App,
      _debugStack: {
        stack: [
          "Error",
          "    at jsxDEV (http://127.0.0.1:5198/@fs/tmp/cache/deps/react_jsx-dev-runtime.js:218:88)",
          "    at App (http://127.0.0.1:5198/src/App.jsx:9:9)",
        ].join("\n"),
      },
    };
    const element = {
      tagName: "H1",
      classList: [],
      getAttribute: () => null,
      ["__reactFiber$abc"]: { tag: 5, type: "h1", return: ancestor },
    };
    expect(sniffOrigin(element)).toBeNull();
  });

  it("does not lose a nested call to the search that has to continue inside it", () => {
    const Card = function Card() {
      return jsxDEV("section", { className: "card" }, undefined, false, undefined, undefined, [
        jsxDEV("span", { className: "badge" }, undefined, false, undefined, undefined, undefined),
      ]);
    };
    const origin = sniffOrigin(
      reactElement({
        returnFiber: { tag: 0, type: Card, _debugSource: { fileName: "/p/src/Card.jsx" } },
      }),
    );
    // The span is nested inside the section's call; the outer call alone would not contain it.
    const typed = origin as { fnText: string; offset: number };
    expect(typed.fnText.slice(typed.offset, typed.offset + 13)).toBe('jsxDEV("span"');
  });

  it("counts the candidates, so a sibling-producing map() cannot be called exact", () => {
    const List = function List() {
      return jsxDEV("ul", { className: "list" }, undefined, false, undefined, undefined, [
        jsxDEV("li", { className: "item" }, undefined, false),
        jsxDEV("li", { className: "item" }, undefined, false),
      ]);
    };
    const element = {
      tagName: "LI",
      classList: [],
      getAttribute: () => null,
      ["__reactFiber$abc"]: { tag: 5, type: "li", return: { tag: 0, type: List } },
    };
    expect(sniffOrigin(element)).toMatchObject({ via: "component-text", candidates: 2 });
  });

  it("tells two same-tag siblings apart by their classes", () => {
    const Panel = function Panel() {
      return jsxDEV("section", { className: "panel" }, undefined, false, undefined, undefined, [
        jsxDEV("div", { className: "row head" }, undefined, false),
        jsxDEV("div", { className: "row body" }, undefined, false),
      ]);
    };
    const element = {
      tagName: "DIV",
      classList: ["body"],
      getAttribute: () => null,
      ["__reactFiber$abc"]: { tag: 5, type: "div", return: { tag: 0, type: Panel } },
    };
    const origin = sniffOrigin(element) as {
      via: string;
      candidates: number;
      fnText: string;
      offset: number;
    };
    // The component's *name* is a hint this test does not assert: a bundler is free to rename a
    // function expression, and the guest reads whatever the bundler emitted.
    expect(origin).toMatchObject({ via: "component-text", candidates: 1 });
    // The class picked the second `div`, not the first one the scan met.
    expect(origin.fnText.slice(origin.offset, origin.offset + 40)).toContain('"row body"');
  });
});

describe("Svelte and Vue", () => {
  it("takes Svelte 5's own location, which needs no mapping", () => {
    expect(
      sniffOrigin({
        tagName: "SPAN",
        __svelte_meta: { loc: { file: "src/Badge.svelte", line: 5, column: 0 } },
      }),
    ).toEqual({ via: "source-loc", file: "src/Badge.svelte", line: 5, column: 0 });
  });

  it("reports Vue's file and says so plainly, because it has no line", () => {
    expect(
      sniffOrigin({
        tagName: "SPAN",
        __vueParentComponent: { type: { __file: "/home/u/proj/src/Badge.vue", name: "Badge" } },
      }),
    ).toEqual({ via: "file-only", file: "/home/u/proj/src/Badge.vue", component: "Badge" });
  });

  it("answers nothing for an element no framework claims", () => {
    expect(sniffOrigin({ tagName: "SPAN", classList: [] })).toBeNull();
    expect(sniffOrigin(null)).toBeNull();
    expect(sniffOrigin(undefined)).toBeNull();
  });
});

describe("the sniffer the guest receives", () => {
  it("is the whole function, and nothing from this module's scope", () => {
    const script = sniffScript();
    expect(script.startsWith("function")).toBe(true);
    expect(script).not.toContain("import ");
    expect(script).not.toContain("require(");
  });

  it("actually runs on its own, on the fake a real page would present", () => {
    // Evaluating the serialized text is the only way to catch a reference that survives compilation
    // and dies in the guest. This is that check, with the same fake React 19 uses.
    const standalone = new Function(`return (${sniffScript()});`)() as (el: unknown) => unknown;
    expect(standalone(reactElement({ stack: REACT19_STACK }))).toEqual({
      via: "frames",
      frames: [
        { url: "http://127.0.0.1:5199/src/Badge.jsx", line: 18, column: 26, fn: "Badge" },
        { url: "http://127.0.0.1:5199/src/App.jsx", line: 7, column: 7, fn: "App" },
        {
          url: "http://127.0.0.1:5199/node_modules/.vite/deps/react-dom_client.js",
          line: 1234,
          column: 5,
          fn: "renderWithHooks",
        },
      ],
    });
  });
});

/** The global React 19/18 JSX runtime helper, stubbed so the fakes above compile to readable text. */
function jsxDEV(...args: unknown[]): unknown {
  return args;
}
