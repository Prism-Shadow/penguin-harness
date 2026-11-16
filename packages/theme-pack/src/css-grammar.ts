/**
 * The CSS a theme pack may write, as positive lists (PRFC-0026 「校验器接受的 CSS」). Whatever is
 * not named here is refused: an unknown function, pseudo-class, attribute, at-rule or node type
 * never passes through.
 *
 * The threat these lists answer: an imported stylesheet runs in the browser of everyone who picks
 * the pack, and CSS can read an attribute's value one character at a time with prefix selectors
 * (`input[value^="sk-"]`) and report each guess through a `url()` fetch. So a selector may test
 * only the attributes the markup itself sets to fixed values, with whole-value matches, and a
 * `url()` may point only into the pack.
 *
 * Beyond the RFC's first list, the additions the built-in packs are written with, none of which
 * can test a value a page holds of a person: `*`, `:lang()` (whole language subtags, which the app
 * sets on `<html>`), `^=` on `role` alone (ARIA's own enumeration: `menuitem`,
 * `menuitemcheckbox`, `menuitemradio`), and `@keyframes` named `ui-…` beside `<id>-…`
 * (stylesheet.ts).
 */

/** Element names a selector may name. */
export const TYPE_SELECTORS: ReadonlySet<string> = new Set([
  "*",
  "html",
  "body",
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "span",
  "div",
  "p",
  "li",
  "ul",
  "ol",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "code",
  "pre",
  "kbd",
  "hr",
  "img",
  "svg",
  "path",
  "polyline",
  "line",
  "rect",
  "circle",
  "text",
  "g",
]);

/** Attributes a selector may test, besides every `data-*` and `aria-*`. */
export const ATTRIBUTES: ReadonlySet<string> = new Set([
  "role",
  "type",
  "disabled",
  "open",
  "hidden",
  "lang",
  "dir",
]);

/** Pseudo-classes that take no argument. */
export const PLAIN_PSEUDO_CLASSES: ReadonlySet<string> = new Set([
  "root",
  "hover",
  "focus",
  "focus-visible",
  "focus-within",
  "active",
  "disabled",
  "checked",
  "empty",
  "placeholder-shown",
  "first-child",
  "last-child",
  "only-child",
]);

/** Pseudo-classes whose argument is a selector list, checked by the same rules. */
export const SELECTOR_PSEUDO_CLASSES: ReadonlySet<string> = new Set(["not", "is", "where", "has"]);

export const PSEUDO_ELEMENTS: ReadonlySet<string> = new Set([
  "before",
  "after",
  "placeholder",
  "selection",
  "marker",
]);

/** A language tag `:lang()` may name: subtags of letters and digits, no wildcard. */
export const LANGUAGE_TAG = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i;

/** Properties a declaration may never set, whatever their value. */
export const DENIED_PROPERTIES: ReadonlySet<string> = new Set(["behavior", "-moz-binding"]);

/** The Tailwind palette variables the theme bridges re-point (`--color-white`, `--color-gray-50` …). */
export const BRIDGE_VARIABLE = /^--color-(?:white|black|gray-(?:50|[1-9]00|950))$/;

/** A pack's own custom property: private (`--_x`), or under its id (`--<id>-x`). */
export const privateProperty = (id: string) => new RegExp(`^--(?:_|${id}-)[A-Za-z0-9_-]+$`);

/** A standard property's name: lowercase, an optional vendor prefix, no escapes. */
export const PROPERTY_NAME = /^-?[a-z][a-z0-9-]*$/;

/** Functions a value may call. `url()` is its own node and checked apart (see stylesheet.ts). */
export const FUNCTIONS: ReadonlySet<string> = new Set([
  // Variables and maths.
  "var",
  "env",
  "calc",
  "min",
  "max",
  "clamp",
  "round",
  "mod",
  "rem",
  "abs",
  "sign",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "pow",
  "sqrt",
  "hypot",
  "log",
  "exp",
  // Colour.
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "light-dark",
  // Images. A string inside image-set() is a URL and is checked as one.
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeating-conic-gradient",
  "image-set",
  "-webkit-image-set",
  // Transforms, timing and filters.
  "translate",
  "translatex",
  "translatey",
  "translatez",
  "translate3d",
  "scale",
  "scalex",
  "scaley",
  "scalez",
  "scale3d",
  "rotate",
  "rotatex",
  "rotatey",
  "rotatez",
  "rotate3d",
  "skew",
  "skewx",
  "skewy",
  "matrix",
  "matrix3d",
  "perspective",
  "cubic-bezier",
  "steps",
  "linear",
  "blur",
  "brightness",
  "contrast",
  "drop-shadow",
  "grayscale",
  "hue-rotate",
  "invert",
  "opacity",
  "saturate",
  "sepia",
  // Layout and shapes.
  "minmax",
  "repeat",
  "fit-content",
  "shape",
  "path",
  "polygon",
  "circle",
  "ellipse",
  "inset",
  "rect",
  "xywh",
  // Generated content and @font-face sources.
  "counter",
  "counters",
  "format",
  "tech",
]);

/** Functions whose string arguments name an image to fetch. */
export const IMAGE_SET_FUNCTIONS: ReadonlySet<string> = new Set(["image-set", "-webkit-image-set"]);

/** What an `@font-face` may declare. */
export const FONT_FACE_DESCRIPTORS: ReadonlySet<string> = new Set([
  "font-family",
  "src",
  "font-style",
  "font-weight",
  "font-stretch",
  "font-display",
  "unicode-range",
  "font-feature-settings",
  "font-variation-settings",
  "ascent-override",
  "descent-override",
  "line-gap-override",
  "size-adjust",
]);

/** What an `@property` may declare. */
export const PROPERTY_DESCRIPTORS: ReadonlySet<string> = new Set([
  "syntax",
  "inherits",
  "initial-value",
]);

/** At-rules that are refused, with the reason the designer reads. */
export const REFUSED_AT_RULES: Readonly<Record<string, string>> = {
  import:
    "@import is refused: a pack's files are its stylesheets, nothing is fetched from elsewhere",
  namespace: "@namespace is refused",
  layer: "@layer is refused: the server serves each file in its cascade layer itself",
  document: "@document is refused",
  charset: "@charset is refused: every file is read as UTF-8",
};
