/**
 * The host-side resolution pipeline (`features/workbench/source-resolution.ts`): origin evidence in,
 * the payload's `source` half out.
 *
 * The maps here are small and hand-written, and the module texts are strings, because what is under
 * test is the *decisions*: which evidence resolves at all, when a location is `exact`, and — the one
 * that matters most — when it must be `none` or `ambiguous` instead of a plausible-looking line. The
 * real maps (Vite's own, in a running page) are exercised on a machine in the M3 acceptance.
 */
import { describe, expect, it } from "vitest";
import {
  createModuleReader,
  isReactRuntime,
  moduleUrlOf,
  positionOf,
  projectRelative,
  resolveSource,
  sourcePathOf,
} from "../src/features/workbench/source-resolution";
import type { ResolveContext } from "../src/features/workbench/source-resolution";

/** A module as a dev server serves it: some code, then the inline map. */
function moduleWith(
  code: string,
  map: { sources: string[]; sourcesContent?: string[]; mappings: string },
): string {
  const encoded = Buffer.from(JSON.stringify({ version: 3, ...map }), "utf8").toString("base64");
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${encoded}`;
}

const APP_JSX = 'export function Card() {\n  return jsxDEV("section", { className: "card" });\n}\n';

const context = (modules: Record<string, string>): ResolveContext => ({
  pageUrl: "http://127.0.0.1:5199/",
  projectRoot: "/home/u/proj",
  fetchText: async (url) => modules[url] ?? null,
});

describe("resolveSource", () => {
  it("maps a generated position through the module's inline map", () => {
    // `;;IACS` — line 3 of the module, generated column 4, points at the source's line 2, column 9.
    const text = moduleWith("a\nb\nc", {
      sources: ["/src/Card.jsx"],
      sourcesContent: [APP_JSX],
      mappings: ";;IACS",
    });
    return expect(
      resolveSource(
        {
          via: "frames",
          frames: [{ url: "http://127.0.0.1:5199/src/Card.jsx", line: 3, column: 5, fn: "Card" }],
        },
        context({ "http://127.0.0.1:5199/src/Card.jsx": text }),
      ),
    ).resolves.toEqual({
      file: "src/Card.jsx",
      line: 2,
      column: 10,
      component: "Card",
      confidence: "exact",
      jsxSnippet: 'return jsxDEV("section", { className: "card" });',
    });
  });

  it("steps over React's own runtime and reports the element's creator", () => {
    // The measured shape (M3): React 19.2 puts its own `jsxDEV` first, and the pre-bundled module it
    // lives in is served from `/@fs/…/deps/…` — no `node_modules` in the URL at all, so the served
    // name is what says React. Frame two is the component that wrote the element: that is the creator,
    // and the renderer's frames below it are none of our business.
    const depUrl = "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react_jsx-dev-runtime.js";
    const rendererUrl = "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react-dom_client.js";
    const userUrl = "http://127.0.0.1:5199/src/Badge.jsx";
    return expect(
      resolveSource(
        {
          via: "frames",
          frames: [
            { url: depUrl, line: 1, column: 1, fn: "exports.jsxDEV" },
            { url: userUrl, line: 3, column: 5, fn: "Badge" },
            { url: rendererUrl, line: 6, column: 9, fn: "react_stack_bottom_frame" },
          ],
        },
        context({
          // Both React modules are readable and mappable — and neither is fetched, because the served
          // name already answered. `fetchText` records what it was asked for, so this is asserted below.
          [depUrl]: moduleWith("x", {
            sources: [
              "/tmp/vite-cache/node_modules/react/cjs/react-jsx-dev-runtime.development.js",
            ],
            mappings: "AAAA",
          }),
          [rendererUrl]: moduleWith("x", {
            sources: ["/tmp/vite-cache/node_modules/react-dom/cjs/react-dom-client.development.js"],
            mappings: "AAAA",
          }),
          [userUrl]: moduleWith("a\nb\nc", {
            sources: ["/src/Badge.jsx"],
            sourcesContent: [APP_JSX],
            mappings: ";;IACS",
          }),
        }),
      ),
    ).resolves.toEqual({
      file: "src/Badge.jsx",
      line: 2,
      column: 10,
      component: "Badge",
      confidence: "exact",
      jsxSnippet: 'return jsxDEV("section", { className: "card" });',
    });
  });

  it("never asks the dev server for React's own runtime", async () => {
    // The cheap pass is not just an optimisation: reading and mapping React's innards on every pick
    // would be work for an answer that is thrown away.
    const asked: string[] = [];
    await resolveSource(
      {
        via: "frames",
        frames: [
          {
            url: "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react_jsx-dev-runtime.js",
            line: 1,
            column: 1,
            fn: "exports.jsxDEV",
          },
          {
            url: "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react.js",
            line: 1,
            column: 1,
            fn: "x",
          },
          { url: "http://127.0.0.1:5199/src/Badge.jsx", line: 1, column: 1, fn: "Badge" },
        ],
      },
      {
        pageUrl: "http://127.0.0.1:5199/",
        projectRoot: "/home/u/proj",
        fetchText: async (url) => {
          asked.push(url);
          return url.includes("Badge")
            ? moduleWith("a", { sources: ["/src/Badge.jsx"], mappings: "AAAA" })
            : null;
        },
      },
    );
    expect(asked).toEqual(["http://127.0.0.1:5199/src/Badge.jsx"]);
  });

  it("reports a library's own module and flags it when the creator is a dependency", () => {
    // The element is an `<h1>` produced inside react-markdown. The stack is React's own frame, then
    // react-markdown's, then the user's line that *uses* the library. The honest answer is the
    // library's module plus `moduleIsThirdParty` — the PRD's point is to send an Agent to "传参 or
    // 包一层", not to tell it the element is written on the line that renders `<ReactMarkdown>`.
    const reactUrl = "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react_jsx-dev-runtime.js";
    const libUrl = "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react-markdown.js";
    const userUrl = "http://127.0.0.1:5199/src/App.jsx";
    return expect(
      resolveSource(
        {
          via: "frames",
          frames: [
            { url: reactUrl, line: 247, column: 30, fn: "exports.jsxDEV" },
            { url: libUrl, line: 5, column: 5, fn: "h" },
            { url: userUrl, line: 7, column: 7, fn: "App" },
          ],
        },
        context({
          // `;;;;AAAA` — the module has five generated lines and the mapping asked about is on the
          // fifth (the frame's line), pointing at the library source's first line.
          [libUrl]: moduleWith("a\nb\nc\nd\ne", {
            sources: ["/tmp/vite-cache/node_modules/react-markdown/lib/index.js"],
            sourcesContent: ["import { jsx } from 'react/jsx-runtime';\nexport function h() {}"],
            mappings: ";;;;AAAA",
          }),
          [userUrl]: moduleWith("a", { sources: ["/src/App.jsx"], mappings: "AAAA" }),
        }),
      ),
    ).resolves.toEqual({
      file: "tmp/vite-cache/node_modules/react-markdown/lib/index.js",
      line: 1,
      column: 1,
      component: "h",
      confidence: "exact",
      moduleIsThirdParty: true,
      jsxSnippet: "import { jsx } from 'react/jsx-runtime';",
    });
  });

  it("reads the side-car map a pre-bundled dependency names", async () => {
    // Measured in M3.3 on Vite 7: the small pre-bundled chunks are served with their map **inlined**,
    // and the large ones — the `deps/react-markdown.js` a library-created element is reported from —
    // name a `.map` **beside** them. Both forms have to be read, or an element inside a dependency
    // answers "no location" while the map that would locate it sits one request away.
    const chunkUrl = "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/chunk-4S5VGXK3.js";
    const chunkMapUrl = "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/chunk-4S5VGXK3.js.map";
    const libUrl = "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react-markdown.js";
    const libMapUrl = "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react-markdown.js.map";
    const source = await resolveSource(
      {
        via: "frames",
        frames: [
          // React's own `jsx`, in a shared chunk whose *name* says nothing about React (`chunk-4S5VGXK3`
          // was its measured name) — the map is what gives it away, which is why the runtime check runs
          // a second time, after mapping.
          { url: chunkUrl, line: 3, column: 5, fn: "exports.jsx" },
          { url: libUrl, line: 3, column: 5, fn: "create" },
        ],
      },
      context({
        [chunkUrl]: "a\nb\nc\n//# sourceMappingURL=chunk-4S5VGXK3.js.map",
        [chunkMapUrl]: JSON.stringify({
          version: 3,
          sources: ["../../../tmp/node_modules/react/cjs/react-jsx-runtime.development.js"],
          mappings: ";;IACS",
        }),
        [libUrl]: "a\nb\nc\n//# sourceMappingURL=react-markdown.js.map",
        [libMapUrl]: JSON.stringify({
          version: 3,
          sources: ["/home/u/proj/node_modules/react-markdown/lib/index.js"],
          mappings: ";;IACS",
        }),
      }),
    );
    expect(source).toEqual({
      file: "node_modules/react-markdown/lib/index.js",
      line: 2,
      column: 10,
      component: "create",
      confidence: "exact",
      moduleIsThirdParty: true,
    });
  });

  it("answers none when the side-car map it names cannot be read", () => {
    // A `.map` that 404s is no map: the answer stays `none` with the creator's name, rather than a
    // location worked out from anything else.
    const libUrl = "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react-markdown.js";
    return expect(
      resolveSource(
        { via: "frames", frames: [{ url: libUrl, line: 3, column: 5, fn: "create" }] },
        context({ [libUrl]: "a\nb\nc\n//# sourceMappingURL=react-markdown.js.map" }),
      ),
    ).resolves.toEqual({ confidence: "none", component: "create" });
  });

  it("keeps the creator's name when its module cannot be read", () => {
    // An outer frame belongs to a different component, so it is not a fallback: a location from the
    // parent's component would be a plausible-looking wrong line. The name still travels.
    return expect(
      resolveSource(
        {
          via: "frames",
          frames: [
            { url: "http://127.0.0.1:5199/src/gone.jsx", line: 1, column: 1, fn: "Gone" },
            { url: "http://127.0.0.1:5199/src/Badge.jsx", line: 1, column: 1, fn: "Badge" },
          ],
        },
        context({
          "http://127.0.0.1:5199/src/Badge.jsx": moduleWith("a", {
            sources: ["/src/Badge.jsx"],
            mappings: "AAAA",
          }),
        }),
      ),
    ).resolves.toEqual({ confidence: "none", component: "Gone" });
  });

  it("answers third-party when the stack holds nothing but React's own runtime", () => {
    const depUrl = "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react-dom_client.js";
    return expect(
      resolveSource(
        {
          via: "frames",
          frames: [
            {
              url: "http://127.0.0.1:5199/node_modules/.vite/deps/react.js",
              line: 1,
              column: 1,
              fn: "x",
            },
            { url: depUrl, line: 1, column: 1, fn: "react_stack_bottom_frame" },
          ],
        },
        context({
          [depUrl]: moduleWith("x", {
            sources: ["/tmp/vite-cache/node_modules/react-dom/cjs/react-dom-client.development.js"],
            mappings: "AAAA",
          }),
        }),
      ),
    ).resolves.toEqual({ confidence: "none", moduleIsThirdParty: true });
  });

  it("resolves a map's relative source against the module it was served in", () => {
    // Vite writes `Badge.jsx` in the map inside `/src/Badge.jsx`. Read as a project path that loses
    // `src/`, and the panel then shows a file that does not exist — which is exactly what the M3
    // acceptance caught against the M1 truth table (`src/Badge.jsx:2:10`).
    const text = moduleWith("a\nb\nc", {
      sources: ["Badge.jsx"],
      sourcesContent: [APP_JSX],
      mappings: ";;IACS",
    });
    return expect(
      resolveSource(
        {
          via: "frames",
          frames: [{ url: "http://127.0.0.1:5199/src/Badge.jsx", line: 3, column: 5, fn: "Badge" }],
        },
        context({ "http://127.0.0.1:5199/src/Badge.jsx": text }),
      ),
    ).resolves.toMatchObject({
      file: "src/Badge.jsx",
      line: 2,
      column: 10,
      confidence: "exact",
      jsxSnippet: 'return jsxDEV("section", { className: "card" });',
    });
  });

  it("says none rather than reach for a neighbouring line", () => {
    const text = moduleWith("a\nb\nc", { sources: ["/src/Card.jsx"], mappings: ";;IACS" });
    // Generated line 1 has no mapping of its own; the honest answer is "nothing".
    return expect(
      resolveSource(
        {
          via: "frames",
          frames: [{ url: "http://127.0.0.1:5199/src/Card.jsx", line: 1, column: 1, fn: null }],
        },
        context({ "http://127.0.0.1:5199/src/Card.jsx": text }),
      ),
    ).resolves.toEqual({ confidence: "none" });
  });

  it("says none for a module with no inline map at all — a production build", () => {
    // The component name still travels: "which component rendered it" is known even when "where in
    // the source" is not, and an Agent can use the former.
    return expect(
      resolveSource(
        {
          via: "frames",
          frames: [
            { url: "http://127.0.0.1:5199/assets/index-abc.js", line: 1, column: 1, fn: "Card" },
          ],
        },
        context({ "http://127.0.0.1:5199/assets/index-abc.js": "minified()" }),
      ),
    ).resolves.toEqual({ confidence: "none", component: "Card" });
  });

  it("flags a dependency instead of pointing the Agent at code nobody can edit", () => {
    return expect(
      resolveSource(
        {
          via: "frames",
          frames: [
            {
              url: "http://127.0.0.1:5199/node_modules/.vite/deps/react-dom_client.js",
              line: 10,
              column: 2,
              fn: null,
            },
          ],
        },
        context({}),
      ),
    ).resolves.toEqual({ confidence: "none", moduleIsThirdParty: true });
  });

  it("maps React 18's offset inside a component's text", () => {
    const code = `function Badge() {\n  return jsxDEV("span", { className: "badge" }, void 0, false);\n}`;
    const text = moduleWith(code, { sources: ["/src/Badge.jsx"], mappings: ";AAAA" });
    const fnText = `function Badge() {\n  return jsxDEV("span", { className: "badge" }, void 0, false);\n}`;
    return expect(
      resolveSource(
        {
          via: "component-text",
          component: "Badge",
          fnText,
          offset: fnText.indexOf("jsxDEV("),
          moduleHint: "/home/u/proj/src/Badge.jsx",
          candidates: 1,
        },
        context({ "http://127.0.0.1:5199/@fs/home/u/proj/src/Badge.jsx": text }),
      ),
    ).resolves.toEqual({
      file: "src/Badge.jsx",
      line: 1,
      column: 1,
      component: "Badge",
      confidence: "exact",
      candidates: 1,
    });
  });

  it("never calls a map() sibling exact", () => {
    const code = `function List() {\n  return jsxDEV("li", { className: "item" }, void 0, false);\n}`;
    const text = moduleWith(code, { sources: ["/src/List.jsx"], mappings: ";AAAA" });
    return expect(
      resolveSource(
        {
          via: "component-text",
          component: "List",
          fnText: `function List() {\n  return jsxDEV("li", { className: "item" }, void 0, false);\n}`,
          offset: 38,
          moduleHint: "/home/u/proj/src/List.jsx",
          candidates: 3,
        },
        context({ "http://127.0.0.1:5199/@fs/home/u/proj/src/List.jsx": text }),
      ),
    ).resolves.toMatchObject({ confidence: "ambiguous", candidates: 3, file: "src/List.jsx" });
  });

  it("finds the module by its text when the framework named none", () => {
    const fnText = `function Badge() {\n  return jsxDEV("span", {}, void 0, false);\n}`;
    const text = moduleWith(fnText, { sources: ["/src/Badge.jsx"], mappings: ";AAAA" });
    return expect(
      resolveSource(
        {
          via: "component-text",
          component: "Badge",
          fnText,
          offset: 30,
          moduleHint: null,
          candidates: 1,
        },
        {
          ...context({ "http://127.0.0.1:5199/src/Badge.jsx": text }),
          moduleUrls: [
            "http://127.0.0.1:5199/src/other.jsx",
            "http://127.0.0.1:5199/src/Badge.jsx",
          ],
        },
      ),
    ).resolves.toMatchObject({ file: "src/Badge.jsx", confidence: "exact" });
  });

  it("takes Svelte's own line as it stands but moves its column onto the payload's base", () => {
    // Svelte reports `loc.column` from zero (the compiler's own base); a payload's column counts from
    // one, like every other route's. Measured in M3.4 against the M1 truth table: `src/Badge.svelte`
    // came out `5:0` where the fixture's `<span class="badge">` is at `5:1`.
    return expect(
      resolveSource(
        { via: "source-loc", file: "/home/u/proj/src/Badge.svelte", line: 5, column: 0 },
        context({}),
      ),
    ).resolves.toEqual({ file: "src/Badge.svelte", line: 5, column: 1, confidence: "exact" });
  });

  it("reports Vue as file-only, which is all Vue tells us", () => {
    return expect(
      resolveSource(
        { via: "file-only", file: "/home/u/proj/src/Badge.vue", component: "Badge" },
        context({}),
      ),
    ).resolves.toEqual({ file: "src/Badge.vue", component: "Badge", confidence: "file-only" });
  });

  it("says none when the page's framework said nothing", () => {
    return expect(resolveSource(null, context({}))).resolves.toEqual({ confidence: "none" });
  });
});

describe("the pieces the resolution is built from", () => {
  it("turns a module hint into something fetchable, keeping an absolute URL as it is", () => {
    expect(moduleUrlOf("/home/u/proj/src/Badge.jsx", "http://127.0.0.1:5199/")).toBe(
      "http://127.0.0.1:5199/@fs/home/u/proj/src/Badge.jsx",
    );
    expect(moduleUrlOf("http://127.0.0.1:5199/src/Badge.jsx", "http://127.0.0.1:5199/")).toBe(
      "http://127.0.0.1:5199/src/Badge.jsx",
    );
  });

  it("makes a source path relative to the project, however it arrived", () => {
    expect(projectRelative("/src/Badge.jsx", "/home/u/proj")).toBe("src/Badge.jsx");
    expect(projectRelative("/home/u/proj/src/Badge.jsx", "/home/u/proj")).toBe("src/Badge.jsx");
    expect(projectRelative("/home/u/proj/src/Badge.jsx", "/home/u/proj/")).toBe("src/Badge.jsx");
    expect(
      projectRelative("http://127.0.0.1:5199/@fs/home/u/proj/src/Badge.jsx", "/home/u/proj"),
    ).toBe("src/Badge.jsx");
  });

  it("counts lines and columns the way the map does", () => {
    expect(positionOf("a\nbb\nccc", 0)).toEqual({ line: 1, column: 0 });
    expect(positionOf("a\nbb\nccc", 2)).toEqual({ line: 2, column: 0 });
    expect(positionOf("a\nbb\nccc", 4)).toEqual({ line: 2, column: 2 });
  });

  it("reads a map's source against the module, and leaves an absolute one alone", () => {
    const moduleUrl = "http://127.0.0.1:5199/src/Badge.jsx";
    expect(sourcePathOf("Badge.jsx", moduleUrl)).toBe(moduleUrl);
    expect(sourcePathOf("../lib/tokens.css", moduleUrl)).toBe(
      "http://127.0.0.1:5199/lib/tokens.css",
    );
    expect(sourcePathOf("/src/Badge.jsx", moduleUrl)).toBe("/src/Badge.jsx");
    expect(sourcePathOf("webpack://app/./src/Badge.jsx", moduleUrl)).toBe(
      "webpack://app/./src/Badge.jsx",
    );
  });

  it("recognises React's own runtime in both shapes a dev server serves it in", () => {
    const reactRuntime = [
      // Vite's pre-bundled form: no `node_modules` anywhere, so the name is the only clue.
      "http://127.0.0.1:5199/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=b4cab81c",
      "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react-dom_client.js?v=5d6c340c",
      "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react.js",
      // …and the package served as a package.
      "http://127.0.0.1:5199/node_modules/react/jsx-runtime.js",
    ];
    for (const url of reactRuntime) {
      expect(isReactRuntime(url, null), url).toBe(true);
    }
    // The map is the second chance: an unrecognisable pre-bundle name, a path that says React.
    expect(
      isReactRuntime(
        "http://d/@fs/tmp/cache/deps/chunk-ABC.js",
        "/tmp/cache/node_modules/react/cjs/react-jsx-dev-runtime.development.js",
      ),
    ).toBe(true);
    expect(
      isReactRuntime(
        "http://d/x.js",
        "/p/node_modules/react-dom/cjs/react-dom-client.development.js",
      ),
    ).toBe(true);
    // And it must not swallow a dependency the user renders, nor the user's own files.
    const notReactRuntime: [string, string | null][] = [
      ["http://d/deps/react-markdown.js", null],
      ["http://d/deps/react-router.js", null],
      ["http://d/src/react.jsx", null],
      ["http://d/src/App.jsx", "/home/u/proj/src/App.jsx"],
      ["http://d/src/react/Button.jsx", "/home/u/proj/src/react/Button.jsx"],
    ];
    for (const [url, mapped] of notReactRuntime) {
      expect(isReactRuntime(url, mapped), `${url} ${mapped ?? ""}`).toBe(false);
    }
  });
});

describe("createModuleReader", () => {
  it("reads a module once and remembers what it read, failure included", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      if (String(url).includes("missing")) return { ok: false, text: async () => "" } as Response;
      return { ok: true, text: async () => "module text" } as Response;
    }) as typeof fetch;
    try {
      const read = createModuleReader();
      await expect(read("http://d/a.js")).resolves.toBe("module text");
      await expect(read("http://d/a.js")).resolves.toBe("module text");
      await expect(read("http://d/missing.js")).resolves.toBeNull();
      await expect(read("http://d/missing.js")).resolves.toBeNull();
      expect(calls).toEqual(["http://d/a.js", "http://d/missing.js"]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
