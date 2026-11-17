import { expect } from "@playwright/test";
import { Component } from "@prismshadow/penguin-core/plugin";
import type { TestContext } from "../../src/driver.js";
/**
 * The sample plugin's one test unit — a component, the unit the harness itself is built
 * from, with `run` as its body. The test code hands the class to the driver's `testPlugin`
 * (on its own, in a list, or as part of the plugin's whole module list); the driver runs
 * it against the real shell. The class's name is the unit's name in the results.
 */
@Component()
export class WindowRenders {
  async run({ window }: TestContext): Promise<void> {
    await window.waitForLoadState("domcontentloaded");
    expect(window.isClosed()).toBe(false);
  }
}
