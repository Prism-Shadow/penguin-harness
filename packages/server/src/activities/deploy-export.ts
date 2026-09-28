/**
 * The activity data a QA deploy publishes, worked out from what the refs of a product hold.
 *
 * Every ref that is not archived contributes its configuration, with each media file its
 * manifest binds pointed at where the deployed activity finds media, and, when it uses the
 * assessment, the assessment in effect. The template names every ref as a source and the
 * released module as the main compartment; the deploy list names the template. Paths and
 * names follow the activity-data repository's layout, so data Loom published before is
 * replaced in place rather than duplicated.
 *
 * Pure: the service reads the refs, the stage writes the files.
 */
import { contentRevision } from "./domain.js";
import { moduleShortName } from "./deploy-git.js";
import { DEPLOY_LAYOUT } from "./deploy-context.js";
import { MEDIA_TOKEN } from "./deploy-settings.js";
import { isLanguageCode } from "./sandbox-configuration.js";
import { mediaUrl, resolveMediaToken, type ManifestAsset } from "./sandbox-ref-assets.js";

/** The navigation bar every deployed layout carries. */
export const NAVBAR_MODULE = "navbar@^3.0.0";

/** The main compartment's theme when the specification names none. */
export const DEFAULT_THEME = "park";

/** The language an asset with none belongs to. */
const DEFAULT_LANGUAGE = "en-US";

/** The navigation bar's theme: blue for reading products, green for maths, park otherwise. */
export function navbarTheme(productCode: string): string {
  if (productCode.startsWith("r")) return "blue";
  if (productCode.startsWith("m")) return "green";
  return DEFAULT_THEME;
}

/** The name the module is published under (`waf-module-Words` → `words`). */
export function modulePublishedName(moduleFolder: string): string {
  return moduleShortName(moduleFolder).toLowerCase();
}

/** Where each exported file goes, relative to the activity-data clone. */
export const exportPaths = {
  template: (productCode: string) => `data/templates/loom/${productCode}.json`,
  deployList: (productCode: string) => `deployLists/loom-${productCode}.txt`,
  /** A ref's configuration, as the template names it (under `data/configurations/`). */
  configurationName: (productCode: string, refNum: number) => `loom/${productCode}-${refNum}.json`,
  /** A ref's assessment, as the template names it (under `data/assessments/`). */
  assessmentName: (productCode: string, refNum: number) => `loom/${productCode}-${refNum}.json`,
  configuration: (name: string) => `data/configurations/${name}`,
  assessment: (name: string) => `data/assessments/${name}`,
};

/** One ref of the product, as the export needs it. */
export interface ExportRef {
  refNum: number;
  displayName: string | null;
  /** The configuration in effect (the author's edit, else the module's); null when none. */
  configuration: unknown;
  /** The assessment in effect for this ref; null when none. */
  assessment: unknown;
  /** Whether the ref's specification says it uses the assessment. */
  usesAssessment: boolean;
  /** The ref's media plan, flattened, each asset carrying its language. */
  assets: readonly ManifestAsset[];
  archived?: boolean;
}

export interface ExportInput {
  productCode: string;
  title: string;
  /** The specification's layout; null means mainOnly. */
  layout: string | null;
  /** The specification's theme; null or empty means park. */
  theme: string | null;
  moduleFolder: string;
  /** The released module version the template pins, e.g. "1.5.0". */
  version: string;
  /** Where the deployed activity finds media (see `repos.mediaPublicBase`). */
  mediaBase: string;
  refs: readonly ExportRef[];
}

export interface ExportFile {
  /** Relative to the activity-data clone, with forward slashes. */
  path: string;
  content: string;
}

export interface TemplateSource {
  description: string;
  configurations: string[];
  refNums: number[];
  assessment?: string;
}

export interface ActivityTemplate {
  id: string;
  title: string;
  description: string;
  configuration: Record<string, never>;
  sources: TemplateSource[];
  layout: {
    name: string;
    compartments: {
      main: { module: string; theme: string };
      navBar: { module: string; theme: string };
    };
  };
}

/** The layout a deployed activity's template carries. Only mainOnly deploys. */
export class ExportLayoutError extends Error {
  constructor(readonly layout: string) {
    super(`Only the ${DEPLOY_LAYOUT} layout deploys; the specification names ${layout}.`);
    this.name = "ExportLayoutError";
  }
}

/** The module a template's main compartment names: `<published name>@^<version>`. */
export function mainModule(moduleFolder: string, version: string): string {
  return `${modulePublishedName(moduleFolder)}@^${version}`;
}

/** The refs a deploy publishes: not archived, in ref order. */
export function deployedRefs(refs: readonly ExportRef[]): ExportRef[] {
  return refs.filter((ref) => !ref.archived).sort((a, b) => a.refNum - b.refNum);
}

/**
 * One revision for everything a QA deploy exports: each deployed ref's number, name and draft
 * revision. A sibling's edit, a ref added or archived, all change it — not only the ref the
 * deploy was started from.
 */
