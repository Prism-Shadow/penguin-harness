/**
 * Plugins the site lists without bundling them: the rows of the published plugin index — the
 * document the server reads, a flat array of per-version entries — whose package is not one of
 * this repository's plugins/. Each lists once, at its newest version, from what its row says: its
 * names and descriptions, category, version, author, licence, repository and the day it was last
 * updated. The build downloads no package, so such a plugin has no README, Skills, hook points or
 * quick start, and no icon (an index row's SVG is not taken from the network, as the server does
 * not take it either); the market document may name a cover, screenshots and a raster icon for it.
 *
 * Its page id follows the market's asset folders: the bare name for a `@penguinharness/` package,
 * `<scope>__<name>` for any other scoped one.
 */
import { indexChannelOf, newestPerName } from "../../../server/src/plugin/index-document.ts";
import { readAuthor } from "./read.mjs";

/** A page id: one path segment the route shells can be written under. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** The index keywords that say what a package carries before it is installed. */
const CONTENTS = new Map([
  ["skill", "skills"],
  ["skills", "skills"],
  ["hook", "hooks"],
  ["hooks", "hooks"],
  ["workbench", "workbenches"],
  ["workbenches", "workbenches"],
]);
/** The page id of a package listed by the index. */
export function rowId(name) {
  const scoped = /^@([^/]+)\/(.+)$/.exec(name);
  if (scoped === null) return name;
  return scoped[1] === "penguinharness" ? scoped[2] : `${scoped[1]}__${scoped[2]}`;
}

const text = (value) => (typeof value === "string" && value.trim() !== "" ? value : undefined);
/** A link the page may draw: an absolute http(s) URL, never another scheme from the network. */
const webLink = (value) =>
  typeof value === "string" && /^https?:\/\//.test(value) ? value : undefined;

/** A row's first author, the homepage kept only when it is a web link. */
function rowAuthor(row) {
  const author = row.authors.length > 0 ? readAuthor(row.authors[0]) : undefined;
  if (author === undefined) return undefined;
  const homepage = webLink(author.homepage);
  return homepage !== undefined ? { name: author.name, homepage } : { name: author.name };
}

/** The plugin record a row stands for, in the shape `readPlugins` gives a bundled package. */
function rowPlugin(row, id) {
  const contents = (row.keywords ?? []).flatMap((keyword) => CONTENTS.get(keyword) ?? []);
  const { channel } = indexChannelOf(row);
  const sourceUrl = webLink(row.repository) ?? webLink(row.homepage);
  return {
    id,
    packageName: row.name,
    title: text(row.title) ?? id,
    titleZh: text(row.titleZh),
    description: row.description,
    descriptionZh: text(row.descriptionZh),
    // A row with no one-liner in either language is summed up by its description in each.
    short: text(row.shortDescription) ?? row.description,
    shortZh:
      text(row.shortDescriptionZh) ??
      (text(row.shortDescription) === undefined ? text(row.descriptionZh) : undefined),
    category: text(row.categories?.[0]) ?? "other",
    version: row.version,
    license: text(row.license),
    author: rowAuthor(row),
    preinstall: false,
    bundled: false,
    references: [],
    skills: [],
    hooks: [],
    workbenches: [],
    ...(channel?.url.startsWith("https://") ? { archiveUrl: channel.url } : {}),
    ...(sourceUrl !== undefined ? { sourceUrl } : {}),
    ...(contents.length > 0 ? { contents: [...new Set(contents)] } : {}),
    ...(row.updatedAt !== undefined && Number.isFinite(row.updatedAt)
      ? { updated: new Date(row.updatedAt * 1000).toISOString().slice(0, 10) }
      : {}),
  };
}

/**
 * The plugins `rows` list that `library` (the bundled plugins) does not carry: one per package, at
 * its newest version, in package-name order. A row whose id is not a path segment, or is already
 * taken, is left out with a warning.
 */
export function indexPlugins(rows, library) {
  const bundled = new Set(library.map((plugin) => plugin.packageName));
  const newest = newestPerName(rows).filter((row) => !bundled.has(row.name));
  const taken = new Set(library.map((plugin) => plugin.id));
  const plugins = [];
  for (const row of newest.sort((a, b) => a.name.localeCompare(b.name))) {
    const id = rowId(row.name);
    if (!ID.test(id) || taken.has(id)) {
      console.warn(
        `[penguin:hub] the plugin index lists ${row.name}, whose page id "${id}" is not usable; it is left out.`,
      );
      continue;
    }
    taken.add(id);
    plugins.push(rowPlugin(row, id));
  }
  return plugins;
}
