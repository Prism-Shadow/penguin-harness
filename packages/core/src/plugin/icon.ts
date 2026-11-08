/**
 * A plugin's icon: an SVG inside its package, inlined by the Web App into every card and dialog
 * that shows the plugin and written beside every Skill and hook package it installs. Read only
 * when it is safe to inline; anything else costs the plugin its icon (the UI's puzzle glyph), never
 * the page its safety.
 */
import fs from "node:fs";
import path from "node:path";

/** The most an icon may weigh: it is inlined into every card and dialog that shows it. */
export const MAX_PLUGIN_ICON_BYTES = 64 * 1024;

/**
 * What an icon may not contain, case-insensitively, anywhere in its text: script, an embedded
 * document, a reference to anything outside itself (an href of any kind, a CSS `url()` that is not
 * a fragment, an import), an event handler, an entity declaration. A deny-list over the raw text,
 * like the Web App's own check: a false positive costs a puzzle glyph, a miss costs script in the
 * page.
 */
const UNSAFE_SVG: readonly RegExp[] = [
  /<script/i,
  /<foreignobject/i,
  /<iframe/i,
  /<embed/i,
  /<object/i,
  /<use[\s/>]/i,
  /href\s*=/i,
  /javascript:/i,
  /data:text\/html/i,
  /[\s"'/]on[a-z]+\s*=/i,
  /<!entity/i,
  /@import/i,
  /url\(\s*(?!['"]?\s*#)/i,
];

/** An SVG's text from its root element on: no byte-order mark, XML declaration or whitespace before `<svg`. */
function svgFromRoot(text: string): string {
  return text.replace(/^﻿/, "").replace(/^\s*(?:<\?xml[^>]*\?>\s*)?/i, "");
}

/**
 * Whether an SVG may be inlined into the page as a plugin's icon: it begins with `<svg` (after
 * an optional XML declaration and whitespace) and holds nothing UNSAFE_SVG names.
 */
export function isSafeIconSvg(text: string): boolean {
  const body = svgFromRoot(text);
  if (!/^<svg[\s>]/i.test(body)) return false;
  return !UNSAFE_SVG.some((rule) => rule.test(body));
}

/**
 * A package's icon: the SVG its card's `icon` names, else `icon.svg` at the package root when
 * there is one. Read only when the file stays inside the package (a symlink is not followed),
 * weighs at most MAX_PLUGIN_ICON_BYTES and passes isSafeIconSvg; otherwise no icon (the UI's
 * puzzle glyph), with a warning saying why. A package with no icon at all has none, silently. The
 * icon is the text from its `<svg` root on: the Web App inlines only markup that begins there, so
 * an XML declaration the file opens with is left behind rather than costing the icon.
 */
export function readPluginIcon(
  dir: string,
  declared: string | undefined,
): { icon?: string; warnings: string[] } {
  const rel = declared ?? "icon.svg";
  const key = declared !== undefined ? `card.icon (${declared})` : "icon.svg";
  const abs = path.resolve(dir, rel);
  const inside = path.relative(dir, abs);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
    return { warnings: [`${key} is not a file inside the package; ignored`] };
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return { warnings: declared !== undefined ? [`${key} does not exist; ignored`] : [] };
  }
  if (!stat.isFile()) return { warnings: [`${key} is not a plain file; ignored`] };
  if (stat.size > MAX_PLUGIN_ICON_BYTES) {
    return { warnings: [`${key} is larger than ${MAX_PLUGIN_ICON_BYTES / 1024} KiB; ignored`] };
  }
  const icon = svgFromRoot(fs.readFileSync(abs, "utf8"));
  if (!isSafeIconSvg(icon)) {
    return {
      warnings: [
        `${key} is not a plain SVG (script, event handlers, links and external references are refused); ignored`,
      ],
    };
  }
  return { icon, warnings: [] };
}
