/**
 * Carrying the app's appearance into a workbench's page: what is read from the app's own
 * document, and what is stamped on the frame's. What is read includes the names published
 * pages read from before the token contract (the body font stack, the gray scale), and for an
 * imported theme pack the stylesheet the app's head links: its id and accent go in as the app's
 * root carries them, its link goes in after the components' stylesheet, a replace moves the link
 * to the new address, and a built-in pack takes it out.
 */
import { INITIAL_THEME_ID } from "@prismshadow/penguin-ui";
import { describe, expect, it } from "vitest";
import {
  applyWorkbenchTheme,
  collectFontFaces,
  PENGUIN_UI_ATTR,
  readAppTheme,
  readDocumentTheme,
  WORKBENCH_FONTS_ATTR,
  WORKBENCH_FRAME_ATTR,
  WORKBENCH_THEME_HREF,
  type WorkbenchTheme,
} from "../src/lib/workbench-theme";
import { THEME_PACK_ATTR } from "../src/lib/theme-pack-links";

const appRoot = (classes: string[], fontSize: string, attrs: Record<string, string> = {}) => ({
  classList: { contains: (t: string) => classes.includes(t) },
  style: { fontSize },
  getAttribute: (name: string) => attrs[name] ?? null,
});

describe("workbench theme", () => {
  it("reads the resolved appearance rather than recomputing it", () => {
    // A token of the contract, and two names published pages read from before it: the body
    // font stack and a gray of Tailwind's scale.
    const values: Record<string, string> = {
      "--ui-accent": " #e32a01 ",
      "--font-app-sans": "Inter, sans-serif",
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
    expect(theme.vars).toEqual({
      "--ui-accent": "#e32a01",
      "--font-app-sans": "Inter, sans-serif",
      "--color-gray-950": "#000",
    });
    expect(theme.attrs).toEqual({
      "data-theme": "geek",
      "data-accent": "orange",
      "data-font-cjk": "misans",
    });
    expect(theme.fontFaces).toBe("@font-face{}");
  });

  it("copies the theme and its base as the app writes them, and only an accent the theme paints", () => {
    // Primer is a pack on the foundation alone, so its root carries no base; blue is one of its
    // presets, orange is not.
    const primer = (accent: string) =>
      readAppTheme(appRoot([], "16px", { "data-theme": "github", "data-accent": accent }), () => "")
        .attrs;
    expect(primer("blue")).toEqual({ "data-theme": "github", "data-accent": "blue" });
    expect(primer("orange")).toEqual({ "data-theme": "github" });
    // Frost's recipes key on the base, so a page carrying the components' stylesheet draws them
    // only when the base comes along.
    const frost = appRoot([], "16px", { "data-theme": "modern", "data-theme-base": "modern" });
    expect(readAppTheme(frost, () => "").attrs).toEqual({
      "data-theme": "modern",
      "data-theme-base": "modern",
    });
    // A root naming no theme the build ships reads as the theme a browser starts in.
    expect(readAppTheme(appRoot([], "16px"), () => "").attrs).toEqual({
      "data-theme": INITIAL_THEME_ID,
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
      attrs: { "data-theme": "modern", "data-theme-base": "modern", "data-accent": "forest" },
      vars: { "--ui-accent": "#006838", "--ui-fg": "#e8e8e8" },
      fontFaces: '@font-face { font-family: "MiSans"; }',
    };
    applyWorkbenchTheme(doc.document, theme);
    applyWorkbenchTheme(doc.document, theme);
    expect(doc.classes).toEqual({ dark: true, light: false });
    expect(doc.attributes).toEqual({ ...theme.attrs, [WORKBENCH_FRAME_ATTR]: "" });
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
      attrs: { "data-theme": "modern", "data-theme-base": "modern" },
      vars: { "--ui-accent": "#232527" },
    });
    expect(doc.classes).toEqual({ dark: false, light: true });
    expect(doc.attributes).toEqual({
      "data-theme": "modern",
      "data-theme-base": "modern",
      [WORKBENCH_FRAME_ATTR]: "",
    });
    expect(doc.properties).toEqual({ "--ui-accent": "#232527" });
    expect(doc.head).toHaveLength(2);
    expect(doc.writes).toEqual({ properties: 3, fonts: 1 });

    // A pack on the foundation alone takes the base off the frame, as the app's root drops it.
    applyWorkbenchTheme(doc.document, { ...theme, attrs: { "data-theme": "geek" } });
    expect(doc.attributes).toEqual({ "data-theme": "geek", [WORKBENCH_FRAME_ATTR]: "" });
  });

  it("gives a page carrying the components' stylesheet no base stylesheet, and still themes it", () => {
    const doc = fakeDocument();
    const components = new FakeElement("link", () => undefined);
    components.setAttribute(PENGUIN_UI_ATTR, "");
    doc.head.push(components);
    const theme: WorkbenchTheme = {
      dark: false,
      fontSize: "15px",
      attrs: { "data-theme": "geek" },
      vars: { "--ui-accent": "#e32a01" },
      fontFaces: '@font-face { font-family: "MiSans"; }',
    };
    applyWorkbenchTheme(doc.document, theme);
    expect(doc.head.map((el) => el.tag)).toEqual(["style", "link"]);
    expect(doc.head[1]).toBe(components);
    expect(doc.head[0]!.textContent).toBe(theme.fontFaces);
    expect(doc.classes).toEqual({ dark: false, light: true });
    expect(doc.attributes).toEqual({ ...theme.attrs, [WORKBENCH_FRAME_ATTR]: "" });
    expect(doc.properties).toEqual(theme.vars);
    expect(doc.root.style.fontSize).toBe("15px");
  });

  it("marks the page see-through and gives it the app's color scheme, both ways", () => {
    // A browser paints an opaque canvas under a frame whose document's color scheme differs
    // from the frame element's, which follows the app: the page must follow the app too.
    const doc = fakeDocument();
    const theme: WorkbenchTheme = {
      dark: true,
      fontSize: "16px",
      attrs: { "data-theme": "modern" },
      vars: {},
      fontFaces: "",
    };
    applyWorkbenchTheme(doc.document, theme);
    expect(doc.attributes).toHaveProperty(WORKBENCH_FRAME_ATTR);
    expect(doc.root.style.colorScheme).toBe("dark");
    applyWorkbenchTheme(doc.document, { ...theme, dark: false });
    expect(doc.root.style.colorScheme).toBe("light");
  });

  it("carries an imported pack's id, accent and stylesheet into the frame, after the components' sheet", () => {
    const v1 = "/api/themes/paper/files/index.css?v=5e1f0c2a";
    const root = appRoot([], "16px", {
      "data-theme": "paper",
      "data-theme-base": "modern",
      "data-accent": "ink-blue",
    });
    const theme = readAppTheme(root, () => "", "", v1);
    expect(theme.attrs).toEqual({
      "data-theme": "paper",
      "data-theme-base": "modern",
      "data-accent": "ink-blue",
    });
    expect(theme.packHref).toBe(v1);
    // Without its link on the app's head, the id is not one a frame can draw.
    expect(readAppTheme(root, () => "").attrs["data-theme"]).toBe(INITIAL_THEME_ID);

    const doc = fakeDocument();
    const components = new FakeElement("link", () => undefined);
    components.setAttribute(PENGUIN_UI_ATTR, "");
    doc.head.push(components);
    applyWorkbenchTheme(doc.document, theme);
    expect(doc.head[0]).toBe(components);
    expect(doc.head[1]!.attrs).toEqual({ [THEME_PACK_ATTR]: "paper", href: v1 });

    // Replaced on the server: the same link, at the new address.
    const v2 = "/api/themes/paper/files/index.css?v=9a7b3c4d";
    applyWorkbenchTheme(doc.document, { ...theme, packHref: v2 });
    expect(doc.head).toHaveLength(2);
    expect(doc.head[1]!.attrs.href).toBe(v2);

    // A built-in pack: the pack's link leaves the frame.
    const { packHref: _gone, ...builtin } = theme;
    applyWorkbenchTheme(doc.document, { ...builtin, attrs: { "data-theme": "geek" } });
    expect(doc.head).toEqual([components]);
  });

  it("reads the pack the app's head links for its root, and reads again when a replace moves it", () => {
    const attrs: Record<string, string> = { "data-theme": "paper", "data-theme-base": "modern" };
    const link = { href: "/api/themes/paper/files/index.css?v=5e1f0c2a" };
    const doc = {
      documentElement: appRoot([], "16px", attrs),
      head: {
        querySelectorAll: () => [
          {
            getAttribute: (name: string) =>
              name === THEME_PACK_ATTR ? "paper" : name === "href" ? link.href : null,
          },
        ],
      },
      defaultView: {
        getComputedStyle: () => ({
          getPropertyValue: (p: string) => (p === "--ui-fg" ? "#2b2521" : ""),
        }),
      },
      styleSheets: [],
      baseURI: "http://app.test/",
    } as unknown as Document;
    const first = readDocumentTheme(doc);
    expect(first.attrs["data-theme"]).toBe("paper");
    expect(first.packHref).toBe(link.href);
    expect(readDocumentTheme(doc)).toBe(first);
    link.href = "/api/themes/paper/files/index.css?v=9a7b3c4d";
    expect(readDocumentTheme(doc).packHref).toBe(link.href);
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
  /** Set by the document that holds it: takes it out of the head. */
  detach: (el: FakeElement) => void = () => undefined;
  constructor(
    readonly tag: string,
    private readonly onWrite: () => void,
  ) {}
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  remove() {
    this.detach(this);
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
      colorScheme: "",
      setProperty: (name: string, value: string) => {
        writes.properties++;
        properties[name] = value;
      },
      removeProperty: (name: string) => void delete properties[name],
    },
  };
  const headNode = {
    // `tag[attr]` and `tag[attr="value"]`, the only selectors applyWorkbenchTheme uses.
    querySelector: (selector: string) => {
      const [, tag, attr, value] = /^(\w+)\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector) ?? [];
      return (
        head.find((el) => {
          if (el.tag !== tag) return false;
          const has = attr === "href" ? el.href : el.attrs[attr!];
          return value === undefined ? has !== undefined : has === value;
        }) ?? null
      );
    },
    prepend: (el: FakeElement) => void head.unshift(el),
    append: (el: FakeElement) => void head.push(el),
  };
  const detach = (el: FakeElement) => {
    const at = head.indexOf(el);
    if (at >= 0) head.splice(at, 1);
  };
  const document = {
    documentElement: root,
    head: headNode,
    createElement: (tag: string) => {
      const el = new FakeElement(tag, () => writes.fonts++);
      el.detach = detach;
      return el;
    },
  } as unknown as Document;
  return { document, root, classes, attributes, properties, writes, head };
}
