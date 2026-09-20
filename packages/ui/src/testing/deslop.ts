/**
 * The de-slop rules (K-redesign §3) as source scans, shared by the package's suite
 * (`packages/ui/test/deslop.test.ts`) and the web app's (`packages/web/test/deslop.test.ts`).
 *
 * What a check reads:
 *
 * - **Class tokens**: Tailwind classes from the TypeScript AST — string literals and the literal
 *   text of template strings, never comments — and from `@apply` lists in stylesheets. A string is
 *   a class string when it sits in a `className`-like JSX attribute, or when every word in it is
 *   shaped like a class: `"Uppercase letters"` in a dictionary is prose, `"flex uppercase"` in a
 *   lookup table is classes. A word touching an interpolation (`` `h-${n}` ``) is incomplete and
 *   never matched.
 * - **Class units**: the tokens that land on one element together — a JSX element's class
 *   attributes, a class string outside JSX (a `Record` entry), an `@apply` list. The co-occurrence
 *   rules (a tone's tint beside the same tone's line) read units.
 * - **JSX elements**: tag, literal attributes, direct children (seen through `{cond && …}`,
 *   `.map(…)` and fragments), the enclosing element, and the component they are written in — the
 *   nearest enclosing PascalCase function.
 * - **CSS rules** from `css.ts`: selectors, declarations, lines.
 *
 * A check reports hits: rule, file, line, and what it found. Homes a rule names (the one spinner
 * file, the files that move a sheet) come in through a {@link DeslopPolicy}; occurrences a later
 * wave removes are the suite's allowlist, counted per file and rule ({@link allowlistProblems}).
 *
 * Out of sight, and so review rather than guard: classes assembled at runtime (`TONE[tone]`), and
 * nesting across component boundaries.
 */
import ts from "typescript";
import { parseCssRules, stripCssComments } from "./css";
import type { CssStyleRule } from "./css";
import type { SourceFile } from "./source-roots";

// ---------------------------------------------------------------------------
// Rules and policy
// ---------------------------------------------------------------------------

/** §3's rules by their number in the design, so a hit points straight at its rule. */
export const DESLOP_RULES = {
  1: "transitions name their properties, never all",
  2: "no hover or press transforms",
  3: "state transitions take 120–200 ms",
  4: "a rounded child in a padded rounded box takes the inner radius",
  5: "a rounded clipping box owns the border",
  6: "status marks have no halo, and pulse only where something is live",
  7: "no icon in a tint of itself",
  8: "no coloured left-border callouts",
  9: "a filled tone box takes the neutral line",
  10: "badges carry state, kind or numbers, never mood",
  11: "one spinner",
  12: "spacing on the rhythm steps",
  13: "text sizes are rungs",
  14: "uppercase only through the eyebrow and display hooks",
  15: "numbers that align or update use tabular figures",
  16: "mono is for data, not labels",
  17: "one bordered surface per region",
  18: "no decoration without a job",
  19: "shadows are tokens",
  20: "colour is tokens",
  21: "no emoji in copy",
  22: "a page header has no eyebrow",
} as const;

export type DeslopRule = keyof typeof DESLOP_RULES;

export const DESLOP_RULE_NUMBERS = Object.keys(DESLOP_RULES).map(Number) as DeslopRule[];

export interface DeslopHit {
  readonly rule: DeslopRule;
  /** Repo-relative id of the file, forward slashes. */
  readonly file: string;
  readonly line: number;
  /** What was found: the class, the declaration, or a short description. */
  readonly found: string;
}

/**
 * Where a rule's named exceptions live. Entries are root-relative: ending in `/` matches a
 * directory, containing `/` matches that path, and a bare file name (`chevron.tsx`) matches the
 * file wherever it sits — the design names these homes by file name.
 */
export interface DeslopPolicy {
  /** Rule 1: files that may transition a transform — the chevron, the sheet, launcher and drawer motion. */
  readonly transformMotion: readonly string[];
  /** Rule 3: keyframe-driven entrances that may run 300 ms or longer. */
  readonly entranceMotion: readonly string[];
  /** Rule 6: files that may pulse without `.ui-live` — the dot, the skeleton, the streaming caret. */
  readonly pulseHomes: readonly string[];
  /** Rule 11: the one file that spins. */
  readonly spinnerHomes: readonly string[];
  /**
   * Rule 20: palette classes, `dark:` and hex literals are refused. True for the package, whose
   * source reads tokens only; false for the web app, which leaves the palette wave by wave.
   */
  readonly tokensOnly: boolean;
  /** Rule 20: where markup may spell a hex colour — identity data and the avatar palette. */
  readonly hexHomes: readonly string[];
}

export function matchesPolicyPath(rel: string, entries: readonly string[]): boolean {
  return entries.some((entry) =>
    entry.endsWith("/")
      ? rel.startsWith(entry)
      : entry.includes("/")
        ? rel === entry
        : rel === entry || rel.endsWith(`/${entry}`),
  );
}

// ---------------------------------------------------------------------------
// Class tokens
// ---------------------------------------------------------------------------

export interface ClassToken {
  /** As written: `dark:hover:bg-gray-800`. */
  readonly raw: string;
  /** Variants before the utility, outermost first: `["dark", "hover"]`. */
  readonly variants: readonly string[];
  /** The utility, `!` stripped: `bg-gray-800`, `-translate-x-1`. */
  readonly utility: string;
  readonly line: number;
  /** Character offset in the file. */
  readonly pos: number;
}

/** Splits `md:hover:[&>svg]:size-4!` into variants and utility on its top-level colons. */
export function parseClassToken(raw: string): { variants: string[]; utility: string } {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of raw) {
    if (ch === "[" || ch === "(") depth++;
    else if ((ch === "]" || ch === ")") && depth > 0) depth--;
    if (ch === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  return { variants: parts, utility: current.replace(/^!|!$/g, "") };
}

/** Class words with no hyphen, colon or bracket. Any other bare word makes its string prose. */
const SINGLE_WORD_CLASSES = new Set(
  (
    "absolute antialiased block blur border capitalize collapse container contents dark filter " +
    "fixed flex grayscale grid group grow hidden inline invert invisible isolate italic lowercase " +
    "ordinal outline overline peer prose relative resize ring rounded sepia shadow shrink static " +
    "sticky table transform transition truncate underline uppercase visible"
  ).split(" "),
);

/**
 * Whether a word is shaped like a class. A `partial` word touches an interpolation, so an open
 * bracket or a trailing hyphen is fine.
 */
export function isClassShaped(word: string, partial = false): boolean {
  let depth = 0;
  let letters = false;
  let plain = true;
  for (const ch of word) {
    if (ch === "[" || ch === "(") {
      depth++;
      plain = false;
    } else if (ch === "]" || ch === ")") {
      if (depth-- === 0) return false;
    } else if (depth === 0) {
      if (ch >= "a" && ch <= "z") letters = true;
      else if (!/[0-9\-:/.!@*%_&>+~]/.test(ch)) return false;
      if ("-:/@".includes(ch)) plain = false;
    }
  }
  if (word === "") return false;
  if (partial) return true;
  if (!letters || depth !== 0 || /^[.:/,]|[.:,/]$/.test(word)) return false;
  return !plain || SINGLE_WORD_CLASSES.has(word.replace(/^!|!$/g, ""));
}

interface Word {
  readonly text: string;
  readonly offset: number;
  readonly partial: boolean;
}

function splitWords(text: string, openStart: boolean, openEnd: boolean): Word[] {
  return [...text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    offset: match.index,
    partial:
      (openStart && match.index === 0) ||
      (openEnd && match.index + match[0].length === text.length),
  }));
}

