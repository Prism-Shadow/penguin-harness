import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activitySceneCatalog,
  syncStateMachineConfiguration,
} from "../src/activities/state-machine-configuration.js";
import { scaffoldModule, syncAssembledStateMachine } from "../src/activities/waf-module.js";
import type { ActivityDetail } from "../src/activities/domain.js";
import { activitySpec } from "./activity-fixtures.js";

const activity: ActivityDetail = {
  id: "act_one",
  collectionId: "col_one",
  productCode: "P",
  productId: null,
  displayName: null,
  stable: false,
  refNum: 12,
  title: "Words",
  activityType: "standard",
  createdAt: "",
  updatedAt: "",
  archived: false,
  tags: [],
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

/**
 * The runtime's own checks, from the copy of Loom's package. Loaded at run time: the package
 * compiles under its own settings, which this package's typecheck does not share.
 */
const runtime = {} as {
  stateMachineDefinitionFromConfiguration(configuration: unknown): {
    states: Record<string, unknown>;
  };
  sceneCatalogFromConfiguration(
    configuration: unknown,
    sceneIds: readonly string[],
  ): { sceneIds: readonly string[] };
};
beforeAll(async () => {
  const source = (file: string) =>
    import(
      pathToFileURL(path.resolve(import.meta.dirname, "../../waf-state-machine/src/activity", file))
        .href
    );
  Object.assign(
    runtime,
    await source("state-machine-configuration.ts"),
    await source("scene-catalog.ts"),
  );
});

/** What the runtime does with a configuration before any scene runs. */
function boot(configuration: Record<string, unknown>) {
  const definition = runtime.stateMachineDefinitionFromConfiguration(configuration);
  const sceneIds = Object.keys(definition.states).filter((id) => id !== "activity");
  return { definition, catalog: runtime.sceneCatalogFromConfiguration(configuration, sceneIds) };
}

describe("the state machine a ref's configuration carries", () => {
  it("is in every scaffolded configuration, in the form the runtime boots from", () => {
    const files = scaffoldModule(activity);
    const configuration = JSON.parse(files["configurations/P-12.json"]!).P;
    const machine = JSON.parse(files["generated/P/refs/P-12/spec/state-machine.json"]!);
    expect(configuration.stateMachine).toEqual(machine);
    const { catalog } = boot(configuration);
    expect(catalog.sceneIds).toEqual(activitySpec.scenes.map((scene) => scene.id));
  });

  it("lists each scene's media keys as Loom's catalog does", () => {
    const catalog = activitySceneCatalog({
      scenes: [
        {
          id: "s1",
          description: "One",
          media: {
            images: [{ key: "i" }],
            video: [{ key: "v" }],
            animations: [{ key: "a" }],
          },
          audio: { tracks: [{ key: "t" }] },
        },
      ],
    });
    expect(catalog).toEqual([
      {
        animationKeys: ["a"],
        audioKeys: ["t"],
        description: "One",
        id: "s1",
        imageKeys: ["i"],
        videoKeys: ["v"],
      },
    ]);
    // Only general scenes: Loom adds its placeholder so the catalog is never just those.
    expect(activitySceneCatalog({ scenes: [{ id: "general" }] }).map((scene) => scene.id)).toEqual([
      "general",
      "scaffold-placeholder",
    ]);
  });

  it("drops the legacy machine key and says nothing changed the second time", () => {
    const configuration: Record<string, unknown> = {
      stateMachine: {},
      P: { activityMachine: {}, telemetry: false },
    };
    const machine = { id: "m", initial: "s1", states: {} };
    expect(syncStateMachineConfiguration(configuration, "P", machine, activitySpec)).toBe(true);
    expect(configuration).not.toHaveProperty("stateMachine");
    expect(configuration.P).not.toHaveProperty("activityMachine");
    expect(configuration.P).toMatchObject({ telemetry: false, stateMachine: machine });
    expect(syncStateMachineConfiguration(configuration, "P", machine, activitySpec)).toBe(false);
  });

  it("takes the machine the assembly left, before its files are collected", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-machine-"));
    dirs.push(workspace);
    const files = scaffoldModule(activity);
    for (const [name, source] of Object.entries(files)) {
      const file = path.join(workspace, "module", name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, source);
    }
    // An assembly that completed the machine, and an older one whose configuration had none.
    const machineFile = path.join(
      workspace,
      "module/generated/P/refs/P-12/spec/state-machine.json",
    );
    const machine = JSON.parse(await fs.readFile(machineFile, "utf8"));
    machine.description = "completed by the assembly";
    await fs.writeFile(machineFile, JSON.stringify(machine));
    const configurationFile = path.join(workspace, "module/configurations/P-12.json");
    await fs.writeFile(configurationFile, JSON.stringify({ P: { telemetry: false } }));

    await syncAssembledStateMachine(workspace, activity);
    const configuration = JSON.parse(await fs.readFile(configurationFile, "utf8")).P;
    expect(configuration.telemetry).toBe(false);
    expect(boot(configuration).definition).toEqual(machine);
  });
});
