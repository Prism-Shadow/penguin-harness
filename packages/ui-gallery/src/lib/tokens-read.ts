/**
 * Which contract tokens a rendered composition reads, measured from the page's own CSS: every style
 * rule that matches the composition or something inside it contributes the `--ui-*` names its
 * declarations reference, and so do inline `style` attributes. A theme's token blocks define names
 * and never match inside a card, and the base rules on `body` match outside it, so neither counts.
 *
 * A composition built from static stand-ins declares no `tokensUsed`, so this is what the tokens
 * drawer lists until each part's demo does. Selectors are matched structurally: dynamic states
 * (`:hover`, `:focus-visible`, …) and pseudo-elements are dropped first, so a hover colour or an
 * `::after` bar counts for the element that would show it.
 */
import { TOKEN_NAMES } from "@prismshadow/penguin-ui";

const CONTRACT = new Set<string>(TOKEN_NAMES);
const ORDER = new Map<string, number>(TOKEN_NAMES.map((name, i) => [name, i]));

/** The contract names a chunk of CSS references through `var()`, in contract order. */
export function tokenNamesIn(css: string): string[] {
  const names = new Set<string>();
  for (const match of css.matchAll(/var\(\s*(--ui-[a-z0-9-]+)/g)) {
    if (CONTRACT.has(match[1]!)) names.add(match[1]!);
  }
  return sortTokens(names);
}

export function sortTokens(names: Iterable<string>): string[] {
  return [...names].sort((a, b) => (ORDER.get(a) ?? 1e9) - (ORDER.get(b) ?? 1e9));
}

const DYNAMIC =
  /:(?:hover|active|focus|focus-visible|focus-within|visited|checked|placeholder-shown|disabled|enabled|open|popover-open)(?![\w-])/g;
const PSEUDO_ELEMENT =
  /::?(?:before|after|placeholder|selection|marker|backdrop|file-selector-button|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+)(?:\([^)]*\))?/g;

/**
 * A selector ready for `querySelector`: nesting `&` replaced by its parent, dynamic pseudo-classes
 * and pseudo-elements removed. Null when nothing matchable is left.
 */
export function matchableSelector(selector: string, parent: string | null): string | null {
  let s = selector;
  if (parent !== null)
    s = s.includes("&") ? s.replaceAll("&", `:is(${parent})`) : `:is(${parent}) ${s}`;
  s = s.replace(PSEUDO_ELEMENT, "").replace(DYNAMIC, "").trim();
  // Nothing left of a compound, or the universal base rule every element matches (scrollbars).
  if (s === "" || s === "*" || /(?:^|[\s,>+~(])(?:,|\)|$)/.test(s)) return null;
  return s;
}

/** A style rule as this walk reads it: the DOM's own rules satisfy it, and so can a test's. */
export interface CssRuleLike {
  readonly selectorText?: string;
  readonly style?: { readonly cssText: string };
  readonly cssRules?: ArrayLike<CssRuleLike>;
}

/** What a measurement found: the tokens, and how many selectors could not be read. */
export interface TokenReading {
  readonly names: string[];
  /** Selectors the probe could not parse. Their rules' tokens are missing from `names`. */
  readonly unreadable: number;
}

/**
 * The contract tokens a set of stylesheets contributes to whatever `probe` accepts, and the count
 * of selectors `probe` could not read. Pure over its arguments: the DOM is the caller's.
 */
export function tokensFromRules(
  sheets: Iterable<ArrayLike<CssRuleLike>>,
  probe: (selector: string) => boolean,
): TokenReading {
  const found = new Set<string>();
  let unreadable = 0;
  const matches = (selector: string) => {
    try {
      return probe(selector);
    } catch {
      // A selector the engine will not parse: counted, never silently read as "does not match".
      unreadable++;
      return false;
    }
  };
  const collect = (css: string, selector: string) => {
    if (css.includes("--ui-") && matches(selector)) {
      for (const name of tokenNamesIn(css)) found.add(name);
    }
  };
  const visit = (rules: ArrayLike<CssRuleLike>, parent: string | null) => {
    for (const rule of Array.from(rules)) {
      if (rule.selectorText !== undefined) {
        // A style rule, possibly nested (Tailwind writes `&:hover { … }` inside its utility).
        const selector = matchableSelector(rule.selectorText, parent);
        if (selector === null) continue;
        collect(rule.style?.cssText ?? "", selector);
        if (rule.cssRules?.length) visit(rule.cssRules, selector);
      } else if (rule.style !== undefined && parent !== null) {
        // Declarations nested in an at-rule inside a style rule apply to that rule's selector.
        collect(rule.style.cssText, parent);
      } else if (rule.cssRules !== undefined) {
        visit(rule.cssRules, parent);
      }
    }
  };
  for (const rules of sheets) visit(rules, null);
  return { names: sortTokens(found), unreadable };
}

/** The contract tokens the subtree at `root` reads, in contract order. */
export function tokensReadBy(root: Element): TokenReading {
  const doc = root.ownerDocument;
  const sheets: ArrayLike<CssRuleLike>[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      sheets.push(Array.from(sheet.cssRules) as unknown as CssRuleLike[]);
    } catch {
      // A cross-origin sheet hides its rules; the gallery loads none.
    }
  }
  const reading = tokensFromRules(sheets, (selector) => {
    return root.matches(selector) || root.querySelector(selector) !== null;
  });
  const found = new Set(reading.names);
  for (const el of [root, ...Array.from(root.querySelectorAll("[style]"))]) {
    for (const name of tokenNamesIn(el.getAttribute("style") ?? "")) found.add(name);
  }
  return { names: sortTokens(found), unreadable: reading.unreadable };
}