function toTokens(words: readonly Word[], base: number, lineAt: (pos: number) => number) {
  return words
    .filter((word) => !word.partial && isClassShaped(word.text))
    .map((word): ClassToken => {
      const pos = base + word.offset;
      return { raw: word.text, ...parseClassToken(word.text), line: lineAt(pos), pos };
    });
}

// ---------------------------------------------------------------------------
// File analysis
// ---------------------------------------------------------------------------

export interface StringChunk {
  readonly text: string;
  readonly line: number;
  /** The chunk runs into an interpolation: its last word continues at runtime (`h-${n}`). */
  readonly openEnd: boolean;
}

/** Tokens that land on one element together. */
export interface ClassUnit {
  readonly tokens: readonly ClassToken[];
  readonly line: number;
}

export type JsxChild =
  | { readonly kind: "element"; readonly element: JsxElementInfo }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "expression" };

export interface JsxElementInfo {
  /** `div`, `Glyph`, `motion.div`. */
  readonly tag: string;
  readonly intrinsic: boolean;
  /** Literal attribute values: the string, `true` for a bare attribute, `null` for an expression. */
  readonly attributes: ReadonlyMap<string, string | true | null>;
  /** Complete class tokens from the element's class attributes. */
  readonly classes: readonly ClassToken[];
  readonly line: number;
  /** The nearest enclosing PascalCase function; `null` at module level. */
  readonly component: string | null;
  readonly parent: JsxElementInfo | null;
  readonly children: readonly JsxChild[];
}

export interface ComponentInfo {
  readonly name: string;
  readonly line: number;
  /** Class tokens written inside the component. */
  readonly classes: readonly ClassToken[];
  /** The first parameter's destructured names and declared type members. */
  readonly props: readonly string[];
  readonly elements: readonly JsxElementInfo[];
}

export interface FileAnalysis {
  readonly file: SourceFile;
  readonly surface: "markup" | "stylesheet";
  readonly tokens: readonly ClassToken[];
  readonly units: readonly ClassUnit[];
  readonly elements: readonly JsxElementInfo[];
  readonly components: readonly ComponentInfo[];
  /** Children lists of every element and fragment: where sibling order is read. */
  readonly siblingGroups: readonly (readonly JsxChild[])[];
  /** Every string chunk in markup, class or not: hex literals and emoji are looked for here. */
  readonly strings: readonly StringChunk[];
  readonly cssRules: readonly CssStyleRule[];
}

/** JSX attributes that carry classes: `className`, `class`, `panelClassName`, `iconClass`. */
const CLASS_ATTRIBUTE = /^(?:class|className)$|(?:ClassName|Class)$/;

const analyses = new WeakMap<SourceFile, FileAnalysis>();

export function analyzeFile(file: SourceFile): FileAnalysis {
  let analysis = analyses.get(file);
  if (analysis === undefined) {
    analysis = file.name.endsWith(".css") ? analyzeStylesheet(file) : analyzeMarkup(file);
    analyses.set(file, analysis);
  }
  return analysis;
}

function analyzeStylesheet(file: SourceFile): FileAnalysis {
  const css = stripCssComments(file.text);
  const lineAt = (pos: number) => css.slice(0, pos).split("\n").length;
  const units = [...css.matchAll(/@apply\s+([^;{}]+)/g)].map((match) => ({
    tokens: toTokens(
      splitWords(match[1]!, false, false),
      match.index + match[0].length - match[1]!.length,
      lineAt,
    ),
    line: lineAt(match.index),
  }));
  return {
    file,
    surface: "stylesheet",
    tokens: units.flatMap((unit) => unit.tokens),
    units,
    elements: [],
    components: [],
    siblingGroups: [],
    strings: [],
    cssRules: parseCssRules(file.text),
  };
}

/** The name a function goes by: its own, or the variable, property or method holding it. */
function functionName(node: ts.Node): string | null {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
    return node.name.text;
  }
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return null;
  let holder: ts.Node = node.parent;
  // Through `memo(() => …)` and `forwardRef(function (…) {…})`.
  while (ts.isCallExpression(holder) || ts.isParenthesizedExpression(holder))
    holder = holder.parent;
  if (
    (ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder)) &&
    ts.isIdentifier(holder.name)
  ) {
    return holder.name.text;
  }
  return null;
}

const isPascalCase = (name: string) => /^[A-Z][A-Za-z0-9]*$/.test(name);

