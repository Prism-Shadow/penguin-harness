/**
 * The dev sandbox, assembled.
 *
 * Reports what state a preview is in, builds the module on demand, serves the draft's
 * media, and plays the activity in a learner runtime of its own. Everything it decides
 * lives in `sandbox-model`, `sandbox-paths`, `sandbox-source`, `media-origin` and
 * `sandbox-builder`; this is the part that touches the filesystem and the activity record,
 * kept thin on purpose.
 *
 * A module comes from one of two places -- a run workspace Penguin assembled it in, or the
 * WAF checkout, where Loom left the modules it generated (see `sandbox-source`). Media
 * likewise: the draft's own files first, then the checkout's media root, which is where
 * every manifest path that is not an upload points.
 */
import type { ModuleDocuments } from "./module-documents.js";
import type { MediaStat } from "./media-stats.js";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use, type Opaque } from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { Config } from "../hmr/capabilities.js";
import type { ActivityRecord } from "./domain.js";
import {
  activityPayload,
  scopeConfigurationToLanguage,
  unwrapModuleConfiguration,
  withPreviewStartScene,
  type ActivityPayload,
} from "./sandbox-configuration.js";
import { moduleDeclaration, ModuleDeclarationError } from "./sandbox-declaration.js";
import { moduleContentType, moduleFileHeaders, moduleFilePath } from "./sandbox-module-files.js";
import { describeBuild, SandboxBuilder, type BuildResult } from "./sandbox-builder.js";
import { spawnModuleBuild, spawnNodeScript } from "./sandbox-build-runner.js";
import { spawnCheckoutBuild } from "./sandbox-checkout-build.js";
import { PLAYER_BUILD_SCRIPT, PLAYER_SOURCE, playerPage, playerStamp } from "./sandbox-player.js";
import {
  aliasesByRefKey,
  applyAliasesToLanguageGroups,
  mediaUrlVersions,
  overlayRefAssets,
  resolveMediaToken,
  versionMediaUrls,
  type ManifestAsset,
} from "./sandbox-ref-assets.js";
import { mediaContentType, planMediaResponse } from "./media-origin.js";
import { moduleStale, previewMediaPath, previewState } from "./sandbox-model.js";
import {
  sandboxMediaRoot,
  sandboxModuleRoot,
  sandboxStatus,
  withinRoot,
  type SandboxBuildReport,
  type SandboxStatus,
} from "./sandbox-paths.js";
import {
  checkoutOutputRoot,
  checkoutServable,
  moduleFileRoots,
  moduleSourceDirs,
  type ModuleSource,
} from "./sandbox-source.js";
import { findWafRoot } from "./waf-module.js";
import {
  isAssessmentData,
  nextAssessmentPart,
  startAssessment,
  type AssessmentSession,
} from "./sandbox-assessment.js";

/** A build result as a caller sees it, with the sentence already written. */
function report(result: BuildResult): SandboxBuildReport {
  return {
    ok: result.ok,
    joined: result.joined,
    skipped: result.skipped,
    message: describeBuild(result),
    log: result.log,
  };
}

