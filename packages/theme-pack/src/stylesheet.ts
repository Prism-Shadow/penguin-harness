/**
 * One stylesheet of a pack, checked against the grammar (css-grammar.ts) and re-emitted.
 *
 * The browser never receives the uploaded text. It receives what css-tree understood, generated
 * back from the tree: comments and anything a parser could read two ways are gone. A node the
 * parser could not read — css-tree recovers from errors by keeping the text as a `Raw` node — is
 * a refusal, never a pass, and so is every node type the checks below do not name.
 *
 * What each file may hold:
 * - `tokens.css`, `recipes.css`, `sections/<hook>.css`: style rules (nesting included), with
 *   `@media`, `@supports`, `@container`, `@keyframes` and `@property`;
 * - `accents.css`: the same, each rule on a root that names one of the manifest's presets;
 * - `fonts.css`: `@font-face` rules only, their sources the pack's own `fonts/*.woff2`.
 */
import {
  childrenOf,
  decodeIdent,
  generateCss,
  parseCss,
  type CssAtrule,
  type CssAttributeSelector,
  type CssDeclaration,
  type CssNamed,
  type CssNode,
  type CssParent,
  type CssRule,
  type CssUrl,
  type CssValued,
} from "./css-tree.js";
import {
  ATTRIBUTES,
  BRIDGE_VARIABLE,
  DENIED_PROPERTIES,
  FONT_FACE_DESCRIPTORS,
  FUNCTIONS,
  IMAGE_SET_FUNCTIONS,
  LANGUAGE_TAG,
  PLAIN_PSEUDO_CLASSES,
  PROPERTY_DESCRIPTORS,
  PROPERTY_NAME,
  PSEUDO_ELEMENTS,
  REFUSED_AT_RULES,
  SELECTOR_PSEUDO_CLASSES,
  TYPE_SELECTORS,
  privateProperty,
} from "./css-grammar.js";
import { THEME_PACK_LIMITS } from "./limits.js";
import { invalid, type ThemePackError } from "./problem.js";

export type SheetKind = "tokens" | "recipes" | "accents" | "fonts" | "section";

export interface SheetContext {
  /** The file's path in the pack, as the refusal names it. */
  readonly file: string;
  readonly kind: SheetKind;
  /** The section hook a `sections/<hook>.css` skins. */
  readonly hook?: string;
  /** The pack's id: the root every rule starts from. */
  readonly id: string;
  /** The accent presets the manifest lists. */
  readonly presets: ReadonlySet<string>;
  /** The contract's `--ui-*` names. */
  readonly tokens: ReadonlySet<string>;
  /** Every file the pack holds, by path: what a `url()` may name. */
  readonly files: ReadonlySet<string>;
  /** `data:` bytes spent so far by the pack's other stylesheets; this one adds to it. */
  readonly dataBytes: { total: number };
}

export interface CheckedSheet {
  /** The re-emitted text: what the pack stores and what its export carries. */
  readonly css: string;
  /** The parsed tree, for {@link servedCss}. */
  readonly tree: CssParent;
  /** The `url()`s that name a pack file, each holding that file's path. */
  readonly packUrls: readonly CssUrl[];
  /** The accent presets the sheet's roots name (`accents.css`). */
  readonly accents: ReadonlySet<string>;
}

/**
 * A pack's own keyframes: named under its id, or `ui-…` as the built-in packs name theirs
 * (`ui-frost-shimmer`), so an exported built-in imports again once renamed without touching its
 * animations. A pack's stylesheet is linked only while the pack is picked, so a name it shares
 * with the base changes that motion for its own look alone.
 */
const isKeyframesName = (name: string, id: string) =>
  /^[a-z][a-z0-9-]*$/.test(name) && (name.startsWith(`${id}-`) || name.startsWith("ui-"));

const at = (node: CssNode | null | undefined) =>
  node?.loc ? { line: node.loc.start.line, column: node.loc.start.column } : null;

/** The value an attribute selector compares with, quoted or bare. */
const attributeValue = (node: CssAttributeSelector): string | null =>
  node.value === null ? null : (node.value.value ?? node.value.name ?? null);

/**
 * Checks one stylesheet and answers it re-emitted, or throws the first refusal with its file,
 * line and column.
 */
