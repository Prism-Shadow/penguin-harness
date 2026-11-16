/**
 * css-tree's parser, generator and identifier decoder, typed by what this package reads of them.
 *
 * Imported by subpath on purpose: the package's main entry loads the lexer and its syntax data
 * through `createRequire`, which a bundle cannot carry (the hot push compiles the platform into
 * one file that runs outside any `node_modules`). The parser, the generator and the utils need
 * none of it.
 */
// @ts-expect-error -- css-tree 3 ships no declarations; the types below are the part read here.
import parseUntyped from "css-tree/parser";
// @ts-expect-error -- as above.
import generateUntyped from "css-tree/generator";
// @ts-expect-error -- as above.
import { ident as identUntyped } from "css-tree/utils";

export interface CssPosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface CssLocation {
  readonly start: CssPosition;
  readonly end: CssPosition;
}

/** css-tree's linked list of child nodes. */
export interface CssList<T> {
  toArray(): T[];
  readonly isEmpty: boolean;
}

/**
 * A node of the tree, loosely: `type` says which, and the fields a type carries are read through
 * the narrower interfaces below after a check of `type`.
 */
export interface CssNode {
  readonly type: string;
  readonly loc?: CssLocation | null;
}

export interface CssParent extends CssNode {
  readonly children: CssList<CssNode> | null;
}

export interface CssRule extends CssNode {
  readonly type: "Rule";
  readonly prelude: CssNode;
  readonly block: CssParent;
}

export interface CssAtrule extends CssNode {
  readonly type: "Atrule";
  readonly name: string;
  readonly prelude: CssParent | null;
  readonly block: CssParent | null;
}

export interface CssDeclaration extends CssNode {
  readonly type: "Declaration";
  readonly important: boolean | string;
  readonly property: string;
  readonly value: CssNode;
}

export interface CssNamed extends CssNode {
  readonly name: string;
}

export interface CssAttributeSelector extends CssNode {
  readonly type: "AttributeSelector";
  readonly name: CssNamed;
  readonly matcher: string | null;
  readonly value: (CssNode & { readonly value?: string; readonly name?: string }) | null;
  readonly flags: string | null;
}

export interface CssUrl extends CssNode {
  readonly type: "Url";
  value: string;
}

export interface CssValued extends CssNode {
  readonly value: string;
}

export interface CssParseError {
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export interface CssParseOptions {
  readonly positions: boolean;
  readonly filename: string;
  readonly parseCustomProperty: boolean;
  /** Declaration values parsed into nodes (css-tree's default) or kept as Raw. */
  readonly parseValue?: boolean;
  /** Rule selectors parsed into nodes (css-tree's default) or kept as Raw. */
  readonly parseRulePrelude?: boolean;
  readonly onParseError: (error: CssParseError, fallback: CssNode | null) => void;
}

export const parseCss = parseUntyped as (source: string, options: CssParseOptions) => CssParent;
export const generateCss = generateUntyped as (node: CssNode) => string;
/** An identifier with its CSS escapes resolved: `site\2d ui` is `site-ui`. */
export const decodeIdent = (identUntyped as { decode(text: string): string }).decode;

/** A node's children, or none. */
export const childrenOf = (node: CssNode): CssNode[] =>
  (node as Partial<CssParent>).children?.toArray() ?? [];