function analyzeMarkup(file: SourceFile): FileAnalysis {
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lineAt = (pos: number) => source.getLineAndCharacterOfPosition(pos).line + 1;
  const strings: StringChunk[] = [];
  const tokens: ClassToken[] = [];
  const looseUnits: ClassUnit[] = [];
  const attributeTokens = new Map<ts.Node, ClassToken[]>();

  /** One literal chunk: in a class attribute (`attribute`), or `classes` false in any other. */
  const chunk = (
    text: string,
    start: number,
    open: readonly [boolean, boolean],
    attribute: ts.JsxAttribute | null,
    classes: boolean,
  ) => {
    strings.push({ text, line: lineAt(start), openEnd: open[1] });
    if (!classes) return;
    const words = splitWords(text, open[0], open[1]);
    const classString =
      attribute !== null ||
      (words.length > 0 && words.every((word) => isClassShaped(word.text, word.partial)));
    if (!classString) return;
    const found = toTokens(words, start, lineAt);
    if (found.length === 0) return;
    tokens.push(...found);
    if (attribute === null) {
      looseUnits.push({ tokens: found, line: lineAt(start) });
    } else {
      const owner = attribute.parent.parent;
      attributeTokens.set(owner, [...(attributeTokens.get(owner) ?? []), ...found]);
    }
  };

  const visit = (node: ts.Node, attribute: ts.JsxAttribute | null, classes: boolean): void => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isLiteralTypeNode(node) ||
      ts.isImportTypeNode(node) ||
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const isClass = CLASS_ATTRIBUTE.test(node.name.getText(source));
      if (node.initializer) visit(node.initializer, isClass ? node : null, isClass);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      chunk(node.text, node.getStart(source) + 1, [false, false], attribute, classes);
    } else if (ts.isTemplateExpression(node)) {
      chunk(node.head.text, node.head.getStart(source) + 1, [false, true], attribute, classes);
      for (const span of node.templateSpans) {
        visit(span.expression, attribute, classes);
        const open = [true, !ts.isTemplateTail(span.literal)] as const;
        chunk(span.literal.text, span.literal.getStart(source) + 1, open, attribute, classes);
      }
    } else if (ts.isPropertyAssignment(node)) {
      visit(node.initializer, attribute, classes); // the key is a name, not a value
    } else {
      ts.forEachChild(node, (child) => visit(child, attribute, classes));
    }
  };
  visit(source, null, true);

  // Elements.
  type Element = JsxElementInfo & { parent: JsxElementInfo | null; children: JsxChild[] };
  const infos = new Map<ts.Node, Element>();
  const collect = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(source);
      const attributes = new Map<string, string | true | null>();
      for (const attr of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        const init = attr.initializer;
        const literal =
          init !== undefined && ts.isJsxExpression(init) ? init.expression : (init ?? null);
        attributes.set(
          attr.name.getText(source),
          init === undefined
            ? true
            : literal !== undefined &&
                literal !== null &&
                (ts.isStringLiteral(literal) ||
                  ts.isNoSubstitutionTemplateLiteral(literal) ||
                  ts.isNumericLiteral(literal))
              ? literal.text
              : null,
        );
      }
      let component: string | null = null;
      for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
        const name = functionName(at);
        if (name !== null && isPascalCase(name)) {
          component = name;
          break;
        }
      }
      infos.set(node, {
        tag,
        intrinsic: /^[a-z][\w-]*$/.test(tag),
        attributes,
        classes: attributeTokens.get(opening) ?? [],
        line: lineAt(node.getStart(source)),
        component,
        parent: null,
        children: [],
      });
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  /** The elements an expression renders: JSX in it that is not inside other JSX in it. */
  const rendered = (expression: ts.Node): Element[] => {
    const found: Element[] = [];
    const walk = (node: ts.Node): void => {
      const info = infos.get(node);
      if (info !== undefined) found.push(info);
      else ts.forEachChild(node, walk);
    };
    walk(expression);
    return found;
  };
  const childrenOf = (children: ts.NodeArray<ts.JsxChild>): JsxChild[] =>
    children.flatMap((child): JsxChild[] => {
      if (ts.isJsxText(child)) {
        return child.text.trim() === "" ? [] : [{ kind: "text", text: child.text.trim() }];
      }
      if (ts.isJsxFragment(child)) return childrenOf(child.children);
      if (!ts.isJsxExpression(child)) return [{ kind: "element", element: infos.get(child)! }];
      const expression = child.expression;
      if (expression === undefined) return [];
      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return [{ kind: "text", text: expression.text }];
      }
      const elements = rendered(expression);
      return elements.length === 0
        ? [{ kind: "expression" }]
        : elements.map((element) => ({ kind: "element", element }));
    });
  const siblingGroups: JsxChild[][] = [];
  const fragments = (node: ts.Node): void => {
    if (ts.isJsxFragment(node)) siblingGroups.push(childrenOf(node.children));
    ts.forEachChild(node, fragments);
  };
  fragments(source);
  for (const [node, info] of infos) {
    if (ts.isJsxElement(node)) info.children = childrenOf(node.children);
    siblingGroups.push(info.children);
    for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
      const parent = infos.get(at);
      if (parent !== undefined) {
        info.parent = parent;
        break;
      }
    }
  }

  // Components.
  const membersOf = (type: ts.TypeNode | undefined): string[] => {
    if (type === undefined) return [];
    if (ts.isTypeLiteralNode(type))
      return type.members.flatMap((m) => m.name?.getText(source) ?? []);
    if (ts.isIntersectionTypeNode(type)) return type.types.flatMap(membersOf);
    if (!ts.isTypeReferenceNode(type)) return [];
    const name = type.typeName.getText(source);
    for (const statement of source.statements) {
      if (ts.isInterfaceDeclaration(statement) && statement.name.text === name) {
        return statement.members.flatMap((m) => m.name?.getText(source) ?? []);
      }
      if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) {
        return membersOf(statement.type);
      }
    }
    return [];
  };
  const components: ComponentInfo[] = [];
  const findComponents = (node: ts.Node): void => {
    const name =
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
        ? functionName(node)
        : null;
    if (name !== null && isPascalCase(name)) {
      const fn = node as ts.FunctionLikeDeclarationBase;
      const [start, end] = [fn.getStart(source), fn.getEnd()];
      const param = fn.parameters[0];
      const props = param === undefined ? [] : membersOf(param.type);
      if (param !== undefined && ts.isObjectBindingPattern(param.name)) {
        props.push(...param.name.elements.map((e) => (e.propertyName ?? e.name).getText(source)));
      }
      components.push({
        name,
        line: lineAt(start),
        classes: tokens.filter((token) => token.pos >= start && token.pos < end),
        props,
        elements: [...infos]
          .filter(([element]) => element.getStart(source) >= start && element.getEnd() <= end)
          .map(([, info]) => info),
      });
    }
    ts.forEachChild(node, findComponents);
  };
  findComponents(source);

  const elements = [...infos.values()];
  return {
    file,
    surface: "markup",
    tokens,
    units: [
      ...elements
        .filter((element) => element.classes.length > 0)
        .map((element) => ({ tokens: element.classes, line: element.line })),
      ...looseUnits,
    ],
    elements,
    components,
    siblingGroups,
    strings,
    cssRules: [],
  };
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const TONE_NAMES = ["success", "attention", "danger", "done", "neutral", "info"] as const;
/** Tailwind's chromatic hues: what a tone box, a callout or a halo can be painted in. */
const CHROMATIC_HUES =
  "red orange amber yellow lime green emerald teal cyan sky blue indigo violet purple fuchsia pink rose".split(
    " ",
  );
const HUE = `(?:${[...CHROMATIC_HUES, "slate", "gray", "zinc", "neutral", "stone"].join("|")})`;
const CHROMA = `(?:${CHROMATIC_HUES.join("|")})`;
const STEP = "(?:50|[1-9]00|950)";
const ALPHA = "(?:/[\\w.%[\\]()-]+)?";
const TINT = "(?:50|100|200)";

