/**
 * The check a QA deploy makes of the activity data it exported, before anything is published:
 * the deploy list names the template, the template names the released module and files that
 * are there, every configuration and assessment is a JSON object, an assessment a ref uses has
 * items (as many as it says), and every media reference is a plain path under the media folder,
 * not a preview address or a token nobody will replace.
 *
 * Pure over a reader of the clone's files, so a test answers it from a map. It says what it
 * found as codes; errors fail the stage, warnings are only reported.
 */
import { MEDIA_TOKEN } from "./deploy-settings.js";
import { exportPaths } from "./deploy-export.js";
import { previewMediaPath } from "./sandbox-model.js";
import type { DeployPreflightIssue, DeployPreflightReport } from "./deploy-types.js";

export interface PreflightInput {
  productCode: string;
  /** The module the template must name: `<published name>@^<version>`. */
  expectedModule: string;
  /** Where the exported data points media (see `repos.mediaPublicBase`). */
  mediaBase: string;
  /** A file of the activity-data clone by its relative path; null when it is not there. */
  read(relativePath: string): Promise<string | null>;
}

export interface PreflightResult extends DeployPreflightReport {
  /** Every media file the data names, as a path in the media repository (`media/…`). */
  media: string[];
}

/** A preview of this server serves media under the activity's sandbox. */
const PREVIEW_MEDIA = /\/sandbox\/media\//;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Every string in a document, wherever the module put it. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const child of value) strings(child, out);
  else if (isRecord(value)) for (const child of Object.values(value)) strings(child, out);
  return out;
}

/** A relative path that stays inside the folder it is joined to. */
function safeRelative(value: string): string | null {
  const normal = value.replace(/\\/g, "/").trim();
  if (!normal || normal.startsWith("/") || /^[A-Za-z]:/.test(normal)) return null;
  return previewMediaPath(normal);
}

export type MediaReference =
  | { kind: "media"; path: string; reference: string }
  | { kind: "unsafe" | "preview" | "token"; reference: string };

/**
 * The media references in a document: strings that start with the media address (the rest,
 * less a query, is the path under `media/`), strings that still carry the framework's token
 * when the address replaces it, and strings that point at a preview of this server.
 */
export function mediaReferences(document: unknown, mediaBase: string): MediaReference[] {
  const base = mediaBase.endsWith("/") ? mediaBase : `${mediaBase}/`;
  const tokenKept = base === `${MEDIA_TOKEN}/`;
  const found: MediaReference[] = [];
  for (const value of strings(document)) {
    if (value.startsWith(base)) {
      const rest = value.slice(base.length).split(/[?#]/)[0]!;
      const relative = safeRelative(rest);
      found.push(
        relative
          ? { kind: "media", path: `media/${relative}`, reference: value }
          : { kind: "unsafe", reference: value },
      );
    } else if (!tokenKept && value.includes(MEDIA_TOKEN))
      found.push({ kind: "token", reference: value });
    else if (PREVIEW_MEDIA.test(value)) found.push({ kind: "preview", reference: value });
  }
  return found;
}

async function readJson(
  input: PreflightInput,
  file: string,
  errors: DeployPreflightIssue[],
): Promise<Record<string, unknown> | null> {
  const text = await input.read(file);
  if (text === null) {
    errors.push({ code: "file_missing", file });
    return null;
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (isRecord(value)) return value;
  } catch {
    /* Reported below. */
  }
  errors.push({ code: "file_invalid", file });
  return null;
}

/** The paths a template source names under `folder`, each checked to stay inside it. */
function sourcePaths(
  value: unknown,
  folder: (name: string) => string,
  template: string,
  errors: DeployPreflightIssue[],
): string[] {
  const list = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const entry of list) {
    const relative = typeof entry === "string" ? safeRelative(entry) : null;
    if (relative) out.push(folder(relative));
    else errors.push({ code: "file_invalid", file: template });
  }
  return out;
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const errors: DeployPreflightIssue[] = [];
  const warnings: DeployPreflightIssue[] = [];
  const templatePath = exportPaths.template(input.productCode);
  const listPath = exportPaths.deployList(input.productCode);
  const media = new Set<string>();
  const counts = { templates: 0, configurations: 0, assessments: 0, media: 0 };
  const result = (): PreflightResult => ({
    errors,
    warnings,
    counts: { ...counts, media: media.size },
    media: [...media].sort(),
  });

  const list = await input.read(listPath);
  const listed = (list ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (list === null) errors.push({ code: "file_missing", file: listPath });
  else if (listed.length !== 1 || listed[0] !== templatePath)
    errors.push({ code: "deploy_list_mismatch", file: listPath });

  const template = await readJson(input, templatePath, errors);
  if (!template) return result();
  counts.templates = 1;
  const layout = isRecord(template.layout) ? template.layout : {};
  const compartments = isRecord(layout.compartments) ? layout.compartments : {};
  const main = isRecord(compartments.main) ? compartments.main : {};
  const found = typeof main.module === "string" ? main.module : null;
  if (found !== input.expectedModule)
    errors.push({ code: "layout_module_mismatch", expected: input.expectedModule, found });

  const sources = Array.isArray(template.sources) ? template.sources.filter(isRecord) : [];
  if (!sources.length) errors.push({ code: "no_sources" });
  const configurations = new Set<string>();
  const assessments = new Set<string>();
  for (const source of sources) {
    for (const file of sourcePaths(
      source.configurations,
      exportPaths.configuration,
      templatePath,
      errors,
    ))
      configurations.add(file);
    if (source.assessment !== undefined)
      for (const file of sourcePaths(
        source.assessment,
        exportPaths.assessment,
        templatePath,
        errors,
      ))
        assessments.add(file);
  }

  const checkMedia = (file: string, document: unknown): number => {
    let named = 0;
    for (const reference of mediaReferences(document, input.mediaBase)) {
      if (reference.kind === "media") {
        media.add(reference.path);
        named++;
      } else
        errors.push({
          code:
            reference.kind === "unsafe"
              ? "media_path_unsafe"
              : reference.kind === "preview"
                ? "media_preview_url"
                : "media_token_left",
          file,
          reference: reference.reference,
        });
    }
    return named;
  };

  for (const file of configurations) {
    const document = await readJson(input, file, errors);
    if (!document) continue;
    counts.configurations++;
    if (checkMedia(file, document) === 0)
      warnings.push({ code: "configuration_without_media", file });
  }
  for (const file of assessments) {
    const document = await readJson(input, file, errors);
    if (!document) continue;
    counts.assessments++;
    const items = Array.isArray(document.items) ? document.items.length : 0;
    if (items === 0) errors.push({ code: "assessment_empty", file });
    const configuration = isRecord(document.configuration) ? document.configuration : {};
    const maxItems = configuration.maxItems;
    if (items > 0 && typeof maxItems === "number" && maxItems !== items)
      errors.push({ code: "assessment_count_mismatch", file, items, maxItems });
    checkMedia(file, document);
  }
  return result();
}
