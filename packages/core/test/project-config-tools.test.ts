/**
 * The `[tools]` table of `.project_config.toml`: the models bound to plugins' tools, an open
 * table core keeps but reads no key of.
 *
 * - Given a binding, it is written as one inline line under `[tools]` and survives the CLI's
 *   load → save round trip (the loader keeps known keys only).
 * - Given a member that is not a `{ provider, model_id }` pair, the load drops it and goes on.
 * - Given a model removed with `config model remove`, every binding naming it goes with it, and
 *   the others stay.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addModel,
  loadProjectConfig,
  projectConfigPath,
  removeModel,
  saveProjectConfig,
} from "../src/index.js";

const PROJECT = "p1";
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-tools-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("the [tools] table", () => {
  it("writes a binding inline and keeps it through a load and save", async () => {
    await addModel(root, PROJECT, { provider: "custom", model_id: "image-model" });
    const cfg = await loadProjectConfig(root, PROJECT);
    cfg.tools = { t2i: { provider: "custom", model_id: "image-model" } };
    await saveProjectConfig(root, PROJECT, cfg);
    await saveProjectConfig(root, PROJECT, await loadProjectConfig(root, PROJECT));
    const text = await fs.readFile(projectConfigPath(root, PROJECT), "utf8");
    expect(text).toContain('[tools]\nt2i = { provider = "custom", model_id = "image-model" }');
    expect((await loadProjectConfig(root, PROJECT)).tools).toEqual({
      t2i: { provider: "custom", model_id: "image-model" },
    });
  });

  it("drops a member that is not a pair and loads the rest", async () => {
    const file = projectConfigPath(root, PROJECT);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      [
        "[tools]",
        'broken = "image-model"',
        't2s = { provider = "custom", model_id = "voice-model" }',
        "",
        "[[models]]",
        'provider = "custom"',
        'model_id = "voice-model"',
        "",
      ].join("\n"),
    );
    const cfg = await loadProjectConfig(root, PROJECT);
    expect(cfg.tools).toEqual({ t2s: { provider: "custom", model_id: "voice-model" } });
    expect(cfg.models).toHaveLength(1);
  });

  it("unbinds what named a removed model and keeps the other bindings", async () => {
    await addModel(root, PROJECT, { provider: "custom", model_id: "image-model" });
    await addModel(root, PROJECT, { provider: "custom", model_id: "voice-model" });
    const cfg = await loadProjectConfig(root, PROJECT);
    cfg.tools = {
      t2i: { provider: "custom", model_id: "image-model" },
      i2i: { provider: "custom", model_id: "image-model" },
      t2s: { provider: "custom", model_id: "voice-model" },
    };
    await saveProjectConfig(root, PROJECT, cfg);
    await removeModel(root, PROJECT, { provider: "custom", model_id: "image-model" });
    expect((await loadProjectConfig(root, PROJECT)).tools).toEqual({
      t2s: { provider: "custom", model_id: "voice-model" },
    });
  });
});
