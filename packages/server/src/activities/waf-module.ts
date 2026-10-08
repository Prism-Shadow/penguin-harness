import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import templates from "./waf-templates.json" with { type: "json" };
import type { ActivityDetail } from "./domain.js";
import { contentRevision, validateActivitySpec } from "./domain.js";
import { keepsEdit } from "./module-overrides.js";
import { DEFAULT_LANGUAGE_CODE, findLanguage } from "./languages.js";
import {
  mediaConfiguration,
  validateManifest,
  validateMediaCoverage,
  wafManifest,
} from "./media.js";
import { isUploadReference } from "./upload.js";
import { HttpError } from "../http/errors.js";
import { validateBookSpec } from "./book.js";
import {
  ACCEPTANCE_HARNESS_FILE,
  ACCEPTANCE_INPUT_FILE,
  ACCEPTANCE_RESULTS_FILE,
  ACCEPTANCE_RUNNER_FILE,
  ACCEPTANCE_TEST_FILE,
  HARNESS_API,
} from "./acceptance-harness.js";
import { libraryPlugin, type LibrarySkill } from "@prismshadow/penguin-core";
import {
  behaviorPath,
  implementationSkills,
  missingSkills,
  usesAssessment,
} from "./behavior-path.js";
import { bookStateMachineDefinition } from "./book-machine.js";
import {
  ACTIVITY_SCENES_CONFIGURATION_KEY,
  readModuleStateMachine,
  STATE_MACHINE_CONFIGURATION_KEY,
  syncStateMachineConfiguration,
} from "./state-machine-configuration.js";
import { compileBookConfiguration, type BookMode } from "./book-configuration.js";
import { bookReaderTemplate } from "./book-reader-template.js";
import { bookReaderControllerTemplate } from "./book-reader-controller-template.js";
import { bookReaderViewTemplate } from "./book-reader-view-template.js";
import { bookReaderAdapterTemplate } from "./book-reader-adapter-template.js";
import { bookReaderEntryTemplate } from "./book-reader-entry-template.js";

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
/**
 * The language a built module starts in.
 *
 * The manifest's default group when it has one, because that is what the activity was
 * authored in. An import from Loom can carry a manifest whose groups this build does not
 * recognise, and building such a module in a language nothing has assets for would produce
 * an activity that loads and then plays nothing — so an unrecognised set falls back to the
 * default rather than to whichever group happened to be first.
 */
