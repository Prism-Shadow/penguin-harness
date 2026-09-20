import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findWafRoot,
  scaffoldModule,
  prepareModule,
  collectModule,
} from "../src/activities/waf-module.js";
import { readCandidate } from "../src/activities/generation.js";
import type { ActivityDetail } from "../src/activities/domain.js";
import { activitySpec } from "./activity-fixtures.js";
import { planMedia } from "../src/activities/media.js";

const activity: ActivityDetail = {
  id: "act_one",
  collectionId: "col_one",
  productCode: "P",
  refNum: 12,
  title: "Words",
  activityType: "standard",
  createdAt: "",
  updatedAt: "",
  archived: false,
  draft: {
    draftId: "draft_one",
    activityId: "act_one",
    baseVersionId: null,
    contentRevision: "revision",
    status: "valid",
    description: "Words",
    spec: activitySpec,
    updatedAt: "",
  },
};
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});
async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "waf-module-"));
  dirs.push(dir);
  return dir;
}

describe("native WAF module boundary", () => {
  it("rejects book pages without their primary image while retaining generic activity support", () => {
    const generic = structuredClone(activity);
    generic.draft.spec = {
      ...activitySpec,
      scenes: [{ id: "story", role: "story", description: "Read the story" }],
    };
    expect(() => scaffoldModule(generic)).not.toThrow();
    expect(() => scaffoldModule({ ...generic, activityType: "book" })).toThrow(
      "exactly one primary image",
    );
  });

  it("checks referenced media before writing assembly files, without changing the checkout", async () => {
    const root = await directory();
    const workspace = await directory();
    const a = structuredClone(activity);
    a.draft.mediaPlan = planMedia(a);
    a.draft.mediaPlan.manifest.assets["en-US"]!.push({
      key: "cat",
      type: "image",
      description: "A cat",
      path: "media/cat.png",
      usages: [],
    });
    await expect(prepareModule(workspace, a, root)).rejects.toThrow("Referenced media is missing");
    expect(await fs.readdir(workspace)).toEqual([]);
    await fs.mkdir(path.join(root, "media"));
    await fs.writeFile(path.join(root, "media/cat.png"), "fixture bytes");
    await prepareModule(workspace, a, root);
    expect(await fs.readFile(path.join(root, "media/cat.png"), "utf8")).toBe("fixture bytes");
    expect(
      JSON.parse(
        await fs.readFile(path.join(workspace, "module/configurations/P-12.json"), "utf8"),
      ),
    ).toMatchObject({ P: { "en-US": { cat: "{{MEDIA}}/cat.png" } } });
  });
  it("discovers only a complete ancestor checkout and honors an explicit invalid root", async () => {
    const root = await directory();
    const child = path.join(root, "projects", "one");
    for (const name of ["framework/src", "modules", "media", "projects/one"])
      await fs.mkdir(path.join(root, name), { recursive: true });
    await fs.writeFile(path.join(root, "framework/package.json"), "{}");
    expect(await findWafRoot(child, "")).toBe(await fs.realpath(root));
    expect(await findWafRoot(child, child)).toBeNull();
    await fs.rm(path.join(root, "media"), { recursive: true });
    expect(await findWafRoot(child, root)).toBeNull();
  });

  it("renders WAF runtime imports, definition, state machine, ref identity and executable build configuration", () => {
    const files = scaffoldModule(activity);
    expect(Object.values(files).join("\n")).not.toMatch(/__[A-Z_]+__/);
    expect(files["src/index.ts"]).toContain("bootstrapStateMachine");
    expect(files["src/runtime/dom.ts"]).toContain("interactable.dispose()");
    expect(JSON.parse(files["definition.json"]!)).toMatchObject({
      engine: "html",
      schemaVersion: "2.0.0",
    });
    expect(JSON.parse(files["package.json"]!).scripts.buildDebug).toContain("webpack");
    expect(files["configurations/P-12.json"]).toBeDefined();
    expect(JSON.parse(files["generated/P/refs/P-12/spec/state-machine.json"]!).initial).toBe(
      activitySpec.scenes[0]!.id,
    );
    const assessment = scaffoldModule({
      ...activity,
      draft: {
        ...activity.draft,
        spec: { ...activitySpec, runtime: { ...activitySpec.runtime, usesAssessment: true } },
      },
    });
    expect(assessment["src/runtime/assessment.ts"]).toBeDefined();
    expect(assessment["src/activity/index.ts"]).toContain("initializeAssessmentRuntime(data)");
  });

  it("rejects colliding scene IDs before writing a scaffold", () => {
    expect(() =>
      scaffoldModule({
        ...activity,
        draft: {
          ...activity.draft,
          spec: { ...activitySpec, scenes: [{ id: "activity", description: "Reserved" }] },
        },
      }),
    ).toThrow("unique safe IDs");
  });

  it("collects bounded artifact hashes and refuses traversal, duplicates and absent outputs", async () => {
    const root = await directory();
    await prepareModule(root, activity, root);
    await fs.mkdir(path.join(root, "preview"));
    await fs.writeFile(path.join(root, "preview/index.html"), "<!doctype html><title>WAF</title>");
    await fs.writeFile(path.join(root, "preview/runtime.js"), "window.waf = true;");
    await fs.writeFile(path.join(root, "module/build.log"), "typecheck and buildDebug completed");
    await fs.mkdir(path.join(root, "module/dist"), { recursive: true });
    await fs.writeFile(path.join(root, "module/dist/entry.js"), "window.waf = true;");
    const files = [
      "module/package.json",
      "module/definition.json",
      "module/src/index.ts",
      "module/res/layout.html",
      "preview/index.html",
      "preview/runtime.js",
      "module/build.log",
      "module/dist/entry.js",
    ];
    const manifest = async (names: string[]) =>
      fs.writeFile(path.join(root, "module-result.json"), JSON.stringify({ files: names }));
    await manifest(files);
    const result = await collectModule(root, readCandidate);
    expect(result.previewPath).toBe("preview/index.html");
    expect(result.files[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const invalid of [
      [...files, "module/../secret"],
      [...files, files[0]!],
      files.slice(0, -1),
    ]) {
      await manifest(invalid);
      await expect(collectModule(root, readCandidate)).rejects.toThrow();
    }
    await manifest([...files, "preview/missing.js"]);
    await expect(collectModule(root, readCandidate)).rejects.toThrow();
    await manifest(files);
    const outside = await directory();
    await fs.rename(path.join(root, "preview"), path.join(root, "saved-preview"));
    await fs.symlink(
      outside,
      path.join(root, "preview"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(collectModule(root, readCandidate)).rejects.toThrow("Linked artifact directories");
  });
});
