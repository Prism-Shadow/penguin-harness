/**
 * The theme packs of this server (PRFC-0026 「存储」): imported by an admin, picked by every
 * account, never synced to a machine.
 *
 *   <data root>/themes/<id>/
 *     pack.json         the normalised manifest
 *     tokens.css …      the stylesheets as the validator re-emitted them (kept for the export)
 *     index.css         what the browser loads: the stylesheets in their layers, urls rewritten
 *     fonts/ art/       the binaries as uploaded, after their checks
 *     README.md …       kept, never served
 *     installed.json    { sha256, installedAt, by, api, v, archive, files }
 *   <data root>/themes/archives/<id>-<version>-<sha8>.zip   the upload, for the export
 *
 * `installed.json`'s `files` is the served list: a file is served when it is named there, and the
 * folder is never walked to decide it. A write builds the new folder beside the old one and swaps
 * it in with a rename, so a reader sees one pack or the other, never half of each; writes are
 * taken one at a time.
 *
 * The built-in packs are the build's: their sources travel inside the Web App's files (the UI
 * package's Vite plugin writes `themes/<id>/` and each pack's `fonts.json`), so a built-in exports
 * from the very build this server serves, offline, and the base pack among them says which theme
 * API and which token names an import is checked against.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  BASE_PACK_ID,
  FONTS_MAP_FILE,
  INDEX_FILE,
  MANIFEST_FILE,
  RESERVED_THEME_IDS,
  THEME_PACK_ID,
  builtinExportFiles,
  contractOfBase,
  parseFontsMap,
  parseManifest,
  readPackArchive,
  servedPath,
  validateThemePack,
  writePackArchive,
  type PackFiles,
  type ThemeContract,
  type ThemePackManifest,
} from "@prismshadow/penguin-theme-pack";
import type { ThemePackDto } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import type { WebFiles } from "../workbenches/ui-runtime.js";

/** Where the packs live under the data root. */
export const THEMES_DIR = "themes";
/** Beside the packs: the uploads, kept for the export. Never a pack's id. */
const ARCHIVES_DIR = "archives";
const INSTALLED_FILE = "installed.json";
/** Where the Web App's files carry the built-in packs' sources. */
const BUILTIN_DIR = "themes";

interface Installed {
  /** The uploaded zip's digest. */
  sha256: string;
  installedAt: string;
  /** The admin who imported it. */
  by: string;
  api: number;
  /** The version the served files are addressed at. */
  v: string;
  /** The kept upload's file name under `archives/`. */
  archive: string;
  /** What the pack serves, by path. */
  files: string[];
}

export interface ThemeStoreDeps {
  /** The data root. */
  root: string;
  /** The Web App's files this server serves, where the built-in packs travel. */
  webFiles: () => WebFiles;
  now: () => Date;
}

const notFound = (id: string) =>
  new HttpError(404, "theme_not_found", `No theme pack ${JSON.stringify(id)} on this server.`);

/** One file of the Web App's files, or undefined. */
function webFile(source: WebFiles, rel: string): Uint8Array | undefined {
  if (source.kind === "mem") return source.files.get(rel);
  try {
    return fs.readFileSync(path.join(source.dir, ...rel.split("/")));
  } catch {
    return undefined;
  }
}

/** Every file under `dir`, by its `/`-separated path in it. */
async function readTree(
  dir: string,
  skip: (rel: string) => boolean = () => false,
): Promise<PackFiles> {
  const out: PackFiles = new Map();
  const entries = await fsp.readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    if (!skip(rel)) out.set(rel, await fsp.readFile(abs));
  }
  return out;
}

async function writeTree(
  dir: string,
  files: ReadonlyMap<string, Uint8Array | string>,
): Promise<void> {
  for (const [rel, bytes] of files) {
    const abs = path.join(dir, ...rel.split("/"));
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, bytes);
  }
}

