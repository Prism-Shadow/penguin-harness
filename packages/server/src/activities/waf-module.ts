import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import templates from "./waf-templates.json" with { type: "json" };
import type { ActivityDetail } from "./domain.js";
import { contentRevision, validateActivitySpec } from "./domain.js";
import {
  mediaConfiguration,
  validateManifest,
  validateMediaCoverage,
  wafManifest,
} from "./media.js";
import { HttpError } from "../http/errors.js";
import { readArtifactBytes } from "./artifact.js";
import { AUDIO_MAX_BYTES, inspectWave } from "./audio.js";
import { GENERATED_IMAGE_MAX_BYTES, inspectPng } from "./generated-image.js";
import { validateBookSpec } from "./book.js";
import { compileBookConfiguration, type BookMode } from "./book-configuration.js";

/** Loom's WAF checkout convention; discovery only walks ancestors, never the disk. */
export async function findWafRoot(
  start = process.cwd(),
  configured = process.env.WAF_ROOT_DIR,
): Promise<string | null> {
  let current = path.resolve(configured || start);
  for (;;) {
    try {
      const entries = await Promise.all(
        ["framework/package.json", "framework/src", "modules", "media"].map((name) =>
          fs.stat(path.join(current, name)),
        ),
      );
      if (entries[0]?.isFile() && entries.slice(1).every((entry) => entry.isDirectory()))
        return await fs.realpath(current);
    } catch {
      /* An ancestor may be the workspace root. */
    }
    if (configured || path.dirname(current) === current) return null;
    current = path.dirname(current);
  }
}

