/**
 * Carrying the app's appearance into a workbench's page: what is read from the app's own
 * document, and what is stamped on the frame's.
 */
import { describe, expect, it } from "vitest";
import { TOKEN_NAMES } from "@prismshadow/penguin-ui";
import {
  applyWorkbenchTheme,
  collectFontFaces,
  readAppTheme,
  readDocumentTheme,
  WORKBENCH_FONTS_ATTR,
  WORKBENCH_THEME_HREF,
  WORKBENCH_THEME_VARS,
  type WorkbenchTheme,
} from "../src/lib/workbench-theme";

const appRoot = (classes: string[], fontSize: string, attrs: Record<string, string> = {}) => ({
  classList: { contains: (t: string) => classes.includes(t) },
  style: { fontSize },
  getAttribute: (name: string) => attrs[name] ?? null,
});

describe("workbench theme", () => {
  it("copies the whole token contract, and the names pages read before it", () => {
    expect(TOKEN_NAMES.filter((name) => !WORKBENCH_THEME_VARS.includes(name))).toEqual([]);
    expect(WORKBENCH_THEME_VARS).toContain("--font-app-sans");
    expect(WORKBENCH_THEME_VARS).toContain("--color-gray-500");
  });

  it("reads the resolved appearance rather than recomputing it", () => {
    const values: Record<string, string> = {
      "--ui-accent": " #e32a01 ",
      "--color-gray-950": "#000",
      "--ui-fg": "",
    };
    const root = appRoot(["dark"], "16px", {
      "data-theme": "geek",
      "data-accent": "orange",
      "data-font-cjk": "misans",
    });
    const theme = readAppTheme(root, (p) => values[p] ?? "", "@font-face{}");
    expect(theme.dark).toBe(true);
    expect(theme.fontSize).toBe("16px");
    // Trimmed, and a property the app does not define is not stamped as an empty value.
    expect(theme.vars).toEqual({ "--ui-accent": "#e32a01", "--color-gray-950": "#000" });
    expect(theme.attrs).toEqual({
      "data-theme": "geek",
      "data-accent": "orange",
      "data-font-cjk": "misans",
    });
    expect(theme.fontFaces).toBe("@font-face{}");
  });

  it("names the theme the app leaves implicit, and only an accent the theme paints", () => {
    // Primer is the app root without data-theme; blue is one of its presets, orange is not.
    expect(readAppTheme(appRoot([], "16px", { "data-accent": "blue" }), () => "").attrs).toEqual({
      "data-theme": "github",
      "data-accent": "blue",
    });
    expect(readAppTheme(appRoot([], "16px", { "data-accent": "orange" }), () => "").attrs).toEqual({
      "data-theme": "github",
    });
    expect(readAppTheme(appRoot([], "14px"), () => "").dark).toBe(false);
  });

  it("resolves the app's styles once per appearance", () => {
    const classes: string[] = [];
    let resolutions = 0;
    const doc = {
      documentElement: appRoot(classes, "16px"),
      defaultView: {
        getComputedStyle: () => {
          resolutions++;
          return { getPropertyValue: (p: string) => (p === "--ui-fg" ? "#111" : "") };
        },
      },
      styleSheets: [],
      baseURI: "http://app.test/",
    } as unknown as Document;
    const first = readDocumentTheme(doc);
    expect(readDocumentTheme(doc)).toBe(first);
    expect(resolutions).toBe(1);
    classes.push("dark");
    const dark = readDocumentTheme(doc);
    expect(dark).not.toBe(first);
    expect(dark.dark).toBe(true);
    expect(resolutions).toBe(2);
  });

  it("stamps classes, attributes, tokens, fonts and the stylesheet, and repeats nothing", () => {
    const doc = fakeDocument();
    const theme: WorkbenchTheme = {
      dark: true,
      fontSize: "16px",
      attrs: { "data-theme": "modern", "data-accent": "forest" },
      vars: { "--ui-accent": "#006838", "--ui-fg": "#e8e8e8" },
      fontFaces: '@font-face { font-family: "MiSans"; }',
    };
    applyWorkbenchTheme(doc.document, theme);
    applyWorkbenchTheme(doc.document, theme);
    expect(doc.classes).toEqual({ dark: true, light: false });
    expect(doc.attributes).toEqual(theme.attrs);
    expect(doc.properties).toEqual(theme.vars);
    expect(doc.root.style.fontSize).toBe("16px");
    expect(doc.head.map((el) => el.tag)).toEqual(["link", "style"]);
    expect(doc.head[0]).toMatchObject({ rel: "stylesheet", href: WORKBENCH_THEME_HREF });
    expect(doc.head[1]!.attrs).toHaveProperty(WORKBENCH_FONTS_ATTR);
    expect(doc.head[1]!.textContent).toBe(theme.fontFaces);
    expect(doc.writes).toEqual({ properties: 2, fonts: 1 });

    // The neutral accent drops the attribute, a token that changed is rewritten and one that is
    // gone is removed; the fonts, unchanged, are left alone.
    applyWorkbenchTheme(doc.document, {
      ...theme,
      dark: false,
      attrs: { "data-theme": "modern" },
      vars: { "--ui-accent": "#232527" },
    });
    expect(doc.classes).toEqual({ dark: false, light: true });
    expect(doc.attributes).toEqual({ "data-theme": "modern" });
    expect(doc.properties).toEqual({ "--ui-accent": "#232527" });
    expect(doc.head).toHaveLength(2);
    expect(doc.writes).toEqual({ properties: 3, fonts: 1 });
  });

  it("collects the app's font faces with absolute URLs", () => {
    const face = (src: string) => ({
      type: 5,
      cssText: `@font-face { font-family: "X"; src: url(${src}) format("woff2"); }`,
    });
    const css = collectFontFaces(
      [
        {
          href: "http://app.test/assets/index.css",
          cssRules: [
            { type: 1, cssText: "body { color: red; }" },
            face('"./misans-400-5.woff2"'),
            { type: 0, cssText: "@layer fonts { }", cssRules: [face("/assets/mono.woff2")] },
            {
              type: 3,
              cssText: '@import "../fonts/cjk.css";',
              styleSheet: { href: "http://app.test/fonts/cjk.css", cssRules: [face("noto.woff2")] },
            },
          ],
        },
        { href: null, cssRules: [face('"data:font/woff2;base64,AAAA"')] },
        {
          href: "https://elsewhere.test/a.css",
          get cssRules(): never {
            throw new Error("SecurityError");
          },
        },
      ],
      "http://app.test/projects/p/",
    );
    expect(css).not.toContain("body");
    expect(css.match(/url\("[^"]*"\)/g)).toEqual([
      'url("http://app.test/assets/misans-400-5.woff2")',
      'url("http://app.test/assets/mono.woff2")',
      'url("http://app.test/fonts/noto.woff2")',
      'url("data:font/woff2;base64,AAAA")',
    ]);
  });
});