export function checkStylesheet(source: string, ctx: SheetContext): CheckedSheet {
  const refuse = (node: CssNode | null | undefined, reason: string) =>
    invalid(ctx.file, reason, at(node));
  const parsed: { error: ThemePackError | null } = { error: null };
  const tree = parseCss(source, {
    positions: true,
    filename: ctx.file,
    parseCustomProperty: true,
    // An error whose recovery kept the text as Raw lost what it could not read; one whose
    // fallback is null was css-tree trying the next reading of a condition, which then parsed.
    onParseError: (error, fallback) => {
      if (parsed.error === null && fallback?.type === "Raw") {
        parsed.error = invalid(ctx.file, `does not parse: ${error.message}`, {
          line: error.line,
          column: error.column,
        });
      }
    },
  });
  if (parsed.error !== null) throw parsed.error;

  const packUrls: CssUrl[] = [];
  const accents = new Set<string>();
  const ownProperty = privateProperty(ctx.id);

  // ---- values ---------------------------------------------------------------------------

  const checkUrl = (node: CssNode, raw: string, place: "font-src" | "image") => {
    if (/^data:/i.test(raw)) {
      if (place === "font-src" || !/^data:image\/(?:svg\+xml|png)[;,]/.test(raw)) {
        throw refuse(node, "a data: URI may only be an SVG or PNG image, and never a font");
      }
      if (raw.length > THEME_PACK_LIMITS.dataUriBytes) {
        throw refuse(node, `a data: image is over ${THEME_PACK_LIMITS.dataUriBytes / 1024} KiB`);
      }
      ctx.dataBytes.total += raw.length;
      if (ctx.dataBytes.total > THEME_PACK_LIMITS.dataUrisBytes) {
        throw refuse(
          node,
          `the pack's data: images add up to over ${THEME_PACK_LIMITS.dataUrisBytes / 1024} KiB`,
        );
      }
      return null;
    }
    const path = raw.startsWith("./") ? raw.slice(2) : raw;
    const relative =
      path !== "" &&
      !/^[a-z][a-z0-9+.-]*:/i.test(path) &&
      !path.startsWith("/") &&
      !/[\\?#]/.test(path) &&
      path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
    if (!relative) {
      throw refuse(
        node,
        `url(${raw}) is refused: a url() names a file of the pack (fonts/…, art/…) or a data: image, nothing on the network`,
      );
    }
    if (place === "font-src" ? !/^fonts\/.+\.woff2$/.test(path) : !path.startsWith("art/")) {
      throw refuse(
        node,
        place === "font-src"
          ? `url(${raw}): a font source is one of the pack's fonts/*.woff2`
          : `url(${raw}): an image is one of the pack's art/ files`,
      );
    }
    if (!ctx.files.has(path)) throw refuse(node, `url(${raw}) names a file the pack does not hold`);
    return path;
  };

  const checkValueNode = (
    node: CssNode,
    place: "font-src" | "image",
    within: string | null,
  ): void => {
    switch (node.type) {
      case "Identifier":
      case "Number":
      case "Dimension":
      case "Percentage":
      case "Hash":
      case "Operator":
      case "WhiteSpace":
      case "UnicodeRange":
      case "Ratio":
        return;
      case "String":
        // In image-set() a bare string is the image's address.
        if (within !== null && IMAGE_SET_FUNCTIONS.has(within)) {
          const path = checkUrl(node, (node as CssValued).value, "image");
          if (path !== null) {
            throw refuse(node, "write an image-set() source as url(…), not as a bare string");
          }
        }
        return;
      case "Url": {
        const url = node as CssUrl;
        const path = checkUrl(node, url.value, place);
        if (path !== null) {
          url.value = path;
          packUrls.push(url);
        }
        return;
      }
      case "Function": {
        const name = (node as CssNamed).name.toLowerCase();
        if (!FUNCTIONS.has(name)) throw refuse(node, `the function ${name}() is not allowed`);
        for (const child of childrenOf(node)) checkValueNode(child, place, name);
        return;
      }
      // A `var()` fallback is a value of its own, checked like the one it sits in.
      case "Value":
      case "Parentheses":
      case "Brackets":
        for (const child of childrenOf(node)) checkValueNode(child, place, within);
        return;
      default:
        throw refuse(node, `this value does not parse as plain CSS (${node.type})`);
    }
  };

  const checkValue = (node: CssNode, place: "font-src" | "image", custom: boolean) => {
    if (node.type !== "Value") throw refuse(node, "this value does not parse");
    const children = childrenOf(node);
    if (!custom && children.every((child) => child.type === "WhiteSpace")) {
      throw refuse(node, "a declaration needs a value");
    }
    for (const child of children) checkValueNode(child, place, null);
  };

  type DeclarationPlace = "style" | "font-face" | "property" | "condition";

  const checkDeclaration = (node: CssNode, place: DeclarationPlace) => {
    if (node.type !== "Declaration") {
      throw refuse(
        node,
        node.type === "Raw" ? "this does not parse as a declaration" : `unexpected ${node.type}`,
      );
    }
    const decl = node as CssDeclaration;
    if (decl.important !== false) throw refuse(node, "!important is refused");
    const property = decl.property;
    const custom = property.startsWith("--");
    if (place === "font-face") {
      if (!FONT_FACE_DESCRIPTORS.has(property)) {
        throw refuse(node, `@font-face may not declare ${property}`);
      }
    } else if (place === "property") {
      if (!PROPERTY_DESCRIPTORS.has(property))
        throw refuse(node, `@property may not declare ${property}`);
    } else if (custom) {
      if (
        !ctx.tokens.has(property) &&
        !BRIDGE_VARIABLE.test(property) &&
        !ownProperty.test(property)
      ) {
        throw refuse(
          node,
          `${property} is not a theme token: a pack sets the contract's --ui-* names, the gray bridge, and its own --_… or --${ctx.id}-… names`,
        );
      }
    } else if (!PROPERTY_NAME.test(property) || DENIED_PROPERTIES.has(property)) {
      throw refuse(node, `the property ${property} is not allowed`);
    }
    if (place === "font-face" && property === "src") {
      const sources = childrenOf(decl.value);
      if (!sources.some((child) => child.type === "Url")) {
        throw refuse(node, "an @font-face src names one of the pack's fonts/*.woff2 with url()");
      }
    }
    checkValue(decl.value, place === "font-face" ? "font-src" : "image", custom);
  };

  // ---- selectors ------------------------------------------------------------------------

  const checkSimple = (node: CssNode): void => {
    switch (node.type) {
      case "Combinator":
      case "NestingSelector":
        return;
      case "TypeSelector": {
        const name = (node as CssNamed).name.toLowerCase();
        if (!TYPE_SELECTORS.has(name))
          throw refuse(node, `the element selector ${name} is not allowed`);
        return;
      }
      case "ClassSelector":
        if (decodeIdent((node as CssNamed).name) === "site-ui") {
          throw refuse(node, "the site chrome (.site-ui) is not a theme's to style");
        }
        return;
      case "IdSelector":
        throw refuse(node, "an id selector is not allowed: select by class or data-* attribute");
      case "AttributeSelector": {
        const attr = node as CssAttributeSelector;
        const name = attr.name.name;
        const known =
          /^[a-z][a-z0-9-]*$/.test(name) &&
          (name.startsWith("data-") || name.startsWith("aria-") || ATTRIBUTES.has(name));
        if (!known) {
          throw refuse(
            node,
            `[${name}] is refused: a selector tests data-*, aria-*, role, type, disabled, open, hidden, lang and dir only`,
          );
        }
        const matcher = attr.matcher;
        if (
          matcher !== null &&
          matcher !== "=" &&
          matcher !== "~=" &&
          !(matcher === "^=" && name === "role")
        ) {
          throw refuse(
            node,
            `[${name}${matcher}…] is refused: an attribute is matched whole (= or ~=)`,
          );
        }
        if (attr.flags !== null) throw refuse(node, "an attribute selector takes no flags");
        return;
      }
      case "PseudoClassSelector": {
        const name = (node as CssNamed).name.toLowerCase();
        const args = childrenOf(node);
        if (PLAIN_PSEUDO_CLASSES.has(name) && (node as CssParent).children === null) return;
        if (SELECTOR_PSEUDO_CLASSES.has(name)) {
          for (const list of args) checkSelectorList(list, true);
          return;
        }
        if (name === "nth-child") {
          for (const nth of args) {
            if (nth.type !== "Nth") throw refuse(nth, ":nth-child() takes An+B");
            const of = (nth as CssNode & { selector: CssNode | null }).selector;
            if (of !== null) checkSelectorList(of, true);
          }
          return;
        }
        if (name === "lang") {
          if (
            args.length === 0 ||
            !args.every(
              (arg) => arg.type === "Identifier" && LANGUAGE_TAG.test((arg as CssNamed).name),
            )
          ) {
            throw refuse(node, ":lang() takes language tags such as zh or en");
          }
          return;
        }
        throw refuse(node, `the pseudo-class :${name} is not allowed`);
      }
      case "PseudoElementSelector": {
        const name = (node as CssNamed).name.toLowerCase();
        if (!PSEUDO_ELEMENTS.has(name) || (node as CssParent).children !== null) {
          throw refuse(node, `the pseudo-element ::${name} is not allowed`);
        }
        return;
      }
      default:
        throw refuse(node, `this selector does not parse as plain CSS (${node.type})`);
    }
  };

  /** A rule at the top of the sheet (or of a condition there) starts at the pack's own root. */
  const checkScope = (selector: CssNode, parts: CssNode[]) => {
    const [root, theme] = parts;
    const scoped =
      root?.type === "PseudoClassSelector" &&
      (root as CssNamed).name.toLowerCase() === "root" &&
      (root as CssParent).children === null &&
      theme?.type === "AttributeSelector" &&
      (theme as CssAttributeSelector).name.name === "data-theme" &&
      (theme as CssAttributeSelector).matcher === "=" &&
      attributeValue(theme as CssAttributeSelector) === ctx.id;
    if (!scoped) {
      throw refuse(selector, `a selector starts with :root[data-theme="${ctx.id}"]`);
    }
    const combinator = parts.findIndex((p) => p.type === "Combinator");
    const compound = combinator < 0 ? parts : parts.slice(0, combinator);
    if (ctx.kind === "accents") {
      const preset = compound.find(
        (p) =>
          p.type === "AttributeSelector" &&
          (p as CssAttributeSelector).name.name === "data-accent" &&
          (p as CssAttributeSelector).matcher === "=",
      ) as CssAttributeSelector | undefined;
      const id = preset ? attributeValue(preset) : null;
      if (id === null || !ctx.presets.has(id)) {
        throw refuse(
          selector,
          id === null
            ? 'an accents.css rule names its preset on the root: [data-accent="<preset>"]'
            : `the preset ${id} is not in pack.json's accent.presets`,
        );
      }
      accents.add(id);
    }
    if (ctx.kind === "section") {
      const hook = `ui-${ctx.hook}`;
      const skins = parts.some(
        (p) => p.type === "ClassSelector" && decodeIdent((p as CssNamed).name) === hook,
      );
      if (!skins) throw refuse(selector, `a rule of sections/${ctx.hook}.css selects .${hook}`);
    }
  };

  function checkSelectorList(list: CssNode, relative: boolean, top = false) {
    if (list.type !== "SelectorList") throw refuse(list, "this selector does not parse");
    for (const selector of childrenOf(list)) {
      if (selector.type !== "Selector") throw refuse(selector, "this selector does not parse");
      const parts = childrenOf(selector);
      if (top && !relative) checkScope(selector, parts);
      for (const part of parts) checkSimple(part);
    }
  }

  // ---- rules ----------------------------------------------------------------------------

  /** A style rule; `nested` when it sits inside another style rule's block. */
  const checkRule = (node: CssRule, nested: boolean) => {
    if (ctx.kind === "fonts") throw refuse(node, "fonts.css holds @font-face rules only");
    checkSelectorList(node.prelude, nested, true);
    checkStyleBlock(node.block);
  };

  function checkStyleBlock(block: CssParent) {
    for (const child of childrenOf(block)) {
      if (child.type === "Declaration") checkDeclaration(child, "style");
      else if (child.type === "Rule") checkRule(child as CssRule, true);
      else if (child.type === "Atrule") checkAtrule(child as CssAtrule, true);
      else throw refuse(child, "this does not parse as a declaration or a rule");
    }
  }

  const checkCondition = (node: CssNode | null): void => {
    if (node === null) return;
    switch (node.type) {
      case "AtrulePrelude":
      case "MediaQueryList":
      case "Condition":
        for (const child of childrenOf(node)) checkCondition(child);
        return;
      case "MediaQuery": {
        const query = node as CssNode & { condition: CssNode | null };
        checkCondition(query.condition);
        return;
      }
      case "Feature": {
        const feature = node as CssNode & { value: CssNode | null };
        if (feature.value !== null) checkValueNode(feature.value, "image", null);
        return;
      }
      case "FeatureRange": {
        const range = node as CssNode & { left: CssNode; middle: CssNode; right: CssNode | null };
        for (const side of [range.left, range.middle, range.right]) {
          if (side !== null) checkValueNode(side, "image", null);
        }
        return;
      }
      case "FeatureFunction": {
        const fn = node as CssNode & { feature: string; value: CssNode };
        if (fn.feature === "selector" && fn.value.type === "Selector") {
          for (const part of childrenOf(fn.value)) checkSimple(part);
          return;
        }
        if (fn.feature === "style") {
          checkDeclaration(fn.value, "condition");
          return;
        }
        throw refuse(node, `${fn.feature}() is not allowed in a condition`);
      }
      case "SupportsDeclaration":
        checkDeclaration((node as CssNode & { declaration: CssNode }).declaration, "condition");
        return;
      case "Identifier":
      case "Number":
      case "Dimension":
      case "Ratio":
        return;
      default:
        throw refuse(node, `this condition does not parse as plain CSS (${node.type})`);
    }
  };

  /** The one identifier an at-rule's prelude names (`@keyframes <name>`), or null. */
  const atRuleName = (node: CssAtrule): string | null => {
    const parts = node.prelude === null ? [] : childrenOf(node.prelude);
    const [only] = parts;
    return parts.length === 1 && only?.type === "Identifier" ? (only as CssNamed).name : null;
  };

  function checkAtrule(node: CssAtrule, nested: boolean) {
    const name = node.name.toLowerCase();
    const refused = REFUSED_AT_RULES[name];
    if (refused !== undefined) throw refuse(node, refused);
    if (name === "font-face") {
      if (ctx.kind !== "fonts" || nested) throw refuse(node, "@font-face belongs in fonts.css");
      if (node.prelude !== null || node.block === null)
        throw refuse(node, "@font-face takes a block alone");
      for (const child of childrenOf(node.block)) checkDeclaration(child, "font-face");
      return;
    }
    if (ctx.kind === "fonts") throw refuse(node, "fonts.css holds @font-face rules only");
    if (name === "media" || name === "supports" || name === "container") {
      if (node.prelude === null || node.block === null)
        throw refuse(node, `@${name} needs a condition and a block`);
      if (node.prelude.type !== "AtrulePrelude")
        throw refuse(node.prelude, "this condition does not parse");
      checkCondition(node.prelude);
      for (const child of childrenOf(node.block)) {
        if (child.type === "Rule") checkRule(child as CssRule, nested);
        else if (child.type === "Atrule") checkAtrule(child as CssAtrule, nested);
        else if (nested && child.type === "Declaration") checkDeclaration(child, "style");
        else throw refuse(child, "this does not parse as a rule");
      }
      return;
    }
    if (nested) throw refuse(node, `@${name} belongs at the top of the file`);
    if (name === "keyframes") {
      const keyframes = atRuleName(node);
      if (keyframes === null || !isKeyframesName(keyframes, ctx.id) || node.block === null) {
        throw refuse(node, `@keyframes names start with ${ctx.id}- or ui-`);
      }
      for (const step of childrenOf(node.block)) {
        if (step.type !== "Rule") throw refuse(step, "a keyframe is a percentage, from or to");
        const rule = step as CssRule;
        if (rule.prelude.type !== "SelectorList")
          throw refuse(step, "a keyframe is a percentage, from or to");
        for (const selector of childrenOf(rule.prelude)) {
          const parts = childrenOf(selector);
          const [only] = parts;
          const keyframe =
            parts.length === 1 &&
            (only?.type === "Percentage" ||
              (only?.type === "TypeSelector" &&
                ["from", "to"].includes((only as CssNamed).name.toLowerCase())));
          if (!keyframe) throw refuse(selector, "a keyframe is a percentage, from or to");
        }
        for (const child of childrenOf(rule.block)) checkDeclaration(child, "style");
      }
      return;
    }
    if (name === "property") {
      const property = atRuleName(node);
      if (property === null || !ownProperty.test(property) || node.block === null) {
        throw refuse(node, `@property names start with --_ or --${ctx.id}-`);
      }
      for (const child of childrenOf(node.block)) checkDeclaration(child, "property");
      return;
    }
    throw refuse(node, `@${name} is not allowed`);
  }

  // ---- the sheet ------------------------------------------------------------------------

  for (const statement of childrenOf(tree)) {
    if (statement.type === "Rule") checkRule(statement as CssRule, false);
    else if (statement.type === "Atrule") checkAtrule(statement as CssAtrule, false);
    else throw refuse(statement, "this does not parse as a rule");
  }
  return { css: generateCss(tree), tree, packUrls, accents };
}