/** Source templates are vendored from Loom's html_module, compiled into every deployment. */
export function scaffoldModule(
  activity: ActivityDetail,
  bookMode?: BookMode,
): Record<string, string> {
  const spec = validateActivitySpec(activity.draft.spec);
  if (activity.activityType === "book") validateBookSpec(spec);
  const runtime = spec.runtime as Record<string, unknown>;
  const scenes = (spec.scenes ?? spec.stages) as { id: string; description: string }[];
  if (
    new Set(scenes.map((s) => s.id)).size !== scenes.length ||
    scenes.some((s) => !/^[A-Za-z0-9_-]+$/.test(s.id) || s.id === "activity")
  )
    throw new HttpError(
      400,
      "module_spec_invalid",
      "Module scenes require unique safe IDs other than activity.",
    );
  const rootId = `activity-${spec.id}`;
  const replacements: Record<string, string> = {
    __ROOT_ID__: rootId,
    __MODULE_ID__: String(spec.id),
    __DEFAULT_LANGUAGE_CODE__: "'en-US'",
    __ASSESSMENT_IMPORT__: runtime.usesAssessment
      ? "import { initializeAssessmentRuntime } from '../runtime/assessment.js';"
      : "",
    __ASSESSMENT_RUNTIME_INITIALIZATION__: runtime.usesAssessment
      ? "    initializeAssessmentRuntime(data);"
      : "",
    __ACTIVITY_ACTIONS__:
      "            presentScene," +
      (runtime.usesAssessment
        ? "\n            initializeAssessment: () => initializeAssessmentRuntime(data),"
        : ""),
  };
  const files: Record<string, string> = Object.fromEntries(
    Object.entries(templates)
      .filter(([name]) => runtime.usesAssessment || name !== "src/runtime/assessment.ts")
      .map(([name, source]) => [
        name,
        source
          .replace(/__[A-Z_]+__/g, (token) => replacements[token] ?? token)
          .replaceAll("\r\n", "\n"),
      ]),
  );
  const json = (name: string, value: unknown) => {
    files[name] = JSON.stringify(value, null, 2) + "\n";
  };
  json("package.json", {
    name: `wafmodule-${String(spec.id).toLowerCase()}`,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      typecheck: "tsc --project tsconfig.json",
      test: "npm run typecheck",
      buildDebug: "tsc --project tsconfig.build.json && webpack --env type=debug",
    },
    dependencies: {
      "input-manager-system": "1.3.15",
      pubsubsingleton: "1.0.7",
      "waf-utils": "2.0.20",
      "waf-state-machine": "1.4.17",
    },
    devDependencies: {
      "@types/node": "24.13.3",
      typescript: "7.0.2",
      "waf-module-builder-v2": "1.0.0",
      webpack: "5.106.1",
      "webpack-cli": "7.2.2",
    },
  });
  json("tsconfig.json", {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      lib: ["ES2022", "DOM"],
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      types: ["node"],
      noEmit: true,
    },
    include: ["src/**/*.ts"],
  });
  json("tsconfig.build.json", {
    extends: "./tsconfig.json",
    compilerOptions: { noEmit: false, outDir: ".typescript-build", rootDir: "src" },
  });
  files["webpack.config.cjs"] =
    "const createWafModuleConfig = require('waf-module-builder-v2');\nmodule.exports = (env = {}) => createWafModuleConfig({ buildType: env.type, entry: './.typescript-build/index.js' });\n";
  files[".npmrc"] =
    "registry=https://nexus.waterford.org/repository/npm-group/\nstrict-ssl=true\nignore-scripts=true\n";
  files[".gitignore"] = "node_modules/\n.typescript-build/\ndist/\n";
  json("definition.json", {
    id: spec.id,
    schemaVersion: "2.0.0",
    specificationVersion: "2.0.0",
    engine: "html",
    require: {
      entry: { type: "javascript", url: "entry.js" },
      layout: { type: "html", url: "layout.html" },
      style: { type: "css", url: "style.css" },
    },
    assets: {},
    properties: {},
    themes: {
      [String(runtime.theme)]: {
        ids: [runtime.theme],
        assets: {},
        properties: {
          key: runtime.theme,
          title: spec.title,
          activityDescription: spec.activityDescription,
        },
      },
    },
  });
  const states: Record<string, unknown> = Object.fromEntries(
    scenes.map((scene, i) => [
      scene.id,
      {
        description: scene.description,
        ...(runtime.usesAssessment
          ? { entry: { type: "initializeAssessment", params: { sceneId: scene.id } } }
          : {}),
        exit: { type: "cleanupScene", params: { sceneId: scene.id } },
        initial: "presenting",
        states: {
          presenting: {
            entry: { type: "presentScene", params: { sceneId: scene.id } },
            on: {
              "SCENE.COMPLETED": {
                guard: { type: "isEventForScene", params: { sceneId: scene.id } },
                target: `#${spec.id}.${scenes[i + 1]?.id ?? "activity.complete"}`,
              },
            },
          },
        },
      },
    ]),
  );
  states.activity = {
    initial: "complete",
    states: { complete: { entry: { type: "finalizeActivity" }, type: "final" } },
  };
  const refDir = `generated/${activity.productCode}/refs/${activity.productCode}-${activity.refNum}/spec`;
  json(`${refDir}/state-machine.json`, {
    $schema: "https://waterford.org/schemas/activity-state-machine-1.1.json",
    version: "1.1",
    id: spec.id,
    initial: scenes[0]!.id,
    states,
  });
  json(`${refDir}/activity_spec.json`, spec);
  const plan = activity.draft.mediaPlan;
  if (plan && plan.specRevision !== contentRevision(spec))
    throw new HttpError(
      409,
      "media_stale",
      "Rebuild the media plan from the saved specification before assembly.",
    );
  const manifest = plan ? validateManifest(plan.manifest, activity) : null;
  if (manifest) validateMediaCoverage(manifest, activity);
  if (manifest) json(`${refDir}/asset_manifest.json`, wafManifest(manifest));
  json(
    `configurations/${activity.productCode}-${activity.refNum}.json`,
    manifest
      ? bookMode
        ? compileBookConfiguration(activity, bookMode, manifest)
        : mediaConfiguration(manifest)
      : { [activity.productCode]: { telemetry: false } },
  );
  return files;
}

