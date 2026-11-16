/**
 * The cascade layers a stylesheet names, in the order it first names each: what fixes their
 * priority. A layer's place is set by the first mention the page sees, in whichever sheet comes
 * first, and a later statement cannot move it.
 *
 * That is why a pack's stylesheet is served with the app's own order in front of it. The pre-paint
 * script writes a picked pack's link early, so after a reload the pack's sheet comes before the
 * app's; were it to open `ui-theme` first, `ui-theme` would sit under the app's other layers
 * (Tailwind's `utilities` among them) and the base would beat the pack. Naming the app sheet's
 * whole order first leaves the page with the order the app sheet alone gives it, whichever sheet
 * arrives first. The order is the served build's — Tailwind's layers ahead of the theme's four —
 * so the server reads it from the sheet it serves and prepends it as it serves the pack, and no
 * stored file holds a fact of the build that a later build could make wrong.
 */
import { createHash } from "node:crypto";
import { childrenOf, parseCss, type CssAtrule, type CssNamed, type CssNode } from "./css-tree.js";

const light = {
  positions: false,
  filename: "",
  parseCustomProperty: false,
  parseValue: false,
  parseRulePrelude: false,
  onParseError: () => {},
} as const;

/** The top-level layer names a stylesheet mentions, in the order it first mentions each. */
export function layerOrder(css: string): string[] {
  const seen: string[] = [];
  const mention = (name: string) => {
    if (!seen.includes(name)) seen.push(name);
  };
  const named = (prelude: CssNode | null) => {
    if (prelude === null) return;
    for (const node of childrenOf(prelude)) {
      if (node.type === "Layer") mention((node as CssNamed).name);
      else named(node);
    }
  };
  const visit = (node: CssNode, insideLayer: boolean) => {
    for (const child of childrenOf(node)) {
      if (child.type !== "Atrule") continue;
      const at = child as CssAtrule;
      const name = at.name.toLowerCase();
      // A layer named inside another one is a sub-layer of it: it does not order the top.
      if ((name === "layer" || name === "import") && !insideLayer) named(at.prelude);
      if (at.block !== null) visit(at.block, insideLayer || name === "layer");
    }
  };
  visit(parseCss(css, light), false);
  return seen;
}

/** The statement that fixes `layers` in this order: `@layer a,b,c;`, or nothing for none. */
export const layerStatement = (layers: readonly string[]): string =>
  layers.length === 0 ? "" : `@layer ${layers.join(",")};`;

/**
 * The version a pack's stylesheet is served at under a build: the pack's content version (`v`)
 * mixed with the layer order the build puts in front of it, hex, 8 characters. A build that
 * changes the order changes the address, so no browser keeps a copy it cached under the old one;
 * the same pack under the same build keeps one address.
 */
export function servedVersion(v: string, layers: readonly string[]): string {
  return createHash("sha256")
    .update(`${v}\0${layers.join(",")}`)
    .digest("hex")
    .slice(0, 8);
}