/** Rule 20: a colour utility on Tailwind's palette, or white / black. */
const PALETTE_CLASS = new RegExp(
  "^(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide|" +
    `placeholder|caret|accent|decoration|shadow|inset-shadow|inset-ring|drop-shadow)-(?:${HUE}-${STEP}|white|black)${ALPHA}$`,
);

/** Rule 1: what a transition may name. The transform family only in the motion files. */
const TRANSITION_PROPERTIES = new Set(
  "color background-color border-color opacity box-shadow outline-color text-decoration-color fill stroke".split(
    " ",
  ),
);
const TRANSFORM_PROPERTIES = new Set(["transform", "translate", "scale", "rotate"]);

/** Rule 12: the steps a gap, a stack or an all-sides padding may take. */
const RHYTHM_STEPS = new Set(["0", "px", "1", "1.5", "2", "3", "4", "6", "10"]);

/** Rule 10: words that sell rather than state. */
const MOOD_WORDS = new Set(["new", "hot", "popular", "beta", "trending", "exclusive"]);

/** Rule 21: pictographs that render as emoji by default, or are forced into emoji by VS16. */
export const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;

/** Rule 20: a hex colour inside a string: `#fff`, `#2563eb`, `bg-[#00000080]`. */
const HEX_COLOUR = /(?:^|[\s([,:=])(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8}))(?![0-9a-z])/gi;
/** A short form with no letter is a label (`#001`), unless it is one repeated digit (`#000`). */
const isHexColour = (hex: string) =>
  hex.length > 5 || /[a-f]/i.test(hex) || new Set(hex.slice(1)).size === 1;

/** The components §3 names: tabular figures (15), mono-free labels (16), no eyebrow (22). */
export const TABULAR_COMPONENTS: readonly string[] = ["StatChip", "Count", "KeyValue"];
export const LABEL_COMPONENTS: readonly string[] = ["Button", "NavRow", "Heading", "MenuItem"];
export const PAGE_HEADER_COMPONENTS: readonly string[] = ["PageHeader"];

const BORDER_WIDTH = /^border(?:-(?:2|4|8))?$/;
/** Every step `theme.css` bridges onto the theme's radius scale, `--radius-xs` through `--radius-3xl`. */
const ROUNDED_STEP = /^rounded-(?:xs|sm|md|lg|xl|2xl|3xl)$/;
const INNER_RADIUS =
  /^rounded-(?:full|control|\[var\(--radius-inner\)\]|\(--radius-inner\)|\[var\(--ui-radius-control\)\]|\(--ui-radius-control\))$/;
const DURATION_TOKEN = /^var\(\s*--ui-dur-(fast|base|slow)\s*(?:,[^)]*)?\)$/;

/** True when a token with no variants in the unit matches. */
const has = (tokens: readonly ClassToken[], pattern: RegExp) =>
  tokens.some((token) => token.variants.length === 0 && pattern.test(token.utility));

// ---------------------------------------------------------------------------
// Token predicates: what to report for one token, or null
// ---------------------------------------------------------------------------

type TokenPredicate = (token: ClassToken, file: SourceFile, policy: DeslopPolicy) => string | null;

const inPolicy = (file: SourceFile, entries: readonly string[]) =>
  matchesPolicyPath(file.rel, entries);

/** The comma-separated values of `name-[a,b]` or `name-(a,b)`, or null. */
function arbitraryValues(utility: string, name: string): string[] | null {
  if (!utility.startsWith(`${name}-[`) && !utility.startsWith(`${name}-(`)) return null;
  return utility
    .slice(name.length + 2, -1)
    .split(",")
    .map((part) => part.trim().replace(/_/g, " "));
}

function refusedTransitionProperties(properties: readonly string[], transformOk: boolean) {
  return properties.filter(
    (p) => !TRANSITION_PROPERTIES.has(p) && !(transformOk && TRANSFORM_PROPERTIES.has(p)),
  );
}

/** Rule 1: `transition-all`, bare `transition`, `transition-transform` off the motion files, a `transition-[…]` list off the set. */
const transitionToken: TokenPredicate = (token, file, policy) => {
  const u = token.utility;
  if (u === "transition-all" || u === "transition") return token.raw;
  const transformOk = inPolicy(file, policy.transformMotion);
  if (u === "transition-transform") return transformOk ? null : token.raw;
  const list = arbitraryValues(u, "transition");
  if (list === null || list.some((p) => p.startsWith("--") || p.startsWith("var("))) return null;
  const refused = refusedTransitionProperties(list, transformOk);
  return refused.length > 0 ? token.raw : null;
};

/** Rule 2: `scale-*` / `translate-*` under a hover, active or focus variant (group- and peer- too). */
const hoverTransformToken: TokenPredicate = (token) =>
  token.variants.some((v) =>
    /^(?:group-|peer-)?(?:hover|active|focus|focus-visible|focus-within)(?:\/[\w-]+)?$/.test(v),
  ) && /^-?(?:scale|translate)-/.test(token.utility)
    ? token.raw
    : null;

function milliseconds(value: string): number | null {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value.trim());
  return match === null ? null : Number(match[1]) * (match[2] === "s" ? 1000 : 1);
}

/**
 * Rule 3 on one duration. A duration token is fine (slow only in an entrance); a literal is fine
 * at 0, in `allowed`, or at 300 ms and up in an entrance. Other `var()`s are not ours to judge.
 */
function durationRefused(value: string, entrance: boolean, allowed: (ms: number) => boolean) {
  const token = DURATION_TOKEN.exec(value.trim());
  if (token !== null) return token[1] === "slow" && !entrance;
  const ms = milliseconds(value);
  return ms !== null && ms !== 0 && !allowed(ms) && !(ms >= 300 && entrance);
}

/** Utilities: `duration-150`, `duration-200` or the fast / base token — nothing in between. */
const UTILITY_DURATIONS = (ms: number) => ms === 150 || ms === 200;
/** Stylesheets: anything from 120 to 200 ms. */
const CSS_DURATIONS = (ms: number) => ms >= 120 && ms <= 200;

/** Rule 3: `duration-*` other than 150, 200 or the fast / base token; 300+ only in an entrance file. */
const durationToken: TokenPredicate = (token, file, policy) => {
  const entrance = inPolicy(file, policy.entranceMotion);
  const numeric = /^duration-(\d+)$/.exec(token.utility);
  const values =
    numeric !== null ? [`${numeric[1]}ms`] : arbitraryValues(token.utility, "duration");
  if (values === null || values.length !== 1) return null;
  const value = values[0]!.startsWith("--") ? `var(${values[0]})` : values[0]!;
  if (value.startsWith("var(") && !DURATION_TOKEN.test(value)) return null;
  return durationRefused(value, entrance, UTILITY_DURATIONS) ? token.raw : null;
};