export function scaffoldLanguage(activity: ActivityDetail): string {
  const groups = Object.keys(activity.draft.mediaPlan?.manifest.assets ?? {});
  if (groups.includes(DEFAULT_LANGUAGE_CODE)) return DEFAULT_LANGUAGE_CODE;
  const known = groups.find((code) => findLanguage(code));
  return known ?? DEFAULT_LANGUAGE_CODE;
}

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
    // Taken from the manifest rather than fixed. A module built with the default hard
    // coded ignores every other language group it was given: the clips are there, the
    // configuration names them, and the runtime never asks for them.
    __DEFAULT_LANGUAGE_CODE__: `'${scaffoldLanguage(activity)}'`,
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
  if (bookMode) {
    const staged = (source: string) =>
      source
        .replace(/__[A-Z_]+__/g, (token) => replacements[token] ?? token)
        .replaceAll("\r\n", "\n");
    files["src/index.ts"] = staged(bookReaderEntryTemplate);
    files["src/book-reader/model.ts"] = staged(bookReaderTemplate);
    files["src/book-reader/controller.ts"] = staged(bookReaderControllerTemplate);
    files["src/book-reader/view.ts"] = staged(bookReaderViewTemplate);
    files["src/book-reader/adapter.ts"] = staged(bookReaderAdapterTemplate);
  }
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
  const states: Record<string, unknown> = bookMode
    ? {}
    : Object.fromEntries(
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
  if (!bookMode) {
    states.activity = {
      initial: "complete",
      states: { complete: { entry: { type: "finalizeActivity" }, type: "final" } },
    };
  }
  const refDir = `generated/${activity.productCode}/refs/${activity.productCode}-${activity.refNum}/spec`;
  const machine = bookMode
    ? bookStateMachineDefinition(String(spec.id))
    : {
        $schema: "https://waterford.org/schemas/activity-state-machine-1.1.json",
        version: "1.1",
        id: spec.id,
        initial: scenes[0]!.id,
        states,
      };
  json(`${refDir}/state-machine.json`, machine);
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
  // An author's edit replaces the generated document until they discard it. Assembly is the
  // canonical ref's, so its assessment is the one every ref of the product shares.
  const edits = activity.draft.moduleDocuments;
  const configuration = structuredClone(
    edits?.configuration
      ? edits.configuration.value
      : manifest
        ? bookMode
          ? compileBookConfiguration(activity, bookMode, manifest)
          : mediaConfiguration(manifest)
        : { [activity.productCode]: { telemetry: false } },
  ) as Record<string, unknown>;
  // A book's configuration already carries its fixed reader machine and scene catalog.
  if (!bookMode && activity.activityType !== "book")
    syncStateMachineConfiguration(configuration, activity.productCode, machine, spec);
  json(`configurations/${activity.productCode}-${activity.refNum}.json`, configuration);
  if (edits?.assessment)
    json(`assessments/${activity.productCode}-${activity.refNum}.json`, edits.assessment.value);
  if (edits?.definition) json("definition.json", edits.definition.value);
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
      .some(
        (asset) =>
          asset.path === reference &&
          (asset.generatedAudio || asset.generatedImage || asset.generatedVideo),
      );
    // Generated and uploaded media were staged into this Session; only curated
    // library media is expected to already exist in the shared checkout.
    let current = generated || isUploadReference(reference) ? workspace : wafRoot;
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
  const skills = implementationSkills(
    behaviorPath({
      hasSequenceJs: "src/sequence.js" in files,
      hasIndexTs: "src/index.ts" in files,
    }),
    {
      usesAssessment: usesAssessment(activity.draft.spec),
      extra: activity.activityType === "book" ? [BOOK_SKILL] : [],
    },
  );
  await stageSkills(workspace, skills, libraryPlugin("waf-authoring")?.skills ?? []);
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

/** Where a module run's skills are staged, beside `module/` so they never ship with it. */
export const SKILLS_DIR = "skills";
const BOOK_SKILL = "waf-book-generation";

/**
 * Copies the named skills, each with its auxiliary files, into `skills/<name>/`, and writes
 * `skills/README.md` listing them in the order the run reads them — Loom's `.skills/` vendoring.
 *
 * Staged as files rather than installed on an agent because a coding agent runs the stage as a
 * Session of its own and never sees a Penguin agent's installed skills. A missing skill fails
 * the run before a paid Session starts: without the contract the agent would guess at the API.
 */
export async function stageSkills(
  workspace: string,
  names: readonly string[],
  library: readonly LibrarySkill[],
): Promise<void> {
  const missing = missingSkills(
    names,
    library.map((skill) => skill.name),
  );
  if (missing.length)
    throw new HttpError(
      500,
      "skills_missing",
      `The installed WAF authoring skills are missing ${missing.join(", ")}. Rebuild the bundled plugins.`,
    );
  const root = path.join(workspace, SKILLS_DIR);
  const index: string[] = [];
  for (const [position, name] of names.entries()) {
    const skill = library.find((entry) => entry.name === name)!;
    const dir = path.join(root, name);
    for (const [file, source] of Object.entries({ ...skill.files, "SKILL.md": skill.content })) {
      const target = path.join(dir, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, source, { flag: "wx" });
    }
    index.push(`${position + 1}. \`${name}/SKILL.md\`: ${skill.description ?? ""}`.trimEnd());
  }
  await fs.writeFile(
    path.join(root, "README.md"),
    `# WAF skills for this module\n\nRead them in this order.\n\n${index.join("\n")}\n`,
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
  const edits = activity.draft.moduleDocuments;
  const moduleFile = (folder: string) =>
    path.join(workspace, "module", folder, `${activity.productCode}-${activity.refNum}.json`);
  // An author's edit may be added to by the assembly, never changed.
  if (
    edits?.assessment &&
    !keepsEdit(JSON.parse(await read(moduleFile("assessments"))), edits.assessment.value)
  )
    throw new Error("Assembly changed the edited assessment.");
  if (edits?.configuration) {
    // The machine and scene catalog are derived and rewritten on every sync, not authored.
    const authored = (configuration: unknown) => {
      const copy = structuredClone(configuration) as Record<string, unknown>;
      const product = copy?.[activity.productCode];
      if (product && typeof product === "object" && !bookMode)
        for (const key of [STATE_MACHINE_CONFIGURATION_KEY, ACTIVITY_SCENES_CONFIGURATION_KEY])
          delete (product as Record<string, unknown>)[key];
      return copy;
    };
    if (
      !keepsEdit(
        authored(JSON.parse(await read(moduleFile("configurations")))),
        authored(edits.configuration.value),
      )
    )
      throw new Error("Assembly changed the edited configuration.");
  }
  if (
    edits?.definition &&
    !keepsEdit(
      JSON.parse(await read(path.join(workspace, "module", "definition.json"))),
      edits.definition.value,
    )
  )
    throw new Error("Assembly changed the edited module definition.");
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
  // An edited configuration was checked above; the generated bindings no longer apply to it.
  for (const [language, entries] of edits?.configuration ? [] : Object.entries(expected)) {
    if (language === "telemetry") continue;
    if (language === "book") {
      if (
        contentRevision(configuration[activity.productCode]?.book ?? null) !==
        contentRevision(entries)
      )
        throw new Error("Assembly changed the selected book reading policy.");
      continue;
    }
    if (language === "stateMachine" || language === "activityScenes") {
      if (
        contentRevision(configuration[activity.productCode]?.[language] ?? null) !==
        contentRevision(entries)
      )
        throw new Error(
          language === "stateMachine"
            ? "Assembly changed the book state machine."
            : "Assembly changed the book scene catalog.",
        );
      continue;
    }
    for (const [key, value] of Object.entries(entries as Record<string, unknown>))
      if (
        contentRevision(configuration[activity.productCode]?.[language]?.[key] ?? null) !==
        contentRevision(value)
      )
        throw new Error("Assembly changed an approved media configuration binding.");
  }
}
/**
 * Rewrites the ref configuration's machine and scene catalog from what the assembly left,
 * before its files are collected: Loom's `sync_state_machine` after implementing behavior.
 * The run may have completed `spec/state-machine.json`, and the runtime boots from the
 * configuration's copy. A book's reader machine is fixed and checked as it is.
 */
export async function syncAssembledStateMachine(
  workspace: string,
  activity: ActivityDetail,
  bookMode?: BookMode,
): Promise<void> {
  if (bookMode || activity.activityType === "book") return;
  const moduleRoot = path.join(workspace, "module");
  const machine = await readModuleStateMachine(moduleRoot, activity.productCode, activity.refNum);
  if (!machine) return;
  const file = path.join(
    moduleRoot,
    "configurations",
    `${activity.productCode}-${activity.refNum}.json`,
  );
  const text = await fs.readFile(file, "utf8").catch(() => null);
  if (text === null) return;
  const configuration: unknown = JSON.parse(text);
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return;
  const record = configuration as Record<string, unknown>;
  if (syncStateMachineConfiguration(record, activity.productCode, machine, activity.draft.spec))
    await fs.writeFile(file, JSON.stringify(record, null, 2) + "\n");
}

export interface ModuleResult {
  modulePath: "module";
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
      !/^module\/[A-Za-z0-9_.\/-]+$/.test(name) ||
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
  return { modulePath: "module", files: artifacts };
}

/**
 * Where a module run's player check is staged, beside `module/` so it never ships with it:
 * the acceptance harness and runner, and an input naming a play link for this run's module.
 * Absent when the test browser is not installed.
 */
export const PLAYER_CHECK_DIR = "player-check";

export const modulePrompt = `Implement the saved activity specification in input.json as a real WAF HTML module.
The module/ directory contains the native WAF scaffold. Read waf-context.json for the local framework, navbar and media checkout. Read that framework's contracts before implementing.
Before implementing, read the WAF skills in skills/, in the order skills/README.md lists them, and follow them. Where a skill and this message disagree, this message wins. Do not copy skills/ into module/.
If input.json contains draft.mediaPlan, its manifest and language-specific configuration are approved inputs. Preserve their keys, scripts and paths; do not invent replacements. Paths are relative to wafRoot except assets carrying generatedAudio, generatedImage or generatedVideo and uploaded assets (a path containing /uploads/): their approved bytes have already been copied into this Session's workspace at the same path. Verify bound files and keep the {{MEDIA}} token in the configuration: Penguin's player resolves it to this draft's accepted media and the checkout's media. Assets without paths remain unbound: report them explicitly and do not claim complete media. A binding is a reference, not proof of file availability.
Work only in this Session workspace. Treat the shared WAF checkout as read-only. Do not modify shared modules or run Loom's pipeline/server. Do not delegate.
Implement the actual learning interactions and feedback in module/src, preserving waf-state-machine, WAF lifecycle, Interactable input and cleanup. Complete the ref configuration, asset manifest and state machine for the input productCode/refNum. Use existing media when available; report missing media explicitly, never invent successful generation. A video or sound that fails to play is reported through the media lifecycle and the activity moves on; it never leaves a state waiting forever.
Use normal Harness approvals for installing dependencies and running commands. Run module typecheck and buildDebug in module/; record real command output in module/build.log. Do not publish or deploy packages.
Check the built module in Penguin's player, which runs module/dist/debug in the real WAF framework with the navbar, this draft's media and an emulated configuration and assessment backend, and rebuilds the module first when module/src, module/res or module/generated changed. Do not write a preview page or a stand-in WAF runtime of your own. ${PLAYER_CHECK_DIR}/ holds the check: ${ACCEPTANCE_INPUT_FILE} (the play link for this run's module, the viewport, the scene ids and the acceptance criteria), the harness ${ACCEPTANCE_HARNESS_FILE}, the runner ${ACCEPTANCE_RUNNER_FILE} and a package.json pinning playwright-core. Do not edit them.
${HARNESS_API}
Write ${PLAYER_CHECK_DIR}/${ACCEPTANCE_TEST_FILE} as an ES module that imports only from ./${ACCEPTANCE_HARNESS_FILE}, with one criterion() for each scenario you exercise: every scene starting (openActivity({ scene })), each interaction with its correct and incorrect feedback, pause and resume, and completion. Use an acceptance criterion's exact text where a check covers it. Then, in ${PLAYER_CHECK_DIR}/, run npm install --ignore-scripts and node ${ACCEPTANCE_RUNNER_FILE}; it prints each check's result and writes ${ACCEPTANCE_RESULTS_FILE}. Fix the module until the checks pass, rebuilding after each change; never weaken a check to make it pass. The test browser cannot decode some video formats (H.264 among them): a check that fails only for that reason is a capability to report, not a module failure.
If ${PLAYER_CHECK_DIR}/ is absent, the test browser is not installed: build and typecheck the module, and say in your final message that it was not checked in the player because an admin has not installed the test browser in System settings.
If dependencies, the typecheck, the build or the player checks fail and you cannot fix them, explain the failure and do not write module-result.json.
Then write module-result.json as { "files": ["module/package.json", "module/definition.json", "module/src/index.ts", "module/res/layout.html", "module/build.log", ...] }. Include source, configuration and built JavaScript under module/dist, excluding node_modules and binary files. At most 200 text files, 8 MiB each, 32 MiB total. Finish after writing the manifest.`;

/** What a book's module run is told beside `modulePrompt`: the reader the scaffold ships. */
export const moduleBookClause = `
input.bookMode is the user's explicit reading-mode choice. The scaffolded product configuration contains the selected book policy, the book state machine, the scene catalog, and complete localized scenes. Preserve the policy, scene order, roles, derived page numbers, image alt text, and ordered audio cues. Cover/title pages show only artwork. Story visible text is primary narration; supplemental cues remain hidden. Read-along autoplays on first visit without advancing; Decodable waits the configured reading delay for manual narration and unlocks Next only after all cues complete. Keep backward navigation and rereading available after completion. Missing word timings or pronunciation assets are missing capabilities to report, not timings to invent. Empty timing arrays must not be presented as verified synchronized highlighting.
The scaffold ships the complete native reader under module/src: src/index.ts boots the waf-state-machine with enterReader/bookFinalize actions; src/book-reader holds the model, controller, view and adapter. Use them as shipped. The entry wires the intro video, framework pause/resume, pagehide teardown (controller.dispose plus stateMachine.stop), keyboard navigation, and completion via BOOK.COMPLETED while keeping the view interactive. The adapter compiles word highlight events only from timings present in the configuration; with the currently empty timing arrays narration must play without highlighting, and synchronized highlighting must be reported as unavailable. Supply native timed-audio operations through the port with channel vocals; a missing cue must reject as failed narration, never resolve as success. Keep the reader's Interactables scene-owned so they survive the final state. Exercise the real reading scenarios in the player check: delay, pause/resume, interrupted narration, follow-up cues, quiet revisits, and post-completion navigation. Report any capability the data cannot support (word audio, timings, intro video) instead of claiming it. Include all reader source files in module-result.json.`;
