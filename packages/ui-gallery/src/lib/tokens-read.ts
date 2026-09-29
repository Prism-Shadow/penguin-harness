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

/** The contract tokens the subtree at `root` reads, in contract order. */
export function tokensReadBy(root: Element): string[] {
  const doc = root.ownerDocument;
  const found = new Set<string>();
  const matches = (selector: string) => {
    try {
      return root.matches(selector) || root.querySelector(selector) !== null;
    } catch {
      return false;
    }
  };
  const collect = (css: string, selector: string) => {
    if (css.includes("--ui-") && matches(selector)) {
      for (const name of tokenNamesIn(css)) found.add(name);
    }
  };
  const visit = (rules: CSSRuleList, parent: string | null) => {
    for (const rule of Array.from(rules)) {
      if ("selectorText" in rule) {
        // A style rule, possibly nested (Tailwind writes `&:hover { … }` inside its utility).
        const style = rule as CSSStyleRule;
        const selector = matchableSelector(style.selectorText, parent);
        if (selector === null) continue;
        collect(style.style.cssText, selector);
        if (style.cssRules?.length) visit(style.cssRules, selector);
      } else if ("style" in rule && parent !== null) {
        // Declarations nested in an at-rule inside a style rule apply to that rule's selector.
        collect((rule as CSSStyleRule).style.cssText, parent);
      } else if ("cssRules" in rule) {
        visit((rule as CSSGroupingRule).cssRules, parent);
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      visit(sheet.cssRules, null);
    } catch {
      // A cross-origin sheet hides its rules; the gallery loads none.
    }
  }
  for (const el of [root, ...Array.from(root.querySelectorAll("[style]"))]) {
    for (const name of tokenNamesIn(el.getAttribute("style") ?? "")) found.add(name);
  }
  return sortTokens(found);
}