/** Rule 11: `animate-spin` outside the Spinner file; `border-t-transparent` anywhere. */
const spinnerToken: TokenPredicate = (token, file, policy) => {
  const u = token.utility;
  if (u === "border-t-transparent") return token.raw;
  const spins = u === "animate-spin" || /^animate-[[(]spin[_\s]/.test(u);
  return spins && !inPolicy(file, policy.spinnerHomes) ? token.raw : null;
};

/** Rule 12: `gap-*`, `space-x|y-*`, `p-*` off the rhythm steps; a `var(--ui-*)` value is a step. */
const spacingToken: TokenPredicate = (token) => {
  const match = /^(?:gap(?:-[xy])?|space-[xy]|p)-(.+)$/.exec(token.utility);
  if (match === null || match[1] === "reverse" || RHYTHM_STEPS.has(match[1]!)) return null;
  return /^(?:\[var\(--ui-[\w-]+\)\]|\(--ui-[\w-]+\))$/.test(match[1]!) ? null : token.raw;
};

/**
 * Rule 13: a literal font size, `text-[11px]` or `text-[0.6875rem]`, with or without Tailwind's
 * line-height modifier (`text-[11px]/4`, `text-[0.6875rem]/[1.2]`).
 */
const textSizeToken: TokenPredicate = (token) =>
  /^text-\[(?:length:)?\d*\.?\d+(?:px|rem)\](?:\/\S+)?$/.test(token.utility) ? token.raw : null;

/** Rule 14: `uppercase` and `tracking-wide|wider|widest`. */
const uppercaseToken: TokenPredicate = (token) =>
  /^(?:uppercase|tracking-(?:wide|wider|widest))$/.test(token.utility) ? token.raw : null;

/** Rule 19: a shadow other than `shadow-sm|lg|xl|none` or `shadow-[var(--ui-shadow-*)]`; any `drop-shadow`. */
const shadowToken: TokenPredicate = (token) => {
  const u = token.utility;
  if (!/^(?:shadow|inset-shadow|drop-shadow)(?:-|$)/.test(u)) return null;
  if (/^shadow-(?:sm|lg|xl|none)$/.test(u)) return null;
  if (/^shadow-(?:\[var\(--ui-shadow-[a-z]+\)\]|\(--ui-shadow-[a-z]+\))$/.test(u)) return null;
  return token.raw;
};

/** Rule 20: a palette colour class or a `dark:` variant, where the policy is tokens only. */
const paletteToken: TokenPredicate = (token, _file, policy) =>
  policy.tokensOnly && (token.variants.includes("dark") || PALETTE_CLASS.test(token.utility))
    ? token.raw
    : null;

// ---------------------------------------------------------------------------
// Unit and element checks
// ---------------------------------------------------------------------------

type Check = (analysis: FileAnalysis, policy: DeslopPolicy) => Omit<DeslopHit, "rule" | "file">[];

const tokenCheck =
  (predicate: TokenPredicate): Check =>
  (analysis, policy) =>
    analysis.tokens.flatMap((token) => {
      const found = predicate(token, analysis.file, policy);
      return found === null ? [] : [{ line: token.line, found }];
    });

/** Rule 6: `animate-ping`; `animate-pulse` off `.ui-live` outside the pulse homes; a halo on a dot. */
const statusMarkCheck: Check = (analysis, policy) =>
  analysis.units.flatMap((unit) => {
    const hits: { line: number; found: string }[] = [];
    const live = unit.tokens.some((t) => t.utility === "ui-live");
    for (const token of unit.tokens) {
      if (
        token.utility === "animate-ping" ||
        (token.utility === "animate-pulse" && !live && !inPolicy(analysis.file, policy.pulseHomes))
      ) {
        hits.push({ line: token.line, found: token.raw });
      }
    }
    const dot =
      has(unit.tokens, /^rounded-full$/) &&
      (has(unit.tokens, /^size-(?:1|1\.5|2|2\.5)$/) ||
        (has(unit.tokens, /^h-(?:1|1\.5|2|2\.5)$/) && has(unit.tokens, /^w-(?:1|1\.5|2|2\.5)$/)));
    if (dot) {
      const halo = new RegExp(`^(?:ring-(?:tone-|accent|${CHROMA}-)|shadow(?!-none$))`);
      for (const token of unit.tokens) {
        if (halo.test(token.utility))
          hits.push({ line: token.line, found: `${token.raw} on a dot` });
      }
    }
    return hits;
  });

/** Rule 7: a tone's (or a hue's) tint and ink on an element whose only content is icons. */
const tintedIconCheck: Check = (analysis) =>
  analysis.elements.flatMap((element) => {
    const iconOnly =
      element.children.length > 0 &&
      element.children.every(
        (child) =>
          child.kind === "element" &&
          (/^(?:svg|Glyph|GlyphIcon|Chevron)$|Icon$/.test(child.element.tag) ||
            (child.element.intrinsic && child.element.children.length === 0)),
      );
    if (!iconOnly) return [];
    const tone =
      TONE_NAMES.find(
        (t) =>
          has(element.classes, new RegExp(`^bg-tone-${t}-bg$`)) &&
          has(element.classes, new RegExp(`^text-tone-${t}-fg$`)),
      ) ??
      CHROMATIC_HUES.find(
        (h) =>
          has(element.classes, new RegExp(`^bg-${h}-${TINT}${ALPHA}$`)) &&
          has(element.classes, new RegExp(`^text-${h}-${STEP}${ALPHA}$`)),
      );
    return tone === undefined
      ? []
      : [
          {
            line: element.line,
            found: `<${element.tag}> holds only an icon, in ${tone} ink on ${tone} tint`,
          },
        ];
  });

/** Rule 8: a 2 or 4 px left border in a tone, the accent or a chromatic hue. */
const leftBorderCheck: Check = (analysis) => {
  const colour = new RegExp(
    `^border-(?:[ls]-)?(?:tone-[a-z]+-(?:line|fg|emphasis|bg)|accent(?:-[a-z]+)?|${CHROMA}-${STEP}${ALPHA})$`,
  );
  return analysis.units.flatMap((unit) => {
    const width = unit.tokens.find((t) => /^border-[ls]-(?:2|4)$/.test(t.utility));
    if (width === undefined || !unit.tokens.some((t) => colour.test(t.utility))) return [];
    return [{ line: width.line, found: `${width.raw} in a colour` }];
  });
};

/** Rule 9: a tone's tint beside the same tone's line, or a hue's 50–200 tint beside its border. */
const oneHueCheck: Check = (analysis) =>
  analysis.units.flatMap((unit) => [
    ...TONE_NAMES.filter(
      (t) =>
        has(unit.tokens, new RegExp(`^bg-tone-${t}-bg$`)) &&
        has(unit.tokens, new RegExp(`^border(?:-[xytrblse])?-tone-${t}-(?:line|fg|emphasis)$`)),
    ).map((t) => ({ line: unit.line, found: `${t}: tint and line on one box` })),
    ...CHROMATIC_HUES.filter(
      (h) =>
        has(unit.tokens, new RegExp(`^bg-${h}-${TINT}${ALPHA}$`)) &&
        has(unit.tokens, new RegExp(`^border(?:-[xytrblse])?-${h}-${STEP}${ALPHA}$`)),
    ).map((h) => ({ line: unit.line, found: `${h}: tint and line on one box` })),
  ]);

/** Rule 4: a stepped radius on a direct child of a padded box with a stepped radius. */
const nestedRadiusCheck: Check = (analysis) =>
  analysis.elements.flatMap((element) => {
    if (!has(element.classes, ROUNDED_STEP) || !has(element.classes, /^p-(?!0$|px$)/)) return [];
    return element.children.flatMap((child) => {
      if (child.kind !== "element") return [];
      const radius = child.element.classes.find(
        (t) => t.variants.length === 0 && ROUNDED_STEP.test(t.utility),
      );
      if (radius === undefined || has(child.element.classes, INNER_RADIUS)) return [];
      return [
        {
          line: child.element.line,
          found: `<${child.element.tag}> ${radius.raw} in a padded rounded box`,
        },
      ];
    });
  });

/** Rule 5: a full border on a direct child of a rounded box that clips. */
const clippedBorderCheck: Check = (analysis) =>
  analysis.elements.flatMap((element) => {
    if (
      !has(element.classes, /^rounded(?:-(?!none$|0$).+)?$/) ||
      !has(element.classes, /^overflow(?:-[xy])?-(?:hidden|clip)$/)
    ) {
      return [];
    }
    return element.children.flatMap((child) => {
      if (child.kind !== "element") return [];
      const border = child.element.classes.find(
        (t) => t.variants.length === 0 && BORDER_WIDTH.test(t.utility),
      );
      return border === undefined
        ? []
        : [
            {
              line: child.element.line,
              found: `<${child.element.tag}> ${border.raw} inside a clipping rounded box`,
            },
          ];
    });
  });

/**
 * Rule 10: a `<Badge>` whose literal text is a mood word or an emoji.
 *
 * Only literal children are read, which is §3's own scope for this rule. A badge whose copy comes
 * from a dictionary (`<Badge>{S.models.freeBadge}</Badge>`, how the web app spells all but one of
 * them) is out of reach here; the dictionaries themselves are read by rule 21, for emoji. So in an
 * app that keeps its copy in `strings.ts` this rule guards the hard-coded badge only.
 */
const moodBadgeCheck: Check = (analysis) =>
  analysis.elements.flatMap((element) =>
    element.tag !== "Badge"
      ? []
      : element.children.flatMap((child) => {
          if (child.kind !== "text") return [];
          const word = child.text.trim().toLowerCase();
          const mood =
            MOOD_WORDS.has(word) && !(word === "beta" && element.component === "BetaBadge");
          return mood || EMOJI.test(child.text)
            ? [{ line: element.line, found: `<Badge>${child.text.trim()}</Badge>` }]
            : [];
        }),
  );

const isEyebrow = (element: JsxElementInfo) =>
  element.classes.some((t) => t.utility === "ui-eyebrow") ||
  (element.tag === "Text" && element.attributes.get("variant") === "eyebrow");

/** The heading level an element states: `h1`–`h6`, or `Heading`'s literal `level` prop. */
export function headingLevel(element: JsxElementInfo): number | null {
  const intrinsic = /^h([1-6])$/.exec(element.tag);
  if (intrinsic !== null) return Number(intrinsic[1]);
  const level = element.tag === "Heading" ? element.attributes.get("level") : undefined;
  return typeof level === "string" && /^[1-6]$/.test(level) ? Number(level) : null;
}

/** Rule 14: an eyebrow as the previous sibling of an h1–h4. */
const eyebrowSiblingCheck: Check = (analysis) =>
  analysis.siblingGroups.flatMap((group) =>
    group.flatMap((child, i) => {
      const next = group[i + 1];
      if (child.kind !== "element" || next?.kind !== "element") return [];
      const level = headingLevel(next.element);
      return isEyebrow(child.element) && level !== null && level <= 4
        ? [{ line: child.element.line, found: `eyebrow directly above <${next.element.tag}>` }]
        : [];
    }),
  );

/** Rule 15: a listed component with no `tabular-nums`. */
const tabularCheck: Check = (analysis) =>
  analysis.components
    .filter((c) => TABULAR_COMPONENTS.includes(c.name))
    .filter((c) => !c.classes.some((t) => t.utility === "tabular-nums"))
    .map((c) => ({ line: c.line, found: `${c.name} has no tabular-nums` }));

/** Rule 16: `font-mono` inside a listed label component. */
const monoLabelCheck: Check = (analysis) =>
  analysis.components
    .filter((c) => LABEL_COMPONENTS.includes(c.name))
    .flatMap((c) =>
      c.classes
        .filter((t) => t.utility === "font-mono")
        .map((t) => ({ line: t.line, found: `${t.raw} in ${c.name}` })),
    );

/** Block containers: what a card is written as. A bordered filled `<span>` or `<input>` is a control. */
const BLOCK_TAGS =
  /^(?:div|section|article|aside|header|footer|main|nav|ul|ol|li|details|form|fieldset)$/;

/** Rule 17: a bordered surface nested in another bordered surface in the same file. */
const nestedSurfaceCheck: Check = (analysis) => {
  const surface = (e: JsxElementInfo) =>
    BLOCK_TAGS.test(e.tag) &&
    has(e.classes, BORDER_WIDTH) &&
    has(e.classes, /^bg-surface(?:-muted|-inset)?$/);
  return analysis.elements.flatMap((element) => {
    if (!surface(element)) return [];
    for (let up = element.parent; up !== null; up = up.parent) {
      if (surface(up)) {
        return [
          {
            line: element.line,
            found: `<${element.tag}> surface inside the surface at line ${up.line}`,
          },
        ];
      }
    }
    return [];
  });
};

/** Rule 18: gradient backgrounds, and backdrop filters on a unit without `.ui-glass`. */
const decorationCheck: Check = (analysis) =>
  analysis.units.flatMap((unit) => {
    const glass = unit.tokens.some((t) => t.utility === "ui-glass");
    return unit.tokens.flatMap((token) => {
      const u = token.utility;
      const gradient =
        /^bg-(?:gradient-|linear-|radial|conic)/.test(u) ||
        /^bg-\[(?:image:)?(?:repeating-)?(?:linear|radial|conic)-gradient/.test(u) ||
        /^\[background(?:-image)?:[^\]]*gradient/.test(u);
      const blur = /^(?:backdrop-(?:blur|saturate|filter)|\[(?:-webkit-)?backdrop-filter:)/.test(u);
      return gradient || (blur && !glass) ? [{ line: token.line, found: token.raw }] : [];
    });
  });

/** Rule 20's hex half: hex colours in source strings outside the identity-data homes. */
const hexCheck: Check = (analysis, policy) => {
  if (!policy.tokensOnly || inPolicy(analysis.file, policy.hexHomes)) return [];
  return analysis.strings.flatMap((chunk) =>
    [...chunk.text.matchAll(HEX_COLOUR)]
      .filter((match) => isHexColour(match[1]!))
      .map((match) => ({
        line: chunk.line + (chunk.text.slice(0, match.index).match(/\n/g)?.length ?? 0),
        found: match[1]!,
      })),
  );
};

/** Rule 21: emoji in a `strings*.ts` dictionary or under `fixtures/`. */
const emojiCheck: Check = (analysis) => {
  const { rel, name } = analysis.file;
  if (!/^strings.*\.ts$/.test(name) && !rel.startsWith("fixtures/")) return [];
  return analysis.strings
    .filter((chunk) => EMOJI.test(chunk.text))
    .map((chunk) => ({ line: chunk.line, found: chunk.text.match(EMOJI)![0] }));
};

/** Rule 22: a page header that takes or renders an eyebrow. */
const pageHeaderCheck: Check = (analysis) =>
  analysis.components
    .filter((c) => PAGE_HEADER_COMPONENTS.includes(c.name))
    .flatMap((c) => [
      ...(c.props.includes("eyebrow")
        ? [{ line: c.line, found: `${c.name} takes an eyebrow` }]
        : []),
      ...c.elements
        .filter(isEyebrow)
        .map((e) => ({ line: e.line, found: `${c.name} renders an eyebrow` })),
    ]);

// ---------------------------------------------------------------------------
// Stylesheet checks
// ---------------------------------------------------------------------------

const fullSelector = (rule: CssStyleRule) => [...rule.parents, rule.selector].join(" ");

/** Transition shorthand items; a missing property is `all`, as in CSS. */
function transitionItems(value: string): { property: string; duration: string | null }[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value.replace(/!important/g, "")) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      items.push(current);
      current = "";
    } else current += ch;
  }
  items.push(current);
  return items
    .map((item) => item.trim())
    .filter((item) => item !== "" && item !== "none")
    .map((item) => {
      let property: string | null = null;
      let duration: string | null = null;
      for (const part of item.match(/[\w-]+\((?:[^()]|\([^()]*\))*\)|\S+/g) ?? []) {
        if (DURATION_TOKEN.test(part) || milliseconds(part) !== null) duration ??= part;
        else if (
          property === null &&
          /^[a-z-]+$/.test(part) &&
          !/^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|allow-discrete|normal)$/.test(
            part,
          )
        ) {
          property = part;
        }
      }
      return { property: property ?? "all", duration };
    });
}

