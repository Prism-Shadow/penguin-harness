/**
 * The one-off utility completion behind semantic id proposals: it answers `null` — never
 * throws, never reaches for a network — whenever the Project has nothing to run it on, so
 * every caller's fallback is what a Project without a usable default model produces.
 */
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { projectConfigPath, projectDir } from "@prismshadow/penguin-core";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import { makeTempRoot } from "./helpers.js";

describe("completeOnce", () => {
  it("answers null when the Project has no config, no default model, or no entry for it", async () => {
    const root = await makeTempRoot();
    const service = new ProjectConfigService(root);
    // No `.project_config.toml` at all.
    expect(await service.completeOnce("p1", "Name: Plugin Marketplace")).toBeNull();

    await fs.mkdir(projectDir(root, "p1"), { recursive: true });
    const file = projectConfigPath(root, "p1");
    // A config that names no default model.
    await fs.writeFile(file, '[[models]]\nprovider = "custom"\nmodel_id = "m-bench"\n', "utf8");
    expect(await service.completeOnce("p1", "Name: Plugin Marketplace")).toBeNull();

    // A default model whose entry is gone: there is nothing to build a client from, and a
    // guess at the credential would be worse than no answer.
    await fs.writeFile(
      file,
      '[default_model]\nprovider = "custom"\nmodel_id = "m-bench"\n',
      "utf8",
    );
    expect(await service.completeOnce("p1", "Name: Plugin Marketplace")).toBeNull();
  });
});
