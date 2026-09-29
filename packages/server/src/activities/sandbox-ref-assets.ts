/**
 * Putting a ref's own media into the module the preview serves.
 *
 * Refs of one product share a module, so the module declares the canonical ref's assets.
 * Every other ref is that same module pointed at different media — which is the whole
 * reason the product level exists. The preview has to overlay the ref's manifest onto the
 * shared declaration, or every ref of a product would play the canonical ref's audio.
 *
 * Two things make it more than a merge. A ref may call an asset by a different key than the
 * module does, so the module's key has to keep working. And the browser caches by URL, so a
 * regenerated clip at the same path would keep playing the old sound until someone cleared
 * their cache.
 */

/** Where the framework substitutes the media root. Loom's token, and the modules read it. */
const MEDIA_TOKEN = "{{MEDIA}}";

export interface ManifestAsset {
  key: string;
  type: string;
  /** Path under the media root, as the manifest writes it. */
  path?: string;
  description?: string;
  /** The module's key for this asset, when the ref renamed it. */
  sourceKey?: string;
  /** `bookIntro` and `bookWord` are handled by the book configuration, not the declaration. */
  role?: string;
  languageCode?: string;
}

export interface DeclarationAsset {
  type: string;
  url: string;
  description?: string;
  [key: string]: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The URL a module asks for, optionally carrying a version.
 *
 * Empty for anything not under the media root: a path pointing outside it is not a media
 * asset, and serving it from the media route would be a way out of the media root.
 */
export function mediaUrl(asset: ManifestAsset, versionToken: VersionToken = ""): string {
  const relative = text(asset.path).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relative.startsWith("media/")) return "";
  const url = `${MEDIA_TOKEN}/${relative.slice("media/".length)}`;
  const version = typeof versionToken === "function" ? versionToken(asset) : versionToken;
  return version ? `${url}?v=${version}` : url;
}

/**
 * A URL's `?v=`: one token for every asset, or one per asset — the file's own, so the
 * media route can tell a URL naming the bytes on disk from one that does not.
 */
export type VersionToken = string | ((asset: ManifestAsset) => string);

/**
 * Whether this asset belongs in the module's declaration at all.
 *
 * Video other than a book's intro, and a book's per-word audio, are addressed by the book
 * configuration and the module's own code rather than declared — Loom leaves them out, and
 * declaring them here would have the framework preload media the module fetches itself.
 */
export function declarable(asset: ManifestAsset): boolean {
  if (asset.role === "bookWord") return false;
  if (text(asset.type) === "video" && asset.role !== "bookIntro") return false;
  return Boolean(text(asset.key) && text(asset.type) && mediaUrl(asset));
}

/** One declaration entry, keeping whatever the module already said about the asset. */
export function declarationAsset(
  asset: ManifestAsset,
  existing: DeclarationAsset | undefined,
  versionToken: VersionToken = "",
): DeclarationAsset | null {
  if (!declarable(asset)) return null;
  return {
    ...(existing ?? {}),
    type: text(asset.type),
    url: mediaUrl(asset, versionToken),
    ...(asset.description ? { description: String(asset.description) } : {}),
  };
}

/**
 * The module's key for each ref key that renamed one.
 *
 * A ref that renames an asset must still answer to the module's key, because the module
 * code is shared and refers to its own. A rename to the same name is not a rename.
 */
export function aliasesByRefKey(
  assets: readonly ManifestAsset[],
  derived: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const asset of assets) {
    if (asset.role === "bookWord") continue;
    const key = text(asset.key);
    const source = text(asset.sourceKey) || derived.get(`${text(asset.type)}:${key}`) || "";
    if (key && source && key !== source) aliases.set(key, source);
  }
  return aliases;
}

/**
 * The shared declaration with this ref's media in it, under both keys.
 *
 * Returns a new declaration: the module's declaration is read once and served to every ref
 * of the product, so overlaying in place would give ref 2 the media of whichever ref was
 * previewed last.
 */