export function exportRevision(
  refs: ReadonlyArray<{
    refNum: number;
    displayName: string | null;
    archived?: boolean;
    draft: { contentRevision: string };
  }>,
): string {
  return contentRevision(
    refs
      .filter((ref) => !ref.archived)
      .sort((a, b) => a.refNum - b.refNum)
      .map((ref) => [ref.refNum, ref.displayName, ref.draft.contentRevision]),
  );
}

/** The product's template: one source per deployed ref, the released module as main. */
export function activityTemplate(input: ExportInput): ActivityTemplate {
  const layout = input.layout ?? DEPLOY_LAYOUT;
  if (layout !== DEPLOY_LAYOUT) throw new ExportLayoutError(layout);
  const title = input.title.trim() || input.productCode;
  return {
    id: input.productCode,
    title,
    description: title,
    configuration: {},
    sources: deployedRefs(input.refs).map((ref) => ({
      description: ref.displayName?.trim() || `Ref ${ref.refNum}`,
      configurations: [exportPaths.configurationName(input.productCode, ref.refNum)],
      refNums: [ref.refNum],
      ...(ref.usesAssessment
        ? { assessment: exportPaths.assessmentName(input.productCode, ref.refNum) }
        : {}),
    })),
    layout: {
      name: layout,
      compartments: {
        main: {
          module: mainModule(input.moduleFolder, input.version),
          theme: input.theme?.trim() || DEFAULT_THEME,
        },
        navBar: { module: NAVBAR_MODULE, theme: navbarTheme(input.productCode) },
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A configuration with every media file its ref's manifest binds written into the asset's
 * language group, under the asset's key and, when the ref renamed it, the module's key too;
 * then every `{{MEDIA}}` pointed at `mediaBase`. The module's configuration may arrive
 * wrapped in the product code (`{ "<pc>": { … } }`), as assembly writes it; the wrapper is
 * kept. A book's intro video is left to the book configuration.
 */
export function configurationWithMediaUrls(
  configuration: unknown,
  assets: readonly ManifestAsset[],
  productCode: string,
  mediaBase: string,
): Record<string, unknown> {
  const root: Record<string, unknown> = isRecord(configuration)
    ? structuredClone(configuration)
    : {};
  const wrapped = isRecord(root[productCode]);
  const body = (wrapped ? root[productCode] : root) as Record<string, unknown>;
  for (const asset of assets) {
    if (asset.role === "bookIntro") continue;
    const key = text(asset.key);
    const url = mediaUrl(asset);
    if (!key || !text(asset.type) || !url) continue;
    const language = isLanguageCode(asset.languageCode)
      ? text(asset.languageCode)
      : DEFAULT_LANGUAGE;
    const group = isRecord(body[language]) ? (body[language] as Record<string, unknown>) : {};
    group[key] = url;
    const source = asset.role === "bookWord" ? "" : text(asset.sourceKey);
    if (source && source !== key) group[source] = url;
    body[language] = group;
  }
  return withMediaBase(root, mediaBase) as Record<string, unknown>;
}

/** Every `{{MEDIA}}` in a document pointed at `mediaBase` (left alone when that is the token). */
export function withMediaBase(value: unknown, mediaBase: string): unknown {
  const base = mediaBase.replace(/\/+$/, "");
  return base === MEDIA_TOKEN ? value : resolveMediaToken(value, base);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Every file a deploy writes: each deployed ref's configuration, the assessment of each ref
 * that uses one and has one, the template, and the deploy list. A ref that uses the
 * assessment but has none still names it in the template, so the check after the export
 * reports it missing rather than the deploy quietly leaving it out.
 */
export function exportFiles(input: ExportInput): ExportFile[] {
  const template = activityTemplate(input);
  const files: ExportFile[] = [];
  for (const ref of deployedRefs(input.refs)) {
    if (ref.configuration !== null && ref.configuration !== undefined)
      files.push({
        path: exportPaths.configuration(
          exportPaths.configurationName(input.productCode, ref.refNum),
        ),
        content: json(
          configurationWithMediaUrls(
            ref.configuration,
            ref.assets,
            input.productCode,
            input.mediaBase,
          ),
        ),
      });
    if (ref.usesAssessment && ref.assessment !== null && ref.assessment !== undefined)
      files.push({
        path: exportPaths.assessment(exportPaths.assessmentName(input.productCode, ref.refNum)),
        content: json(withMediaBase(ref.assessment, input.mediaBase)),
      });
  }
  files.push({ path: exportPaths.template(input.productCode), content: json(template) });
  files.push({
    path: exportPaths.deployList(input.productCode),
    content: `${exportPaths.template(input.productCode)}\n`,
  });
  return files;
}

/** A media plan's assets flattened, each carrying the language it was planned under. */
export function manifestAssetList(manifest: unknown): ManifestAsset[] {
  const assets = isRecord(manifest) ? manifest.assets : undefined;
  if (Array.isArray(assets)) return assets as ManifestAsset[];
  if (!isRecord(assets)) return [];
  return Object.entries(assets).flatMap(([languageCode, group]) =>
    Array.isArray(group)
      ? (group as ManifestAsset[]).map((asset) => ({ languageCode, ...asset }))
      : [],
  );
}