const declarations = (analysis: FileAnalysis) =>
  analysis.cssRules.flatMap((rule) => rule.declarations.map((decl) => ({ rule, decl })));

/** Rule 1: `transition` / `transition-property` naming `all` (or nothing) or a property off the set. */
const cssTransitionCheck: Check = (analysis, policy) =>
  declarations(analysis).flatMap(({ decl }) => {
    const properties =
      decl.name === "transition"
        ? transitionItems(decl.value).map((item) => item.property)
        : decl.name === "transition-property"
          ? decl.value
              .split(",")
              .map((p) => p.trim())
              .filter((p) => p !== "none" && !p.startsWith("var("))
          : [];
    const refused = refusedTransitionProperties(
      properties,
      inPolicy(analysis.file, policy.transformMotion),
    );
    return refused.length > 0
      ? [{ line: decl.line, found: `${decl.name}: ${refused.join(", ")}` }]
      : [];
  });

/** Rule 2: `transform`, `translate` or `scale` declared under `:hover` or `:active`. */
const cssHoverTransformCheck: Check = (analysis) =>
  declarations(analysis).flatMap(({ rule, decl }) =>
    /:(?:hover|active)\b/.test(fullSelector(rule)) &&
    /^(?:transform|translate|scale)$/.test(decl.name) &&
    decl.value !== "none"
      ? [{ line: decl.line, found: `${rule.selector} { ${decl.name}: ${decl.value} }` }]
      : [],
  );