export function overlayRefAssets(
  declaration: Record<string, unknown>,
  assets: readonly ManifestAsset[],
  aliases: ReadonlyMap<string, string>,
  versionToken: VersionToken = "",
): Record<string, unknown> {
  const existing =
    declaration.assets &&
    typeof declaration.assets === "object" &&
    !Array.isArray(declaration.assets)
      ? (declaration.assets as Record<string, DeclarationAsset>)
      : {};
  const overlaid: Record<string, DeclarationAsset> = { ...existing };
  for (const asset of assets) {
    const key = text(asset.key);
    const entry = declarationAsset(asset, overlaid[key], versionToken);
    if (entry) overlaid[key] = entry;
    const source = aliases.get(key);
    if (!source) continue;
    const aliased = declarationAsset({ ...asset, key: source }, overlaid[source], versionToken);
    if (aliased) overlaid[source] = aliased;
  }
  return { ...declaration, assets: overlaid };
}

/**
 * The versioned URL for each unversioned one this ref's manifest produces.
 *
 * Built from the manifest rather than by rewriting whatever looks like a URL, so a string
 * that merely resembles a media URL is left alone.
 */
export function mediaUrlVersions(
  assets: readonly ManifestAsset[],
  versionToken: VersionToken,
): Map<string, string> {
  const versions = new Map<string, string>();
  for (const asset of assets) {
    const plain = mediaUrl(asset);
    if (plain) versions.set(plain, mediaUrl(asset, versionToken));
  }
  return versions;
}

/**
 * Every media URL in a configuration, versioned.
 *
 * Without this the browser keeps playing a regenerated clip's old sound, because the path
 * did not change. Walks the whole configuration because a module may put a URL anywhere in
 * its own shape, and only replaces strings the manifest actually produced.
 */
export function versionMediaUrls(value: unknown, versions: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return versions.get(value) ?? value;
  if (Array.isArray(value)) return value.map((child) => versionMediaUrls(child, versions));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        versionMediaUrls(child, versions),
      ]),
    );
  return value;
}

/**
 * A renamed asset reachable under the module's key inside a language group.
 *
 * The declaration overlay covers assets the module declares; this covers the ones a module
 * reads straight out of its configuration. Only the language group the asset belongs to is
 * touched — writing a Spanish clip into the English group is how an activity ends up
 * speaking the wrong language.
 */
export function applyAliasesToLanguageGroups(
  configuration: Record<string, unknown>,
  assets: readonly ManifestAsset[],
  aliases: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const groups = Object.entries(configuration).filter(
    ([key, value]) =>
      /^[a-z]{2}-[A-Z]{2}$/.test(key) &&
      Boolean(value) &&
      typeof value === "object" &&
      !Array.isArray(value),
  ) as [string, Record<string, unknown>][];
  if (!groups.length) return configuration;

  const next: Record<string, unknown> = { ...configuration };
  for (const [language, group] of groups) {
    let updated: Record<string, unknown> | null = null;
    for (const asset of assets) {
      const key = text(asset.key);
      const source = aliases.get(key);
      if (!source || text(asset.languageCode) !== language) continue;
      const value = group[key] ?? mediaUrl(asset);
      if (value === null || value === undefined || value === "") continue;
      updated = { ...(updated ?? group), [source]: value };
    }
    if (updated) next[language] = updated;
  }
  return next;
}

/**
 * Every `{{MEDIA}}` in a composed payload, pointed at where this preview serves media.
 *
 * Loom resolved the token to `/media` because its sandbox owned the whole origin. A preview
 * here lives under a per-activity path, so the token becomes that path: a URL the module
 * puts straight into an `<img>` has to work without the framework's help.
 */
export function resolveMediaToken(value: unknown, mediaBase: string): unknown {
  if (typeof value === "string")
    return value.includes(MEDIA_TOKEN) ? value.replaceAll(MEDIA_TOKEN, mediaBase) : value;
  if (Array.isArray(value)) return value.map((child) => resolveMediaToken(child, mediaBase));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, resolveMediaToken(child, mediaBase)]),
  );
}