/** Reads a JSON file, or null when it is absent or unreadable. Never throws. */
async function readJsonFile(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Every asset in a plan's manifest, whatever language group it sits in. */
function manifestAssets(manifest: unknown): ManifestAsset[] {
  const assets = (manifest as { assets?: unknown } | null | undefined)?.assets;
  if (Array.isArray(assets)) return assets as ManifestAsset[];
  if (!assets || typeof assets !== "object") return [];
  return Object.entries(assets as Record<string, unknown>).flatMap(([languageCode, group]) =>
    Array.isArray(group)
      ? (group as ManifestAsset[]).map((asset) => ({ languageCode, ...asset }))
      : [],
  );
}

/** The framework's shared resources a player page asks for, by the path it asks under. */
const FRAMEWORK_RESOURCES = {
  layouts: "res/layouts",
  css: "res/common/css",
  images: "res/common/images",
  audio: "res/common/audio",
} as const;

export type FrameworkResource = keyof typeof FRAMEWORK_RESOURCES;

/**
 * The navigation bar every layout carries, as Loom declared it: the checkout's own navbar
 * module, in its park theme, with its empty configuration.
 */
const NAVBAR_FOLDER = "navbar";
const NAVBAR_THEME = "park";
const NAVBAR_CONFIGURATION = "none_navBar.json";

/** How long an idle assessment session is kept, and how many at most, as in Loom. */
const ASSESSMENT_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_ASSESSMENT_SESSIONS = 500;

/**
 * How long a play link works. Every file the page fetches rides on it, and a book fetches
 * its pages as they are turned, so it has to outlast a working session, not one play
 * through. The page says when it has run out (see `sandbox-player`); Reload issues a new one.
 */
export const PLAY_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/** What a play token grants: one activity's preview, on one host, until it expires. */
export interface PlayTarget {
  projectId: string;
  activityId: string;
  /** Host (no port) the preview must be served from; anything else is refused. */
  host: string;
  /** True when that host is the App's own, so the page must be sandboxed off its origin. */
  shared: boolean;
  expiresAt: number;
  /**
   * The App origin that asked for the link, which the page reports its state to (see the
   * player's inspector bridge). Signed with the rest, so a page is never told to talk to
   * an origin other than the one that opened it. Absent on links minted before it existed.
   */
  parentOrigin?: string;
}

export interface SandboxMediaResponse {
  status: number;
  headers: Record<string, string>;
  /** Absent for 304 and 416, which carry no body. */
  body?: Opaque<"Uint8Array", Uint8Array>;
}

export type { SandboxBuildReport };

export interface PayloadOptions {
  languageCode?: string | null;
  startSceneId?: string | null;
  /**
   * The path every sandbox route of this activity hangs off, ending in a slash. Defaults to
   * the authenticated API's; a played preview passes its own token-bearing path.
   */
  base?: string | null;
}

/** A player page, or the reason there is not one to show. */
export interface PlayerPageResult {
  status: number;
  html: string;
}

type RangeRequest = { range?: string | null; ifRange?: string | null; ifNoneMatch?: string | null };

/** The sandbox as its callers see it. */
export abstract class ActivitySandbox extends Interface<{
  status(projectId: string, activityId: string): Promise<SandboxStatus>;
  moduleDocuments(projectId: string, activityId: string): Promise<ModuleDocuments>;
  /** Every asset of the media plan with the size of the file it is bound to. */
  mediaStats(projectId: string, activityId: string): Promise<MediaStat[]>;
  payload(projectId: string, activityId: string, options: PayloadOptions): Promise<ActivityPayload>;
  moduleFile(projectId: string, activityId: string, rawPath: string): Promise<SandboxMediaResponse>;
  /** One file of the checkout's navigation bar module, which every played layout carries. */
  navbarFile(rawPath: string): Promise<SandboxMediaResponse>;
  build(projectId: string, activityId: string, force?: boolean): Promise<SandboxBuildReport>;
  media(
    projectId: string,
    activityId: string,
    rawPath: string,
    request: RangeRequest,
  ): Promise<SandboxMediaResponse>;
  /** Signs a link that plays this activity on `host`, for a caller already authorised. */
  play(
    projectId: string,
    activityId: string,
    host: string,
    shared: boolean,
    /** The App origin asking; the page reports its state there and nowhere else. */
    parentOrigin?: string,
  ): Promise<{ token: string; expiresAt: number }>;
  /** What a play token grants, or null when it is forged, expired or for another host. */
  verifyPlay(token: string, host: string): PlayTarget | null;
  playerPage(
    projectId: string,
    activityId: string,
    base: string,
    options: PayloadOptions,
    /** When the page's link stops working, so the page can say so rather than break. */
    expiresAt: number | null,
    /** The App origin the page may report its state to; null reports nothing. */
    parentOrigin?: string | null,
  ): Promise<PlayerPageResult>;
  playerFile(rawPath: string): Promise<SandboxMediaResponse>;
  frameworkFile(
    resource: FrameworkResource,
    rawPath: string,
    request: RangeRequest,
  ): Promise<SandboxMediaResponse>;
  /**
   * The next part of a played activity's assessment: a new session when `scoreId` is null,
   * otherwise the one it names, taking the learner's answers to the last part.
   */
  assess(
    projectId: string,
    activityId: string,
    base: string,
    scoreId: string | null,
    responses: unknown[],
  ): Promise<Record<string, unknown>>;
}>() {}

@Component({})
export class ActivitySandboxService implements ActivitySandbox {
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly config!: Config;

  /** The WAF checkout, or null when there is none. A field so a test can point it. */
  private readonly locateWafRoot: () => Promise<string | null> = () => findWafRoot();

  /**
   * One build per workspace, shared by everyone waiting on it.
   *
   * Held on the service rather than created per request: coalescing four concurrent
   * requests into one build is the whole point, and a builder made per request coalesces
   * nothing.
   */
  private readonly builder = new SandboxBuilder({
    build: (workspace) => spawnModuleBuild(workspace),
    sources: (workspace) => this.sourceMtimes(path.dirname(workspace)),
    now: () => Date.now(),
  });

  /** The same, for modules in the checkout; keyed by the module folder, built elsewhere. */
  private readonly checkoutBuilder = new SandboxBuilder({
    build: (moduleRoot) => this.buildCheckout(moduleRoot),
    sources: (moduleRoot) => this.mtimes(["src", "res"].map((dir) => path.join(moduleRoot, dir))),
    now: () => Date.now(),
  });

  /** A build of the player already under way, joined by anyone who asks meanwhile. */
  private playerBuilding: Promise<{ ok: boolean; log: string; dir: string }> | null = null;

  /** Signs play links. Per process: a restart ends every open preview, which is fine. */
  private readonly playSecret = randomBytes(32);

  /** Assessment sessions of played previews, keyed by activity and score id. */
  private readonly assessments = new Map<
    string,
    { session: AssessmentSession; lastUsedAt: number }
  >();

  /**
   * The workspace of the most recent module build, or null when nothing has been built.
   *
   * Only a succeeded run counts. A failed build leaves a half-written workspace behind, and
   * serving from it would give an author a preview of code that did not compile.
   */
  private async builtModule(projectId: string, activityId: string): Promise<string | null> {
    const runs = await this.generation.list(projectId, activityId);
    const built = runs
      .filter((run) => run.kind === "module" && run.status === "succeeded")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return built
      ? sandboxModuleRoot(path.join(this.config.root, "activity-runs", built.runId))
      : null;
  }

  /**
   * Where this activity's module comes from: Penguin's own build if there is one, else the
   * product's folder in the WAF checkout if it holds a module, else nowhere.
   */
  private async moduleSource(
    projectId: string,
    activity: ActivityRecord,
  ): Promise<ModuleSource | null> {
    const run = await this.builtModule(projectId, activity.id);
    if (run) return { kind: "run", root: run };
    const product = this.activities.productOf(activity);
    if (!product) return null;
    const wafRoot = await this.locateWafRoot();
    if (!wafRoot) return null;
    // The folder was validated when the product was made; containment is checked anyway,
    // because this is a path chosen by stored data and read by a URL.
    const root = withinRoot(path.join(wafRoot, "modules"), product.moduleFolder);
    if (!root) return null;
    const definition = await fs.stat(path.join(root, "definition.json")).catch(() => null);
    if (!definition?.isFile()) return null;
    return {
      kind: "checkout",
      root,
      output: checkoutOutputRoot(this.config.root, product.moduleFolder),
      moduleFolder: product.moduleFolder,
    };
  }

  async mediaStats(projectId: string, activityId: string): Promise<MediaStat[]> {
    const activity = await this.activities.getActivity(projectId, activityId);
    // The same places the player looks for media: the draft's own, then the checkout's.
    const roots = [
      sandboxMediaRoot({
        draftWorkspace: this.activities.draftWorkspace(
          projectId,
          activity.collectionId,
          activity.id,
          activity.draft.draftId,
        ),
      }),
    ];
    const wafRoot = await this.locateWafRoot();
    if (wafRoot) roots.push(path.join(wafRoot, "media"));
    const sizeOf = async (bound: string | undefined): Promise<number | null> => {
      const normal = (bound ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (!normal.startsWith("media/")) return null;
      const relative = previewMediaPath(normal.slice("media/".length));
      if (!relative) return null;
      for (const root of roots) {
        const file = withinRoot(root, relative);
        const stat = file ? await fs.stat(file).catch(() => null) : null;
        if (stat?.isFile()) return stat.size;
      }
      return null;
    };
    // Named from the extension, as the media origin names it when it serves the file.
    const mediaMimeType = (bound: string): string | null => {
      const type = mediaContentType(bound);
      return /^(audio|video|image)\//.test(type) ? type : null;
    };
    const stats: MediaStat[] = [];
    for (const [language, assets] of Object.entries(
      activity.draft.mediaPlan?.manifest.assets ?? {},
    ))
      for (const asset of assets)
        stats.push({
          language,
          key: asset.key,
          type: asset.type,
          bound: !!asset.path,
          bytes: asset.path ? await sizeOf(asset.path) : null,
          mimeType: asset.path ? mediaMimeType(asset.path) : null,
        });
    return stats;
  }

  async moduleDocuments(projectId: string, activityId: string): Promise<ModuleDocuments> {
    const activity = await this.activities.getActivity(projectId, activityId);
    const source = await this.moduleSource(projectId, activity);
    if (!source) return { source: null, configuration: null, assessment: null };
    const read = async (folder: string, names: string[]) => {
      for (const name of names) {
        const value = await readJsonFile(path.join(source.root, folder, name));
        if (value) return { file: `${folder}/${name}`, value };
      }
      return null;
    };
    const own = `${activity.productCode}-${activity.refNum}.json`;
    // The assessment falls back to the canonical ref's, as the player's does.
    const product = this.activities.productOf(activity);
    const shared =
      product?.canonicalRefNum != null && product.canonicalRefNum !== activity.refNum
        ? [`${activity.productCode}-${product.canonicalRefNum}.json`]
        : [];
    return {
      source: source.kind,
      configuration: await read("configurations", [own]),
      assessment: await read("assessments", [own, ...shared]),
    };
  }

  /** The checkout's navigation bar module, or null when the checkout has none. */
  private async navbarSource(): Promise<ModuleSource | null> {
    const wafRoot = await this.locateWafRoot();
    if (!wafRoot) return null;
    const root = path.join(wafRoot, "modules", NAVBAR_FOLDER);
    const definition = await fs.stat(path.join(root, "definition.json")).catch(() => null);
    if (!definition?.isFile()) return null;
    return {
      kind: "checkout",
      root,
      output: checkoutOutputRoot(this.config.root, NAVBAR_FOLDER),
      moduleFolder: NAVBAR_FOLDER,
    };
  }

  /**
   * The navbar compartment of a payload. Loom's, when the checkout has one; otherwise
   * declared empty -- the runtime expects the compartment to exist, and an absent one is a
   * different failure from an empty one.
   */
  private async navbarCompartment(
    base: string,
  ): Promise<{ declaration: { id: string }; configuration: Record<string, unknown> }> {
    const empty = { declaration: { id: "navBar" }, configuration: {} };
    const source = await this.navbarSource();
    if (!source) return empty;
    const definition = await readJsonFile(path.join(source.root, "definition.json"));
    if (!definition) return empty;
    const packageJson = await readJsonFile(path.join(source.root, "package.json"));
    let declaration;
    try {
      declaration = moduleDeclaration({
        definition,
        packageVersion: packageJson?.version,
        theme: NAVBAR_THEME,
        routePrefix: `${base}navbar/`,
      });
    } catch (error) {
      if (error instanceof ModuleDeclarationError) return empty;
      throw error;
    }
    const configuration =
      (await readJsonFile(path.join(source.root, "configurations", NAVBAR_CONFIGURATION))) ?? {};
    return {
      declaration: resolveMediaToken(declaration, `${base}media`) as { id: string },
      configuration: resolveMediaToken(configuration, `${base}media`) as Record<string, unknown>,
    };
  }

  private builderFor(source: ModuleSource): SandboxBuilder {
    return source.kind === "run" ? this.builder : this.checkoutBuilder;
  }

  /** When a source was last built, from disk, so a restart does not forget it. */
  private async builtAtMs(source: ModuleSource): Promise<number | null> {
    const marker =
      source.kind === "run"
        ? path.join(source.root, "definition.json")
        : path.join(source.output, "entry.js");
    const stat = await fs.stat(marker).catch(() => null);
    return stat?.isFile() ? stat.mtimeMs : null;
  }

  private async buildCheckout(moduleRoot: string) {
    const moduleFolder = path.basename(moduleRoot);
    const definition = await readJsonFile(path.join(moduleRoot, "definition.json"));
    return spawnCheckoutBuild({
      moduleRoot,
      outputRoot: checkoutOutputRoot(this.config.root, moduleFolder),
      // A checkout module sits at <waf>/modules/<folder>; the framework beside `modules`.
      frameworkRoot: path.join(path.dirname(path.dirname(moduleRoot)), "framework"),
      moduleId: typeof definition?.id === "string" ? definition.id : moduleFolder,
    });
  }

  /** Builds a source if its build is older than what it is built from. */
  private async ensureCurrent(source: ModuleSource): Promise<SandboxBuildReport | null> {
    const builtAt = await this.builtAtMs(source);
    const sources = await this.mtimes(moduleSourceDirs(source));
    if (!moduleStale(builtAt, sources)) return null;
    return report(await this.builderFor(source).ensure(source.root, true));
  }

  /** What the client is told about a preview. Never claims more than it can show. */
  async status(projectId: string, activityId: string): Promise<SandboxStatus> {
    const activity = await this.activities.getActivity(projectId, activityId);
    const source = await this.moduleSource(projectId, activity);
    const definition = source
      ? await fs.stat(path.join(source.root, "definition.json")).catch(() => null)
      : null;
    const state = previewState({
      hasSpec: activity.draft.status === "valid" && activity.draft.spec !== null,
      hasModule: Boolean(definition?.isFile()),
      // A checkout module is shared by every ref and never written by a build, so any ref
      // may play it and build it.
      canonicalRef: source?.kind === "checkout" || this.activities.isCanonicalRef(activity),
      builtAtMs: source ? await this.builtAtMs(source) : null,
      sourceMtimesMs: source ? await this.mtimes(moduleSourceDirs(source)) : [],
    });
    // The last build's output, so a failed build is visible rather than showing as a
    // preview that simply never appears.
    return sandboxStatus(state, source ? this.builderFor(source).lastLog(source.root) : null);
  }

  /**
   * The payload the learner runtime fetches for this preview.
   *
   * Reads the built module's declaration and configuration, overlays this ref's media onto
   * them, scopes the configuration to the requested language and points the preview at a
   * scene. Every decision lives in `sandbox-declaration`, `sandbox-ref-assets` and
   * `sandbox-configuration`; this reads the files and puts them together.
   */
  async payload(
    projectId: string,
    activityId: string,
    options: PayloadOptions,
  ): Promise<ActivityPayload> {
    const activity = await this.activities.getActivity(projectId, activityId);
    const spec = activity.draft.spec;
    if (!spec)
      throw new HttpError(409, "preview_not_ready", "Save a specification before previewing.");
    const source = await this.moduleSource(projectId, activity);
    if (!source)
      throw new HttpError(409, "preview_not_built", "No module has been built for this activity.");
    const workspace = source.root;
    const base = options.base ?? `/api/projects/${projectId}/activities/${activity.id}/sandbox/`;

    const runtime = (spec.runtime ?? {}) as Record<string, unknown>;
    const definition = await readJsonFile(path.join(workspace, "definition.json"));
    if (!definition)
      throw new HttpError(409, "preview_not_built", "The built module has no definition.");
    const packageJson = await readJsonFile(path.join(workspace, "package.json"));

    let declaration;
    try {
      declaration = moduleDeclaration({
        definition,
        packageVersion: packageJson?.version,
        theme: String(runtime.theme ?? ""),
        routePrefix: `${base}module/`,
      });
    } catch (error) {
      if (error instanceof ModuleDeclarationError)
        throw new HttpError(409, "preview_not_built", error.message);
      throw error;
    }

    // The ref's own media, or the shared module's if this ref has planned none yet.
    const assets = manifestAssets(activity.draft.mediaPlan?.manifest);
    const aliases = aliasesByRefKey(assets);
    // The draft revision is the version token: it changes exactly when the media plan does,
    // which is the only time a cached URL would be wrong.
    const versionToken = activity.draft.contentRevision.slice(0, 16);
    const overlaid = overlayRefAssets(
      declaration as unknown as Record<string, unknown>,
      assets,
      aliases,
      versionToken,
    );

    const configurationFile = path.join(
      workspace,
      "configurations",
      `${activity.productCode}-${activity.refNum}.json`,
    );
    const raw = (await readJsonFile(configurationFile)) ?? {};
    let configuration = unwrapModuleConfiguration(raw, declaration.id);
    configuration = applyAliasesToLanguageGroups(configuration, assets, aliases);
    configuration = versionMediaUrls(
      configuration,
      mediaUrlVersions(assets, versionToken),
    ) as Record<string, unknown>;
    configuration = scopeConfigurationToLanguage(configuration, options.languageCode);
    configuration = withPreviewStartScene(configuration, options.startSceneId);

    // Last, once every media URL is in its final form: versioning matches on the token.
    const mediaBase = `${base}media`;
    const navbar = await this.navbarCompartment(base);
    return activityPayload({
      moduleId: declaration.id,
      title: String(spec.title ?? activity.title),
      layout: String(runtime.layout ?? "mainOnly"),
      resolution: String(runtime.resolution ?? "640x480"),
      declaration: resolveMediaToken(overlaid, mediaBase) as { id: string },
      navBarDeclaration: navbar.declaration,
      navBarConfiguration: navbar.configuration,
      configuration: resolveMediaToken(configuration, mediaBase) as Record<string, unknown>,
      hasAssessment: runtime.usesAssessment === true,
    });
  }

  /**
   * Build this activity's module if it needs it, and say what happened.
   *
   * `force` rebuilds regardless — what a Play button does, because an author pressing it
   * after a build they believe failed is asking for a build, not a freshness opinion.
   */
  async build(projectId: string, activityId: string, force = false): Promise<SandboxBuildReport> {
    const activity = await this.activities.getActivity(projectId, activityId);
    const source = await this.moduleSource(projectId, activity);
    // Only the canonical ref owns a module Penguin assembled, and a build writes into it. A
    // checkout module's build writes only Penguin's own copy, so any ref may ask for one.
    if (source?.kind !== "checkout" && !this.activities.isCanonicalRef(activity)) {
      const product = this.activities.productOf(activity);
      throw new HttpError(
        409,
        "ref_not_canonical",
        `This activity shares its module with ref ${product?.canonicalRefNum}, which owns the module code. Build it from that ref.`,
      );
    }
    if (!source)
      throw new HttpError(409, "preview_not_built", "No module has been built for this activity.");
    return report(await this.builderFor(source).ensure(source.root, force));
  }

  /**
   * One file from the built module, which is what the payload's URLs point at.
   *
   * Read whole rather than ranged: these are the module's code, styles and layout, fetched
   * once at load. The media route handles the large files that need ranges.
   */
  async moduleFile(
    projectId: string,
    activityId: string,
    rawPath: string,
  ): Promise<SandboxMediaResponse> {
    const invalid = () =>
      new HttpError(400, "module_path_invalid", "That is not a module file this preview serves.");
    const relative = moduleFilePath(rawPath);
    if (!relative) throw invalid();
    const activity = await this.activities.getActivity(projectId, activityId);
    const source = await this.moduleSource(projectId, activity);
    if (!source)
      throw new HttpError(409, "preview_not_built", "No module has been built for this activity.");
    if (source.kind === "checkout" && !checkoutServable(relative)) throw invalid();

    for (const root of moduleFileRoots(source)) {
      const file = withinRoot(root, relative);
      if (!file) throw invalid();
      const bytes = await fs.readFile(file).catch(() => null);
      if (!bytes) continue;
      return {
        status: 200,
        headers: { ...moduleFileHeaders(relative), "content-length": String(bytes.byteLength) },
        body: new Uint8Array(bytes),
      };
    }
    throw new HttpError(404, "module_file_not_found", `No file at ${relative}.`);
  }

  async navbarFile(rawPath: string): Promise<SandboxMediaResponse> {
    const invalid = () =>
      new HttpError(400, "module_path_invalid", "That is not a module file this preview serves.");
    const relative = moduleFilePath(rawPath);
    if (!relative || !checkoutServable(relative)) throw invalid();
    const source = await this.navbarSource();
    if (!source) throw new HttpError(404, "navbar_not_found", "The checkout has no navbar module.");
    for (const root of moduleFileRoots(source)) {
      const file = withinRoot(root, relative);
      if (!file) throw invalid();
      const bytes = await fs.readFile(file).catch(() => null);
      if (!bytes) continue;
      return {
        status: 200,
        headers: { ...moduleFileHeaders(relative), "content-length": String(bytes.byteLength) },
        body: new Uint8Array(bytes),
      };
    }
    throw new HttpError(404, "module_file_not_found", `No file at ${relative}.`);
  }

  /**
   * One media file, with range handling: the draft's own first, then the checkout's.
   *
   * The path is checked twice — by shape, then by where it lands in each root — and a file
   * is read only after both pass.
   */
  async media(
    projectId: string,
    activityId: string,
    rawPath: string,
    request: RangeRequest,
  ): Promise<SandboxMediaResponse> {
    const relative = previewMediaPath(rawPath);
    if (!relative) throw new HttpError(400, "media_path_invalid", "That is not a media path.");
    const activity = await this.activities.getActivity(projectId, activityId);
    const roots = [
      sandboxMediaRoot({
        draftWorkspace: this.activities.draftWorkspace(
          projectId,
          activity.collectionId,
          activity.id,
          activity.draft.draftId,
        ),
      }),
    ];
    // A manifest path is relative to the WAF root unless it is an upload, so a file the
    // draft does not hold is the checkout's -- which is where every Loom asset lives.
    const wafRoot = await this.locateWafRoot();
    if (wafRoot) roots.push(path.join(wafRoot, "media"));

    for (const root of roots) {
      const file = withinRoot(root, relative);
      if (!file) throw new HttpError(400, "media_path_invalid", "That is not a media path.");
      const served = await this.serveFile(file, relative, request);
      if (served) return served;
    }
    throw new HttpError(404, "media_not_found", `No media file at ${relative}.`);
  }

  /** A file with range handling, or null when there is no file there. */
  private async serveFile(
    file: string,
    relative: string,
    request: RangeRequest,
    contentType?: string,
  ): Promise<SandboxMediaResponse | null> {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) return null;

    const plan = planMediaResponse(relative, { size: stat.size, mtimeMs: stat.mtimeMs }, request);
    const headers = contentType ? { ...plan.headers, "Content-Type": contentType } : plan.headers;
    if (plan.status === 304 || plan.status === 416) return { status: plan.status, headers };

    const handle = await fs.open(file, "r");
    try {
      const length = plan.range ? plan.range.length : stat.size;
      const buffer = new Uint8Array(length);
      // Read exactly the planned window. Reading the whole file and slicing would put a
      // multi-megabyte video in memory to answer a request for ten kilobytes of it.
      const { bytesRead } = await handle.read(buffer, 0, length, plan.range ? plan.range.start : 0);
      return {
        status: plan.status,
        headers,
        body: bytesRead === length ? buffer : buffer.subarray(0, bytesRead),
      };
    } finally {
      await handle.close();
    }
  }

  /** Signs a play link. The caller has already been authorised for this activity. */
  async play(
    projectId: string,
    activityId: string,
    host: string,
    shared: boolean,
    parentOrigin?: string,
  ): Promise<{ token: string; expiresAt: number }> {
    // Refuses a link to an activity that does not exist while the caller can still be told.
    const activity = await this.activities.getActivity(projectId, activityId);
    const target: PlayTarget = {
      projectId,
      activityId: activity.id,
      host: host.toLowerCase(),
      shared,
      expiresAt: Date.now() + PLAY_TOKEN_TTL_MS,
      ...(parentOrigin ? { parentOrigin } : {}),
    };
    const body = Buffer.from(JSON.stringify(target), "utf8").toString("base64url");
    return {
      token: `${body}.${this.mac(body).toString("base64url")}`,
      expiresAt: target.expiresAt,
    };
  }

  private mac(body: string): Buffer {
    return createHmac("sha256", this.playSecret).update(body).digest();
  }

  verifyPlay(token: string, host: string): PlayTarget | null {
    const dot = token.indexOf(".");
    if (dot <= 0 || dot === token.length - 1) return null;
    const body = token.slice(0, dot);
    const provided = Buffer.from(token.slice(dot + 1), "base64url");
    const expected = this.mac(body);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    let target: PlayTarget;
    try {
      target = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PlayTarget;
    } catch {
      return null;
    }
    if (
      typeof target?.projectId !== "string" ||
      typeof target.activityId !== "string" ||
      typeof target.host !== "string" ||
      typeof target.expiresAt !== "number"
    )
      return null;
    if (Date.now() >= target.expiresAt) return null;
    // The host binding is what keeps a preview on the origin it was issued for.
    if (target.host !== host.toLowerCase()) return null;
    return target;
  }

  /**
   * The page that plays this activity.
   *
   * Builds what is stale first -- the module, then the player -- so an author pressing Play
   * sees their activity, or the build output that explains why not, rather than a page
   * that loads and then fails somewhere inside the framework.
   */
  async playerPage(
    projectId: string,
    activityId: string,
    base: string,
    options: PayloadOptions,
    expiresAt: number | null = null,
    parentOrigin: string | null = null,
  ): Promise<PlayerPageResult> {
    const activity = await this.activities.getActivity(projectId, activityId);
    const spec = activity.draft.spec;
    if (!spec) return failurePage(409, "Save a specification before previewing.");
    const source = await this.moduleSource(projectId, activity);
    if (!source) return failurePage(409, "No module has been built for this activity yet.");
    // A module Penguin assembled may be played before its configuration exists, and plays
    // empty. A Loom module without one was never finished -- Loom's own sandbox refused to
    // play it -- so saying so beats a blank activity.
    const configurationName = `${activity.productCode}-${activity.refNum}.json`;
    if (
      source.kind === "checkout" &&
      !(await fs
        .stat(path.join(source.root, "configurations", configurationName))
        .catch(() => null))
    )
      return failurePage(
        409,
        `${source.moduleFolder} has no configurations/${configurationName}, so there is nothing for this ref to play. Loom generates it in its assets configuration stage.`,
      );

    const built = await this.ensureCurrent(source);
    if (built && !built.ok) return failurePage(500, "The module did not build.", built.log);
    const navbar = await this.navbarSource();
    const navbarBuilt = navbar ? await this.ensureCurrent(navbar) : null;
    if (navbarBuilt && !navbarBuilt.ok)
      return failurePage(500, "The navigation bar did not build.", navbarBuilt.log);
    const player = await this.ensurePlayer();
    if (!player.ok) return failurePage(500, "The player did not build.", player.log);

    const definition = await readJsonFile(path.join(source.root, "definition.json"));
    const runtime = (spec.runtime ?? {}) as Record<string, unknown>;
    return {
      status: 200,
      html: playerPage({
        base,
        title: String(spec.title ?? activity.title),
        moduleId: typeof definition?.id === "string" ? definition.id : activity.productCode,
        productCode: activity.productCode,
        refNum: activity.refNum,
        hasAssessment: runtime.usesAssessment === true,
        resolution: typeof runtime.resolution === "string" ? runtime.resolution : null,
        languageCode: options.languageCode ?? null,
        startSceneId: options.startSceneId ?? null,
        expiresAt,
        parentOrigin,
      }),
    };
  }

  /**
   * The player bundle, built from the checkout's framework once per framework version.
   *
   * The stamp records what it was built from; a missing or different stamp rebuilds.
   * Concurrent callers share one build.
   */
  private async ensurePlayer(): Promise<{ ok: boolean; log: string; dir: string }> {
    const dir = path.join(this.config.root, "activity-sandbox", "player");
    const wafRoot = await this.locateWafRoot();
    if (!wafRoot) return { ok: false, log: "No WAF checkout was found.", dir };
    const frameworkRoot = path.join(wafRoot, "framework");
    const framework = await readJsonFile(path.join(frameworkRoot, "package.json"));
    const stamp = playerStamp(String(framework?.version ?? ""));
    const stampFile = path.join(dir, "stamp.txt");
    const [current, bundle] = await Promise.all([
      fs.readFile(stampFile, "utf8").catch(() => null),
      fs.stat(path.join(dir, "player.js")).catch(() => null),
    ]);
    if (current === stamp && bundle?.isFile()) return { ok: true, log: "", dir };

    if (!this.playerBuilding) {
      this.playerBuilding = spawnNodeScript(PLAYER_BUILD_SCRIPT, {
        cwd: frameworkRoot,
        env: {
          PENGUIN_PLAYER_BUILD: JSON.stringify({
            frameworkRoot,
            outputRoot: dir,
            source: PLAYER_SOURCE,
          }),
        },
      })
        .then(async (outcome) => {
          if (outcome.ok) await fs.writeFile(stampFile, stamp, "utf8");
          return { ...outcome, dir };
        })
        .finally(() => {
          this.playerBuilding = null;
        });
    }
    return this.playerBuilding;
  }

  /** One file of the player bundle: its script, its lazily loaded chunks and their maps. */
  async playerFile(rawPath: string): Promise<SandboxMediaResponse> {
    const relative = previewMediaPath(rawPath);
    if (!relative || !/\.(js|map)$/.test(relative) || relative.includes("/"))
      throw new HttpError(400, "player_path_invalid", "That is not a player file.");
    const player = await this.ensurePlayer();
    if (!player.ok) throw new HttpError(500, "player_build_failed", player.log);
    const file = withinRoot(player.dir, relative);
    const bytes = file ? await fs.readFile(file).catch(() => null) : null;
    if (!bytes) throw new HttpError(404, "player_file_not_found", `No player file ${relative}.`);
    return {
      status: 200,
      headers: { ...moduleFileHeaders(relative), "content-length": String(bytes.byteLength) },
      body: new Uint8Array(bytes),
    };
  }

  /** One of the framework's shared layouts, stylesheets, images or sounds. */
  async frameworkFile(
    resource: FrameworkResource,
    rawPath: string,
    request: RangeRequest,
  ): Promise<SandboxMediaResponse> {
    const relative = previewMediaPath(rawPath);
    const dir = FRAMEWORK_RESOURCES[resource];
    if (!relative || !dir)
      throw new HttpError(400, "framework_path_invalid", "That is not a framework file.");
    const wafRoot = await this.locateWafRoot();
    if (!wafRoot) throw new HttpError(404, "framework_not_found", "No WAF checkout was found.");
    const file = withinRoot(path.join(wafRoot, "framework", dir), relative);
    if (!file) throw new HttpError(400, "framework_path_invalid", "That is not a framework file.");
    // Layouts are HTML, which the media types do not name; the module file types do.
    const byMedia = mediaContentType(relative);
    const contentType =
      byMedia === "application/octet-stream" ? moduleContentType(relative) : byMedia;
    const served = await this.serveFile(file, relative, request, contentType);
    if (!served) throw new HttpError(404, "framework_file_not_found", `No file at ${relative}.`);
    return served;
  }

  async assess(
    projectId: string,
    activityId: string,
    base: string,
    scoreId: string | null,
    responses: unknown[],
  ): Promise<Record<string, unknown>> {
    const activity = await this.activities.getActivity(projectId, activityId);
    const nextId = () => randomBytes(6).readUIntBE(0, 6) % 999_999_999_999;
    this.expireAssessments();
    if (scoreId !== null) {
      const key = `${activity.id}:${scoreId}`;
      const held = this.assessments.get(key);
      if (!held) throw new HttpError(404, "assessment_not_found", "Unknown assessment session.");
      held.lastUsedAt = Date.now();
      const part = nextAssessmentPart(held.session, responses, nextId);
      if (part.status === "FINISHED") this.assessments.delete(key);
      return part;
    }

    const source = await this.moduleSource(projectId, activity);
    if (!source)
      throw new HttpError(409, "preview_not_built", "No module has been built for this activity.");
    // This ref's assessment, or the canonical ref's when this ref has none of its own.
    const product = this.activities.productOf(activity);
    const names = [`${activity.productCode}-${activity.refNum}.json`];
    if (product?.canonicalRefNum != null && product.canonicalRefNum !== activity.refNum)
      names.push(`${activity.productCode}-${product.canonicalRefNum}.json`);
    let data: unknown = null;
    for (const name of names) {
      data = await readJsonFile(path.join(source.root, "assessments", name));
      if (data) break;
    }
    if (!isAssessmentData(data))
      throw new HttpError(
        404,
        "assessment_not_found",
        `The module has no assessments/${names[0]} for this activity to ask from.`,
      );
    const session = startAssessment(
      activity.productCode,
      // The same token resolution as the configuration: an item's pictures and sounds are
      // media like any other.
      resolveMediaToken(data, `${base}media`) as typeof data,
      nextId,
    );
    const part = nextAssessmentPart(session, responses, nextId);
    this.assessments.set(`${activity.id}:${session.assessmentScoreId}`, {
      session,
      lastUsedAt: Date.now(),
    });
    this.expireAssessments();
    return part;
  }

  /** Drops idle sessions, then the oldest while there are too many. */
  private expireAssessments(): void {
    const now = Date.now();
    for (const [key, held] of this.assessments)
      if (now - held.lastUsedAt > ASSESSMENT_SESSION_TTL_MS) this.assessments.delete(key);
    if (this.assessments.size <= MAX_ASSESSMENT_SESSIONS) return;
    const byAge = [...this.assessments.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    for (const [key] of byAge) {
      if (this.assessments.size <= MAX_ASSESSMENT_SESSIONS) break;
      this.assessments.delete(key);
    }
  }

  /** Modification times of everything a module build reads, for the freshness check. */
  async sourceMtimes(workspace: string): Promise<number[]> {
    return this.mtimes(moduleSourceDirs({ kind: "run", root: sandboxModuleRoot(workspace) }));
  }

  /** Modification times of every file under these directories. */
  private async mtimes(dirs: string[]): Promise<number[]> {
    const found: number[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          const stat = await fs.stat(full).catch(() => null);
          if (stat) found.push(stat.mtimeMs);
        }
      }
    };
    for (const dir of dirs) await walk(dir);
    return found;
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
}

/** A plain page saying why there is nothing to play, with the build output when there is one. */
function failurePage(status: number, message: string, log?: string): PlayerPageResult {
  return {
    status,
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Preview unavailable</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#1f2933}pre{white-space:pre-wrap;background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px}</style>
</head><body><p>${escapeHtml(message)}</p>${log ? `<pre>${escapeHtml(log)}</pre>` : ""}</body></html>`,
  };
}
