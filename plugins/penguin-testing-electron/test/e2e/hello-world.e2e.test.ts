import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { Component } from "@prismshadow/penguin-core/plugin";
import { describe, it } from "vitest";
import { gitRoot, testPlugin } from "../../src/driver.js";
import type { TestContext } from "../../src/driver.js";

const available =
  process.platform === "linux"
    ? (process.env.DISPLAY ?? process.env.WAYLAND_DISPLAY) !== undefined
    : !process.env.CI || process.env.PENGUIN_E2E_ELECTRON === "1";

@Component()
export class HelloWorldWindow {
  async run({ window }: TestContext): Promise<void> {
    await window.waitForLoadState("domcontentloaded");
    expect(window.isClosed()).toBe(false);
    // Wait for the React app shell to mount and settle off any initial auth redirect.
    await window.waitForURL((u) => !u.pathname.includes("/api/auth/claim"), { timeout: 20_000 });
    await window.waitForFunction(
      () => (document.body?.innerText ?? "").trim().length > 0,
      undefined,
      { timeout: 20_000 },
    );
    const title = await window.title();
    const url = window.url();
    console.log(
      `[hello-world] headful Electron window ready: title=${JSON.stringify(title)} url=${url}`,
    );

    const root = gitRoot();
    if (root) {
      const shotDir = path.join(root, ".data", "penguin-testing-electron");
      mkdirSync(shotDir, { recursive: true });
      const shotPath = path.join(shotDir, "hello-world.png");
      await window.screenshot({ path: shotPath });
      console.log(`[hello-world] screenshot saved: ${shotPath}`);
    }

    const holdMs = Number(process.env.HELLO_HOLD_MS ?? 2500);
    if (Number.isFinite(holdMs) && holdMs > 0) {
      await window.waitForTimeout(holdMs);
    }
  }
}

describe.skipIf(!available)("hello world headful electron", () => {
  it("launches the real desktop shell, installs sample-plugin, and runs HelloWorldWindow", async () => {
    const root = gitRoot();
    const sample = path.join(import.meta.dirname, "sample-plugin");
    const results = await testPlugin({
      pluginDir: sample,
      dataDir: root ? path.join(root, ".data", "penguin-testing-electron-hello") : undefined,
      units: [HelloWorldWindow],
      lang: "en",
    });
    console.log("[hello-world] results:", JSON.stringify(results, null, 2));
    expect(results).toHaveLength(1);
    expect(results[0]?.ok, results[0]?.error ?? results[0]?.stack).toBe(true);
  }, 180_000);
});
