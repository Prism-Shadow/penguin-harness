/**
 * What an SVG icon may hold, and whether it is monochrome.
 *
 * An icon never enters a page as markup: the Web App draws it with `<img>` or as a CSS mask, and
 * an SVG drawn either way runs no script and loads nothing. The deny-list below is defence in
 * depth for the one other way an SVG is seen, opened on its own in a tab (where the serving
 * route's sandbox applies too). It runs over the raw text, case-insensitively: a false positive
 * costs a plugin its icon, a miss costs nothing the two layers above it do not already stop.
 *
 * Monochrome is what lets a line icon take the text colour, the way the built-in plugin icons
 * always have: when every paint the SVG names is `currentColor` or `none`, it is drawn as a mask
 * filled with the colour of the text around it. Any other SVG is drawn as itself.
 */

/**
 * What an icon may not contain anywhere in its text: script, an embedded document, an animation
 * (which can rewrite an attribute into a link), a reference to anything outside itself (an href
 * of any kind, a CSS `url()` that is not a fragment, an import), an event handler, an entity
 * declaration.
 */
const UNSAFE_SVG: readonly RegExp[] = [
  /<script/i,
  /<foreignobject/i,
  /<iframe/i,
  /<embed/i,
  /<object/i,
  /<use[\s/>]/i,
  /<animate/i,
  /<set[\s/>]/i,
  /<handler/i,
  /<listener/i,
  /href\s*=/i,
  /javascript:/i,
  /data:text\/html/i,
  /[\s"'/]on[a-z]+\s*=/i,
  /<!entity/i,
  /@import/i,
  /url\(\s*(?!['"]?\s*#)/i,
];

/** Whether an SVG's text holds nothing UNSAFE_SVG names. */
export function isSafeIconSvg(text: string): boolean {
  return !UNSAFE_SVG.some((rule) => rule.test(text));
}

/** The properties that paint: what decides whether an icon is one colour. */
const PAINTS = "fill|stroke|color|stop-color|flood-color|lighting-color";
/** A paint written as an attribute: `fill="none"`, `stroke='currentColor'`, `fill=none`. */
const PAINT_ATTRIBUTE = new RegExp(
  `(?:^|[\\s"'/])(?:${PAINTS})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>/]+))`,
  "gi",
);
/** A paint written as CSS, in a `style` attribute or a `<style>` element: `fill: none`. */
const PAINT_DECLARATION = new RegExp(`(?:^|[\\s;{"'])(?:${PAINTS})\\s*:\\s*([^;}"'<>]+)`, "gi");

/**
 * Whether an SVG is monochrome: it names at least one paint, and every paint it names is
 * `currentColor` or `none`. One that names none paints in the SVG default, black, which is a
 * colour of its own rather than the text's.
 */
export function isTintableSvg(text: string): boolean {
  const values: string[] = [];
  for (const m of text.matchAll(PAINT_ATTRIBUTE)) values.push(m[1] ?? m[2] ?? m[3] ?? "");
  for (const m of text.matchAll(PAINT_DECLARATION)) values.push(m[1] ?? "");
  const normal = values.map((v) =>
    v
      .replace(/!important/i, "")
      .trim()
      .toLowerCase(),
  );
  return (
    normal.includes("currentcolor") && normal.every((v) => v === "currentcolor" || v === "none")
  );
}