export async function prepareModule(
  workspace: string,
  activity: ActivityDetail,
  wafRoot: string,
  bookMode?: BookMode,
): Promise<void> {
  const files = scaffoldModule(activity, bookMode);
  // Saved paths are references. Confirm checkout availability before creating a paid Session.
  const references = new Set(
    Object.values(activity.draft.mediaPlan?.manifest.assets ?? {}).flatMap((assets) =>
      assets.flatMap((asset) => (asset.path ? [asset.path] : [])),
    ),
  );
  for (const reference of references) {
    const generated = Object.values(activity.draft.mediaPlan?.manifest.assets ?? {})
      .flat()
      .some((asset) => asset.path === reference && (asset.generatedAudio || asset.generatedImage));
    let current = generated ? workspace : wafRoot;
    const parts = reference.split("/");
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]!);
      const stat = await fs.lstat(current).catch(() => null);
      if (
        !stat ||
        stat.isSymbolicLink() ||
        (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
      )
        throw new HttpError(
          400,
          "media_missing",
          `Referenced media is missing or linked: ${reference}`,
        );
    }
  }
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(workspace, "module", name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source, { flag: "wx" });
  }
  await fs.writeFile(
    path.join(workspace, "waf-context.json"),
    JSON.stringify(
      {
        wafRoot,
        framework: path.join(wafRoot, "framework"),
        media: path.join(wafRoot, "media"),
        generatedMedia: path.join(workspace, "media"),
        navbar: path.join(wafRoot, "modules", "navbar"),
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
}

export interface ModuleArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

/** A completed model turn must not silently replace approved media bindings. */
export async function verifyMediaArtifacts(
  workspace: string,
  activity: ActivityDetail,
  read: (file: string) => Promise<string>,
  bookMode?: BookMode,
): Promise<void> {
  if (!activity.draft.mediaPlan) return;
  const prefix = `module/generated/${activity.productCode}/refs/${activity.productCode}-${activity.refNum}/spec`;
  const manifest = validateManifest(
    JSON.parse(await read(path.join(workspace, prefix, "asset_manifest.json"))),
    activity,
  );
  if (contentRevision(manifest) !== contentRevision(wafManifest(activity.draft.mediaPlan.manifest)))
    throw new Error("Assembly changed the approved media manifest.");
  const configuration = JSON.parse(
    await read(
      path.join(
        workspace,
        "module/configurations",
        `${activity.productCode}-${activity.refNum}.json`,
      ),
    ),
  );
  const expected = (
    bookMode ? compileBookConfiguration(activity, bookMode, manifest) : mediaConfiguration(manifest)
  )[activity.productCode] as Record<string, unknown>;
  for (const [language, entries] of Object.entries(expected)) {
    if (language === "telemetry") continue;
    if (language === "book") {
      if (
        contentRevision(configuration[activity.productCode]?.book ?? null) !==
        contentRevision(entries)
      )
        throw new Error("Assembly changed the selected book reading policy.");
      continue;
    }
    for (const [key, value] of Object.entries(entries as Record<string, unknown>))
      if (
        contentRevision(configuration[activity.productCode]?.[language]?.[key] ?? null) !==
        contentRevision(value)
      )
        throw new Error("Assembly changed an approved media configuration binding.");
  }
  for (const asset of Object.values(activity.draft.mediaPlan.manifest.assets).flat()) {
    if (!asset.generatedAudio && !asset.generatedImage) continue;
    const file = path.join(workspace, "preview", asset.path!);
    for (const directory of ["preview", "preview/media", "preview/media/generated"]) {
      const stat = await fs.lstat(path.join(workspace, directory));
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Linked preview media directories are not allowed.");
    }
    const bytes = await readArtifactBytes(
      file,
      asset.generatedImage ? GENERATED_IMAGE_MAX_BYTES : AUDIO_MAX_BYTES,
    );
    if (
      asset.generatedImage &&
      inspectPng(bytes, asset.generatedImage.runId).sha256 !== asset.generatedImage.sha256
    )
      throw new Error("Assembly changed the accepted image.");
    if (
      asset.generatedAudio &&
      inspectWave(bytes, asset.generatedAudio.runId).sha256 !== asset.generatedAudio.sha256
    )
      throw new Error("Assembly changed the accepted speech audio.");
  }
}
export interface ModuleResult {
  modulePath: "module";
  previewPath: "preview/index.html";
  files: ModuleArtifact[];
}

/** Only fixed output roots and regular contained files can become assembly artifacts. */
export async function collectModule(
  workspace: string,
  read: (file: string, maxBytes?: number) => Promise<string>,
  requiredFiles: string[] = [],
): Promise<ModuleResult> {
  const manifest = JSON.parse(await read(path.join(workspace, "module-result.json"))) as {
    files?: unknown;
  };
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 200)
    throw new Error("module-result.json requires between 1 and 200 file paths.");
  const names = manifest.files;
  for (const required of [
    ...requiredFiles,
    "module/package.json",
    "module/definition.json",
    "module/src/index.ts",
    "module/res/layout.html",
    "preview/index.html",
    "preview/runtime.js",
    "module/build.log",
  ])
    if (!names.includes(required)) throw new Error(`Missing assembly artifact: ${required}`);
  if (!names.some((name) => typeof name === "string" && /^module\/dist\/.+\.js$/.test(name)))
    throw new Error("The assembled module must include its built JavaScript from module/dist.");
  const artifacts: ModuleArtifact[] = [];
  let total = 0;
  for (const name of names) {
    if (
      typeof name !== "string" ||
      !/^(module|preview)\/[A-Za-z0-9_.\/-]+$/.test(name) ||
      name.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
      name.includes("/node_modules/") ||
      names.indexOf(name) !== artifacts.length
    )
      throw new Error("Invalid or duplicate module artifact path.");
    // Reject linked ancestor directories as well as linked leaf files.
    let parent = workspace;
    for (const segment of name.split("/").slice(0, -1)) {
      parent = path.join(parent, segment);
      const stat = await fs.lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Linked artifact directories are not allowed.");
    }
    const source = await read(path.join(workspace, name), 8 * 1024 * 1024);
    const bytes = Buffer.byteLength(source);
    total += bytes;
    if (!source.trim()) throw new Error(`Empty assembly artifact: ${name}`);
    if (total > 32 * 1024 * 1024) throw new Error("Assembly artifacts exceed 32 MiB.");
    artifacts.push({
      path: name,
      bytes,
      sha256: createHash("sha256").update(source).digest("hex"),
    });
  }
  const definition = JSON.parse(await read(path.join(workspace, "module/definition.json")));
  if (
    definition.engine !== "html" ||
    definition.schemaVersion !== "2.0.0" ||
    definition.require?.entry?.url !== "entry.js"
  )
    throw new Error("Assembly did not produce a WAF 2 HTML module definition.");
  return { modulePath: "module", previewPath: "preview/index.html", files: artifacts };
}

export const modulePrompt = `Implement the saved activity specification in input.json as a real WAF HTML module.
The module/ directory contains the native WAF scaffold. Read waf-context.json for the local framework, navbar and media checkout. Read that framework's contracts before implementing.
If input.json contains draft.mediaPlan, its manifest and language-specific configuration are approved inputs. Preserve their keys, scripts and paths; do not invent replacements. Paths are relative to wafRoot except assets carrying generatedAudio or generatedImage: their approved bytes have already been copied into this Session's media/generated directory. Verify bound files, copy only required assets into preview using normal Harness tools and approvals, and resolve {{MEDIA}} to the preview's relative media base. Assets without paths remain unbound: report them explicitly and do not claim complete media. A binding is a reference, not proof of file availability.
Work only in this Session workspace. Treat the shared WAF checkout as read-only. Do not modify shared modules or run Loom's pipeline/server. Do not delegate.
Copy each accepted generatedAudio or generatedImage file unchanged from media/generated to preview/media/generated, and resolve its configuration against that preview/media base. The collector verifies the accepted media hashes. Do not include binary files in module-result.json's text file list.
Implement the actual learning interactions and feedback in module/src, preserving waf-state-machine, WAF lifecycle, Interactable input and cleanup. Complete the ref configuration, asset manifest and state machine for the input productCode/refNum. Use existing media when available; report missing media explicitly, never invent successful generation.
For a book, input.bookMode is the user's explicit reading-mode choice. The scaffolded product configuration contains the selected book policy and complete localized scenes. Preserve this policy, scene order, roles, derived page numbers, image alt text, and ordered audio cues. Implement the reader with the native waf-state-machine lifecycle, owned Interactables, and existing runtime media helpers; do not import waf-sequence or a shared book module. Cover/title pages show only artwork. Story visible text is primary narration; supplemental cues remain hidden. Read-along autoplays on first visit without advancing; Decodable waits the configured reading delay for manual narration and unlocks Next only after all cues complete. Keep backward navigation and rereading available after completion. Missing word timings or pronunciation assets are missing capabilities to report, not timings to invent. Empty timing arrays must not be presented as verified synchronized highlighting.
Use normal Harness approvals for installing dependencies and running commands. Run module typecheck and buildDebug; record real command output in module/build.log. Do not publish or deploy packages.
Produce preview/index.html and preview/runtime.js with bundled local subresources using the actual WAF framework. It must work as static files under an arbitrary URL prefix, with relative resource URLs. Bundle the framework runtime and navbar as needed. Do not replace WAF with a standalone imitation or rely on a separately running Loom server. Keep preview data local; do not contact production student/telemetry APIs.
Check the preview through available Harness browser tools. If dependencies or build/preview fail, explain the failure and do not write module-result.json.
Only after successful build and preview, write module-result.json as { "files": ["module/package.json", "module/definition.json", "module/src/index.ts", "module/res/layout.html", "module/build.log", "preview/index.html", "preview/runtime.js", ...] }. Include source, configuration, built JavaScript under module/dist and preview text files, excluding node_modules. At most 200 text files, 8 MiB each, 32 MiB total. Copy any binary media needed by preview into its workspace too. Finish after writing the manifest.`;
