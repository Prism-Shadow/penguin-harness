import { existsSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { Component } from "@prismshadow/penguin-core/plugin";
import { gitRoot } from "../../../src/driver.js";
import type { TestContext } from "../../../src/driver.js";

/**
 * The sample plugin's test units — components, the unit the harness itself is built from,
 * with `run` as their body. The test code hands the classes to the driver's `testPlugin`
 * (in a list, or as part of the plugin's whole module list); the driver runs them against
 * the real shell. The class's name is the unit's name in the results.
 */
@Component()
export class InstanceDataExists {
  async run(): Promise<void> {
    const root = gitRoot();
    expect(root).not.toBeNull();
    expect(existsSync(path.join(root!, ".data/penguin-testing-electron/penguin"))).toBe(true);
  }
}

@Component()
export class WindowRenders {
  async run({ window }: TestContext): Promise<void> {
    await window.waitForLoadState("domcontentloaded");
    expect(window.isClosed()).toBe(false);
  }
}