/** Rule 3: a transition duration outside 120–200 ms (300+ only in an entrance file). */
const cssDurationCheck: Check = (analysis, policy) => {
  const entrance = inPolicy(analysis.file, policy.entranceMotion);
  return declarations(analysis).flatMap(({ decl }) => {
    const durations =
      decl.name === "transition"
        ? transitionItems(decl.value).flatMap((item) => item.duration ?? [])
        : decl.name === "transition-duration"
          ? decl.value.split(",").map((part) => part.trim())
          : [];
    return durations
      .filter((duration) => durationRefused(duration, entrance, CSS_DURATIONS))
      .map((duration) => ({ line: decl.line, found: `${decl.name}: ${duration}` }));
  });
};

/** Animations named `names` outside the rules whose selector matches `except` (the live hook). */
const cssAnimationCheck =
  (names: RegExp, except: RegExp): Check =>
  (analysis) =>
    declarations(analysis).flatMap(({ rule, decl }) =>
      /^animation(?:-name)?$/.test(decl.name) &&
      names.test(decl.value) &&
      !except.test(fullSelector(rule))
        ? [{ line: decl.line, found: `${rule.selector} { ${decl.name}: ${decl.value} }` }]
        : [],
    );

/** Rule 14: `text-transform: uppercase` outside `.ui-eyebrow` / `.ui-display` rules. */
const cssUppercaseCheck: Check = (analysis) =>
  declarations(analysis).flatMap(({ rule, decl }) =>
    decl.name === "text-transform" &&
    decl.value === "uppercase" &&
    !/\.ui-(?:eyebrow|display)\b/.test(fullSelector(rule))
      ? [{ line: decl.line, found: `${rule.selector} { text-transform: uppercase }` }]
      : [],
  );

