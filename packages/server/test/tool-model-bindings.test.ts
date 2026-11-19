/**
 * Tool-model bindings: a plugin declares one (`ToolModelBindingsProvider.bindings`), the Project's
 * owner binds a configured model to it, and the choice is one line of `[tools]`.
 *
 * - Given a plugin that declares an image binding, any member lists it with the models it accepts.
 * - The owner binds an accepted model: the list, the models view and the config file say so.
 * - A member cannot bind; a model the binding does not accept, a model the Project does not
 *   configure, and a key no plugin declares are each refused, and nothing is written.
 * - Renaming the bound model on the models page moves the binding; deleting it unbinds.
 * - "Restore defaults" clears every binding.
 * - Declarations a package cannot stand behind are dropped: no plugin behind the module, a key
 *   that is not a binding key, a key an earlier package already declared.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { parseManifest, type ModuleDef } from "@prismshadow/penguin-core/kernel";
import { projectConfigPath } from "@prismshadow/penguin-core";
import type { ToolModelBindingsResponse } from "@prismshadow/penguin-library-model";
import { PluginHost } from "../src/plugin/host.js";
import type { ToolModelCandidate } from "../src/services/tool-model-bindings.js";
import { validBindings } from "../src/services/tool-model-bindings.js";
import type { ModelsResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, type TestApp } from "./helpers.js";

const PROJECT = "default_project";
const BINDINGS = `/api/projects/${PROJECT}/models/tool-bindings`;
const IMAGE = { provider: "custom", modelId: "image-model" };
const TEXT = { provider: "custom", modelId: "text-model" };

/** A plugin declaring `t2i`, which accepts the models whose id names an image model. */
function imagePlugin(): ModuleDef {
  return {
    manifest: parseManifest({
      name: "AcmeImages",
      requires: {},
      provides: {},
      contributes: {
        "ToolModelBindingsProvider.bindings": [
          { id: "acme.t2i", key: "t2i", title: { en: "Image generation", zh: "图像生成" } },
        ],
      },
      children: [],
    }),
    create: () => ({
      api: {},
      bind: {
        "acme.t2i": { accepts: (model: ToolModelCandidate) => model.modelId.includes("image") },
      },
    }),
  };
}

describe("tool-model bindings", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  const list = async () =>
    ((await (await owner.get(BINDINGS)).json()) as ToolModelBindingsResponse).bindings;
  const fileText = () => fs.readFile(projectConfigPath(t.root, PROJECT), "utf8");
  const putModels = (models: Record<string, unknown>[]) =>
    owner.put(`/api/projects/${PROJECT}/models`, { models, defaultModel: TEXT });

  beforeAll(async () => {
    const host = new PluginHost();
    host.use({ specifier: "@acme/images", modules: [imagePlugin()], replaces: [] });
    t = await createTestApp({ plugins: host });
    owner = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const { cookie } = await provisionUser(t.app, "member_m");
    expect(
      (await owner.post(`/api/projects/${PROJECT}/members`, { userId: "member_m" })).status,
    ).toBe(201);
    member = apiClient(t.app, cookie);
    expect((await putModels([TEXT, IMAGE])).status).toBe(200);
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("lists a declared binding to any member, with the models it accepts", async () => {
    const res = await member.get(BINDINGS);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ToolModelBindingsResponse).bindings).toEqual([
      {
        key: "t2i",
        title: { en: "Image generation", zh: "图像生成" },
        package: "@acme/images",
        candidates: [IMAGE],
      },
    ]);
  });

  it("binds an accepted model, and the list, the models view and the file say so", async () => {
    const res = await owner.patch(BINDINGS, { key: "t2i", model: IMAGE });
    expect(res.status).toBe(200);
    expect((await list())[0]?.model).toEqual(IMAGE);
    const models = (await (
      await owner.get(`/api/projects/${PROJECT}/models`)
    ).json()) as ModelsResponse;
    expect(models.toolModels).toEqual({ t2i: IMAGE });
    expect(await fileText()).toContain(`t2i = { provider = "custom", model_id = "image-model" }`);
  });

  it("refuses a member, a model the binding rejects, an unconfigured model and an undeclared key", async () => {
    const before = await fileText();
    expect((await member.patch(BINDINGS, { key: "t2i", model: null })).status).toBe(403);
    const rejected = await owner.patch(BINDINGS, { key: "t2i", model: TEXT });
    expect(rejected.status).toBe(400);
    expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe(
      "model_not_accepted",
    );
    const missing = { provider: "custom", modelId: "image-model-missing" };
    expect((await owner.patch(BINDINGS, { key: "t2i", model: missing })).status).toBe(400);
    const unknown = await owner.patch(BINDINGS, { key: "t2v", model: IMAGE });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      "unknown_binding",
    );
    expect(await fileText()).toBe(before);
  });

  it("follows a renamed model, and unbinds a deleted one", async () => {
    const renamed = { provider: "custom", modelId: "image-model-2" };
    expect((await putModels([TEXT, { ...renamed, renamedFrom: IMAGE }])).status).toBe(200);
    expect((await list())[0]?.model).toEqual(renamed);
    expect((await putModels([TEXT])).status).toBe(200);
    expect((await list())[0]?.model).toBeUndefined();
    expect(await fileText()).not.toContain("[tools]");
  });

  it("restore defaults clears every binding", async () => {
    expect((await putModels([TEXT, IMAGE])).status).toBe(200);
    expect((await owner.patch(BINDINGS, { key: "t2i", model: IMAGE })).status).toBe(200);
    const restored = await owner.post(`/api/projects/${PROJECT}/models/sync-presets`, {
      mode: "restore",
    });
    expect(restored.status).toBe(200);
    expect(await t.deps.projectConfigService.getToolModels(PROJECT)).toEqual({});
  });
});

describe("which declarations stand", () => {
  const code = { accepts: () => true };
  const title = { en: "", zh: "" };
  it("drops a module no plugin is behind, a bad key, and a key declared earlier", () => {
    const warnings: string[] = [];
    const kept = validBindings(
      [
        { id: "a.t2i", from: "A", key: "t2i", title, code },
        { id: "x.t2i", from: "Orphan", key: "t2s", title, code },
        { id: "a.bad", from: "A", key: "Not A Key", title, code },
        { id: "b.t2i", from: "B", key: "t2i", title, code },
        { id: "b.s2t", from: "B", key: "s2t", title, code },
      ],
      (module) => ({ A: "@a/tools", B: "@b/tools" })[module],
      (line) => warnings.push(line),
    );
    expect(kept.map((b) => `${b.package} ${b.key}`)).toEqual(["@a/tools t2i", "@b/tools s2t"]);
    expect(warnings).toHaveLength(3);
    expect(warnings.find((w) => w.includes("b.t2i"))).toContain("'@a/tools' already declares");
  });
});