class FakeElement {
  rel = "";
  href = "";
  readonly attrs: Record<string, string> = {};
  private text = "";
  constructor(
    readonly tag: string,
    private readonly onWrite: () => void,
  ) {}
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  get textContent() {
    return this.text;
  }
  set textContent(value: string) {
    this.onWrite();
    this.text = value;
  }
}

/** The few DOM operations applyWorkbenchTheme performs, recorded. */
function fakeDocument() {
  const classes: Record<string, boolean> = {};
  const attributes: Record<string, string> = {};
  const properties: Record<string, string> = {};
  const writes = { properties: 0, fonts: 0 };
  const head: FakeElement[] = [];
  const root = {
    classList: { toggle: (token: string, on: boolean) => void (classes[token] = on) },
    setAttribute: (name: string, value: string) => void (attributes[name] = value),
    removeAttribute: (name: string) => void delete attributes[name],
    style: {
      fontSize: "",
      setProperty: (name: string, value: string) => {
        writes.properties++;
        properties[name] = value;
      },
      removeProperty: (name: string) => void delete properties[name],
    },
  };
  const headNode = {
    querySelector: (selector: string) =>
      head.find((el) =>
        el.tag === "link"
          ? selector.startsWith("link") && selector.includes(el.href)
          : selector.startsWith("style") && WORKBENCH_FONTS_ATTR in el.attrs,
      ) ?? null,
    prepend: (el: FakeElement) => void head.unshift(el),
  };
  const document = {
    documentElement: root,
    head: headNode,
    createElement: (tag: string) => new FakeElement(tag, () => writes.fonts++),
  } as unknown as Document;
  return { document, root, classes, attributes, properties, writes, head };
}