/** Rule 16: a hook recipe (`.ui-*`) setting a mono `font-family`. */
const cssHookMonoCheck: Check = (analysis) =>
  declarations(analysis).flatMap(({ rule, decl }) =>
    /\.ui-[a-z]/.test(fullSelector(rule)) &&
    decl.name === "font-family" &&
    /--ui-font-mono|monospace/.test(decl.value)
      ? [{ line: decl.line, found: `${rule.selector} { font-family: ${decl.value} }` }]
      : [],
  );

/**
 * Gradients painted by a hook recipe — the atmosphere tell — and backdrop filters off `.ui-glass`.
 * A gradient in app CSS that is not a hook (the context bar's hatch, which carries meaning) is
 * review.
 */
const cssDecorationCheck: Check = (analysis) =>
  declarations(analysis).flatMap(({ rule, decl }) => {
    if (
      /\.ui-[a-z]/.test(fullSelector(rule)) &&
      /^background(?:-image)?$/.test(decl.name) &&
      /gradient\(/.test(decl.value)
    ) {
      return [{ line: decl.line, found: `${rule.selector} { ${decl.name}: …gradient() }` }];
    }
    if (
      /^(?:-webkit-)?backdrop-filter$/.test(decl.name) &&
      decl.value !== "none" &&
      !fullSelector(rule).includes(".ui-glass")
    ) {
      return [{ line: decl.line, found: `${rule.selector} { ${decl.name}: ${decl.value} }` }];
    }
    return [];
  });

// ---------------------------------------------------------------------------
// The check table
// ---------------------------------------------------------------------------

export interface DeslopCheck {
  readonly rule: DeslopRule;
  /** Which files the check reads: `.ts`/`.tsx`, or `.css`. */
  readonly surface: "markup" | "stylesheet";
  readonly run: Check;
}

const markup = (rule: DeslopRule, run: Check): DeslopCheck => ({ rule, surface: "markup", run });
const sheet = (rule: DeslopRule, run: Check): DeslopCheck => ({ rule, surface: "stylesheet", run });
/** A class-token check reads markup and `@apply` lists alike. */
const both = (rule: DeslopRule, run: Check) => [markup(rule, run), sheet(rule, run)];

export const DESLOP_CHECKS: readonly DeslopCheck[] = [
  ...both(1, tokenCheck(transitionToken)),
  sheet(1, cssTransitionCheck),
  ...both(2, tokenCheck(hoverTransformToken)),
  sheet(2, cssHoverTransformCheck),
  ...both(3, tokenCheck(durationToken)),
  sheet(3, cssDurationCheck),
  markup(4, nestedRadiusCheck),
  markup(5, clippedBorderCheck),
  ...both(6, statusMarkCheck),
  sheet(6, cssAnimationCheck(/\b(?:pulse|ping)\b/, /\.ui-live\b/)),
  markup(7, tintedIconCheck),
  ...both(8, leftBorderCheck),
  ...both(9, oneHueCheck),
  markup(10, moodBadgeCheck),
  ...both(11, tokenCheck(spinnerToken)),
  sheet(11, cssAnimationCheck(/\bspin\b/, /\.ui-live\b/)),
  ...both(12, tokenCheck(spacingToken)),
  ...both(13, tokenCheck(textSizeToken)),
  ...both(14, tokenCheck(uppercaseToken)),
  markup(14, eyebrowSiblingCheck),
  sheet(14, cssUppercaseCheck),
  markup(15, tabularCheck),
  markup(16, monoLabelCheck),
  sheet(16, cssHookMonoCheck),
  markup(17, nestedSurfaceCheck),
  ...both(18, decorationCheck),
  sheet(18, cssDecorationCheck),
  ...both(19, tokenCheck(shadowToken)),
  ...both(20, tokenCheck(paletteToken)),
  markup(20, hexCheck),
  markup(21, emojiCheck),
  markup(22, pageHeaderCheck),
];

/**
 * Every hit of one rule across the files, both surfaces unless one is named, sorted by file and
 * line. Each occurrence counts once: two identical classes on one line are two hits.
 */
export function deslopHits(
  files: readonly SourceFile[],
  rule: DeslopRule,
  policy: DeslopPolicy,
  surface?: "markup" | "stylesheet",
): DeslopHit[] {
  const hits: DeslopHit[] = [];
  for (const file of files) {
    const analysis = analyzeFile(file);
    for (const check of DESLOP_CHECKS) {
      if (check.rule !== rule || check.surface !== analysis.surface) continue;
      if (surface !== undefined && check.surface !== surface) continue;
      for (const { line, found } of check.run(analysis, policy)) {
        hits.push({ rule, file: file.id, line, found });
      }
    }
  }
  return hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Allowlists
// ---------------------------------------------------------------------------

/**
 * Exempted occurrences, by root-relative file path, then rule: how many hits the file still holds
 * and the wave that removes them — `"features/chat/foo.tsx": { 13: [4, "W6"] }`.
 */
export type DeslopAllowlist = Readonly<
  Record<string, Partial<Readonly<Record<DeslopRule, readonly [count: number, wave: string]>>>>
>;

/**
 * One rule's hits against an allowlist, as lines to print: empty when they agree. A file with no
 * entry must hold no hits; a file with an entry must hold exactly its count — more is new slop,
 * fewer means the entry shrinks in the same change, so the list only tightens.
 */
export function allowlistProblems(
  hits: readonly DeslopHit[],
  rule: DeslopRule,
  allowlist: DeslopAllowlist,
  relOf: (hit: DeslopHit) => string,
): string[] {
  const byFile = new Map<string, DeslopHit[]>();
  for (const found of hits) byFile.set(relOf(found), [...(byFile.get(relOf(found)) ?? []), found]);
  const problems: string[] = [];
  for (const [rel, list] of byFile) {
    const entry = allowlist[rel]?.[rule];
    const where = list.map((f) => `\n    ${f.file}:${f.line}  ${f.found}`).join("");
    if (entry === undefined) problems.push(`${rel}: ${list.length} new${where}`);
    else if (list.length > entry[0]) {
      problems.push(
        `${rel}: ${list.length} where ${entry[0]} are allowlisted (${entry[1]})${where}`,
      );
    } else if (list.length < entry[0]) {
      problems.push(
        `${rel}: ${list.length} left of ${entry[0]} — shrink the entry to [${list.length}, "${entry[1]}"]`,
      );
    }
  }
  for (const [rel, rules] of Object.entries(allowlist)) {
    const entry = rules[rule];
    if (entry !== undefined && !byFile.has(rel)) {
      problems.push(`${rel}: none left of ${entry[0]} (${entry[1]}) — delete the entry`);
    }
  }
  return problems.sort();
}