export class ThemeStore {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ThemeStoreDeps) {}

  private get dir(): string {
    return path.join(this.deps.root, THEMES_DIR);
  }

  /** One write at a time: two imports of one id must not interleave their renames. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.writes.then(work, work);
    this.writes = run.catch(() => undefined);
    return run;
  }

  // ---- built-in packs (the build's) -----------------------------------------------------

  /** The ids of the packs the served build carries. */
  private builtinIds(source: WebFiles): Set<string> {
    const ids = new Set<string>();
    if (source.kind === "mem") {
      for (const key of source.files.keys()) {
        const match = /^themes\/([^/]+)\/pack\.json$/.exec(key);
        if (match) ids.add(match[1]!);
      }
      return ids;
    }
    try {
      for (const entry of fs.readdirSync(path.join(source.dir, BUILTIN_DIR), {
        withFileTypes: true,
      })) {
        if (
          entry.isDirectory() &&
          fs.existsSync(path.join(source.dir, BUILTIN_DIR, entry.name, MANIFEST_FILE))
        ) {
          ids.add(entry.name);
        }
      }
    } catch {
      // A build without pack sources: none.
    }
    return ids;
  }

  /** A built-in pack's folder as the build carries it, its fonts resolved from `fonts.json`. */
  private builtinFolder(source: WebFiles, id: string): PackFiles {
    const prefix = `${BUILTIN_DIR}/${id}/`;
    const folder: PackFiles = new Map();
    if (source.kind === "mem") {
      for (const [key, bytes] of source.files)
        if (key.startsWith(prefix)) folder.set(key.slice(prefix.length), bytes);
    } else {
      const dir = path.join(source.dir, BUILTIN_DIR, id);
      for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const abs = path.join(entry.parentPath, entry.name);
        folder.set(path.relative(dir, abs).split(path.sep).join("/"), fs.readFileSync(abs));
      }
    }
    const map = folder.get(FONTS_MAP_FILE);
    if (map !== undefined) {
      for (const [font, asset] of parseFontsMap(map)) {
        const bytes = webFile(source, asset);
        if (bytes === undefined)
          throw new Error(
            `the build's ${prefix}${FONTS_MAP_FILE} names ${asset}, which it does not carry`,
          );
        folder.set(font, bytes);
      }
    }
    return folder;
  }

  /** The theme contract of the served build, read from its base pack. */
  private contract(source: WebFiles): ThemeContract {
    const manifest = webFile(source, `${BUILTIN_DIR}/${BASE_PACK_ID}/${MANIFEST_FILE}`);
    const tokens = webFile(source, `${BUILTIN_DIR}/${BASE_PACK_ID}/tokens.css`);
    if (manifest === undefined || tokens === undefined) {
      throw new HttpError(
        503,
        "themes_unavailable",
        "This server's Web App build carries no theme pack sources, so a pack cannot be checked against it.",
      );
    }
    return contractOfBase(manifest, new TextDecoder().decode(tokens));
  }

  /** Ids no import may take: the reserved names, the served build's packs, the archive folder. */
  private isReserved(source: WebFiles, id: string): boolean {
    return RESERVED_THEME_IDS.has(id) || id === ARCHIVES_DIR || this.builtinIds(source).has(id);
  }

  // ---- installed packs ------------------------------------------------------------------

  private async installed(
    id: string,
  ): Promise<{ record: Installed; manifest: ThemePackManifest } | null> {
    if (!THEME_PACK_ID.test(id) || id === ARCHIVES_DIR) return null;
    const dir = path.join(this.dir, id);
    try {
      const record = JSON.parse(
        await fsp.readFile(path.join(dir, INSTALLED_FILE), "utf8"),
      ) as Installed;
      const manifest = parseManifest(await fsp.readFile(path.join(dir, MANIFEST_FILE)));
      return { record, manifest };
    } catch {
      return null;
    }
  }

  private static dto(manifest: ThemePackManifest, v: string): ThemePackDto {
    return {
      id: manifest.id,
      names: { ...manifest.names },
      version: manifest.version,
      api: manifest.api,
      base: manifest.base,
      modes: [...manifest.modes],
      swatches: { light: { ...manifest.swatches.light }, dark: { ...manifest.swatches.dark } },
      accent: {
        own: { ...manifest.accent.own },
        presets: manifest.accent.presets.map((preset) => ({ ...preset })),
      },
      fonts: { ...manifest.fonts },
      ...(manifest.avatar === undefined ? {} : { avatar: manifest.avatar }),
      href: servedPath(manifest.id, INDEX_FILE, v),
      v,
    };
  }

  /** The imported packs, in the order they were installed. */
  async list(): Promise<ThemePackDto[]> {
    let names: string[];
    try {
      names = await fsp.readdir(this.dir);
    } catch {
      return [];
    }
    const packs: { at: string; dto: ThemePackDto }[] = [];
    for (const name of names.sort()) {
      const pack = await this.installed(name);
      if (pack !== null)
        packs.push({
          at: pack.record.installedAt,
          dto: ThemeStore.dto(pack.manifest, pack.record.v),
        });
    }
    return packs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map((pack) => pack.dto);
  }

  /** A file an imported pack serves, or null: only what its `installed.json` lists. */
  async served(id: string, rel: string): Promise<Uint8Array | null> {
    const pack = await this.installed(id);
    if (pack === null || !pack.record.files.includes(rel)) return null;
    const base = path.join(this.dir, id);
    const abs = path.resolve(base, ...rel.split("/"));
    if (!abs.startsWith(base + path.sep)) return null;
    try {
      return await fsp.readFile(abs);
    } catch {
      return null;
    }
  }

  /**
   * Checks an uploaded zip and installs it. A refused pack writes nothing; a pack whose id is
   * installed replaces it only when `replace` says so.
   */
  install(zip: Uint8Array, options: { replace: boolean; by: string }): Promise<ThemePackDto> {
    return this.serial(async () => {
      const source = this.deps.webFiles();
      const contract = this.contract(source);
      const files = readPackArchive(zip);
      // The id first, so a taken or reserved one is answered before the stylesheets are checked.
      const head = files.get(MANIFEST_FILE);
      if (head !== undefined) {
        const { id } = parseManifest(head);
        if (this.isReserved(source, id)) {
          throw new HttpError(
            400,
            "theme_id_reserved",
            `${JSON.stringify(id)} is a built-in pack's id; give the pack an id of its own in pack.json.`,
          );
        }
        if (!options.replace && (await this.installed(id)) !== null) {
          throw new HttpError(
            409,
            "theme_exists",
            `A theme pack ${JSON.stringify(id)} is installed already.`,
            undefined,
            {
              themeId: id,
            },
          );
        }
      }
      const pack = await validateThemePack(files, contract);
      const { id, version } = pack.manifest;
      const sha256 = createHash("sha256").update(zip).digest("hex");
      const previous = await this.installed(id);

      const archives = path.join(this.dir, ARCHIVES_DIR);
      await fsp.mkdir(archives, { recursive: true });
      const archive = `${id}-${version}-${sha256.slice(0, 8)}.zip`;
      await fsp.writeFile(path.join(archives, archive), zip);

      const record: Installed = {
        sha256,
        installedAt: this.deps.now().toISOString(),
        by: options.by,
        api: pack.manifest.api,
        v: pack.v,
        archive,
        files: [...pack.served],
      };
      const staging = path.join(this.dir, `.staging-${randomBytes(6).toString("hex")}`);
      const target = path.join(this.dir, id);
      const retired = path.join(this.dir, `.retired-${randomBytes(6).toString("hex")}`);
      try {
        await writeTree(staging, pack.files);
        await writeTree(
          staging,
          new Map([
            [INDEX_FILE, pack.indexCss],
            [INSTALLED_FILE, `${JSON.stringify(record, null, 2)}\n`],
          ]),
        );
        if (previous !== null) await fsp.rename(target, retired);
        await fsp.rename(staging, target);
      } finally {
        await fsp.rm(staging, { recursive: true, force: true });
      }
      await fsp.rm(retired, { recursive: true, force: true });
      if (previous !== null && previous.record.archive !== archive) {
        await fsp.rm(path.join(archives, previous.record.archive), { force: true });
      }
      return ThemeStore.dto(pack.manifest, pack.v);
    });
  }

  /** Removes an imported pack and its kept upload. */
  remove(id: string): Promise<void> {
    return this.serial(async () => {
      if (this.isReserved(this.deps.webFiles(), id)) {
        throw new HttpError(
          400,
          "theme_builtin",
          `${JSON.stringify(id)} is a built-in pack; it cannot be removed.`,
        );
      }
      const pack = await this.installed(id);
      if (pack === null) throw notFound(id);
      const retired = path.join(this.dir, `.retired-${randomBytes(6).toString("hex")}`);
      await fsp.rename(path.join(this.dir, id), retired);
      await fsp.rm(retired, { recursive: true, force: true });
      await fsp.rm(path.join(this.dir, ARCHIVES_DIR, pack.record.archive), { force: true });
    });
  }

  /**
   * Any pack as a zip: an imported one as it was uploaded (or, when that upload is gone, a fresh
   * zip of what is kept), a built-in in its export form, from the served build.
   */
  async exportArchive(id: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    const pack = await this.installed(id);
    if (pack !== null) {
      const fileName = `${id}-${pack.manifest.version}.zip`;
      try {
        return {
          bytes: await fsp.readFile(path.join(this.dir, ARCHIVES_DIR, pack.record.archive)),
          fileName,
        };
      } catch {
        const kept = await readTree(
          path.join(this.dir, id),
          (rel) => rel === INDEX_FILE || rel === INSTALLED_FILE,
        );
        return { bytes: writePackArchive(kept), fileName };
      }
    }
    const source = this.deps.webFiles();
    if (!THEME_PACK_ID.test(id) || !this.builtinIds(source).has(id)) throw notFound(id);
    const files = builtinExportFiles(id, this.builtinFolder(source, id));
    const { version } = parseManifest(files.get(MANIFEST_FILE)!);
    return { bytes: writePackArchive(files), fileName: `${id}-${version}.zip` };
  }
}
