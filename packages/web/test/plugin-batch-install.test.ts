// @vitest-environment jsdom
/**
 * Unified multi-plugin download modal & AI source-config assist:
 * 1. Opens in review/consent mode showing count and why each plugin is needed; never downloads
 *    silently before confirmation.
 * 2. Downloads multiple plugins in one modal with one unified progress bar driven by live SSE
 *    stage & byte progress.
 * 3. On failure, stays open, displays the error, recommends configuring plugin download sources
 *    manually (onOpenSources) or with an Agent (onConfigureWithAi), and retries failed items only.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import {
  PluginBatchInstallModal,
  batchOverallPercent,
  currentItemFraction,
  type BatchPluginItem,
} from "../src/features/plugins/plugin-batch-install";
import { pluginSourceConfigRequest } from "../src/features/plugins/plugin-source-assist";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { click, mount, settle, unmountAll } from "./helpers/dom";

beforeEach(() => {
  localStorage.setItem("penguin.lang", "en");
  setActiveStrings(en);
});
afterEach(unmountAll);

const ITEMS: BatchPluginItem[] = [
  {
    specifier: "@acme/alpha",
    title: "Alpha Plugin",
    version: "1.0.0",
    reason: "Provides alpha automation tools.",
  },
  {
    specifier: "@acme/beta",
    title: "Beta Plugin",
    version: "2.1.0",
    reason: "Provides beta connectors.",
  },
];

describe("batchOverallPercent", () => {
  it("advances smoothly across multiple items with live SSE stage and byte progress", () => {
    const start = batchOverallPercent(ITEMS, {
      "@acme/alpha": { status: "running", stage: { stage: "checking" }, progress: null, error: null },
      "@acme/beta": { status: "pending", stage: null, progress: null, error: null },
    });
    const halfFirst = batchOverallPercent(ITEMS, {
      "@acme/alpha": {
        status: "running",
        stage: { stage: "installing", source: "channel" },
        progress: { received: 500, total: 1000 },
        error: null,
      },
      "@acme/beta": { status: "pending", stage: null, progress: null, error: null },
    });
    const firstDoneSecondHalf = batchOverallPercent(ITEMS, {
      "@acme/alpha": { status: "done", stage: null, progress: null, error: null },
      "@acme/beta": {
        status: "running",
        stage: { stage: "installing", source: "channel" },
        progress: { received: 500, total: 1000 },
        error: null,
      },
    });
    const allDone = batchOverallPercent(ITEMS, {
      "@acme/alpha": { status: "done", stage: null, progress: null, error: null },
      "@acme/beta": { status: "done", stage: null, progress: null, error: null },
    });
    expect(start).toBeGreaterThan(0);
    expect(halfFirst).toBeGreaterThan(start);
    expect(halfFirst).toBeLessThan(50);
    expect(firstDoneSecondHalf).toBeGreaterThan(50);
    expect(firstDoneSecondHalf).toBeLessThan(100);
    expect(allDone).toBe(100);
    expect(currentItemFraction({ stage: "loading" }, null)).toBeGreaterThan(0.9);
  });
});

describe("pluginSourceConfigRequest", () => {
  it("prefills a temporary workspace prompt with failed plugin specifiers and errors", () => {
    const agents = [{ agentId: "assistant" }] as AgentSummary[];
    const req = pluginSourceConfigRequest(
      [{ specifier: "@acme/beta", error: "ETIMEDOUT connecting to github.com" }],
      agents,
    );
    expect(req).not.toBeNull();
    expect(req!.agentId).toBe("assistant");
    expect(req!.workspace).toBe("");
    expect(req!.text).toContain("@acme/beta");
    expect(req!.text).toContain("ETIMEDOUT connecting to github.com");
    expect(req!.text).toContain("gh-proxy.com");
  });

  it("returns null when no agent exists", () => {
    expect(pluginSourceConfigRequest([{ specifier: "@acme/beta", error: "err" }], [])).toBeNull();
  });
});

describe("PluginBatchInstallModal", () => {
  it("shows count and reasons without starting any download until confirmed, then shows unified progress", async () => {
    const started: string[] = [];
    let releaseFirst!: () => void;
    const runInstall = vi.fn(
      (
        item: BatchPluginItem,
        cb: {
          onProgress: (r: number, t: number | null) => void;
          onStage: (
            s:
              | { stage: "checking" }
              | { stage: "installing"; source: "channel" }
              | { stage: "loading" },
          ) => void;
        },
      ) => {
        started.push(item.specifier);
        if (item.specifier === "@acme/alpha") {
          cb.onStage({ stage: "installing", source: "channel" });
          cb.onProgress(512 * 1024, 1024 * 1024);
          return new Promise<{ loadError?: string }>((resolve) => {
            releaseFirst = () => resolve({});
          });
        }
        cb.onStage({ stage: "loading" });
        return Promise.resolve({});
      },
    );

    const onComplete = vi.fn();
    await mount(
      h(PluginBatchInstallModal, {
        open: true,
        summaryReason: "Selected 2 plugins for QA verification.",
        items: ITEMS,
        runInstall,
        onComplete,
        onClose: vi.fn(),
      }),
    );

    const modal = document.body.querySelector('[data-testid="batch-plugin-install-modal"]')!;
    expect(modal).not.toBeNull();
    // Review phase: zero silent downloads, displays count + summary reason + each plugin's reason.
    expect(runInstall).not.toHaveBeenCalled();
    expect(modal.textContent).toContain("2 plugins");
    expect(modal.textContent).toContain("Selected 2 plugins for QA verification.");
    expect(modal.textContent).toContain("Provides alpha automation tools.");
    expect(modal.textContent).toContain("Provides beta connectors.");

    // Confirm download: unified progress bar appears and shows live byte progress.
    const confirmBtn = modal.querySelector('[data-testid="batch-install-confirm"]') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();
    await click(confirmBtn);
    await settle();

    expect(started).toEqual(["@acme/alpha"]);
    const bar = modal.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(Number(bar!.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    expect(Number(bar!.getAttribute("aria-valuenow"))).toBeLessThan(50);

    // Finish first -> automatically runs second -> completes at 100%.
    releaseFirst();
    await settle();
    await settle();

    expect(started).toEqual(["@acme/alpha", "@acme/beta"]);
    expect(onComplete).toHaveBeenCalledWith({
      installed: ["@acme/alpha", "@acme/beta"],
      failed: [],
    });
    expect(modal.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");
  });

  it("recommends manual and Agent-assisted config on failure, and retries failed items only", async () => {
    let failBeta = true;
    const calls: string[] = [];
    const runInstall = vi.fn(async (item: BatchPluginItem) => {
      calls.push(item.specifier);
      if (item.specifier === "@acme/beta" && failBeta) {
        throw new Error("could not reach github.com");
      }
      return {};
    });
    const onOpenSources = vi.fn();
    const onConfigureWithAi = vi.fn();

    await mount(
      h(PluginBatchInstallModal, {
        open: true,
        summaryReason: "Install plugins.",
        items: ITEMS,
        runInstall,
        onOpenSources,
        onConfigureWithAi,
        onClose: vi.fn(),
      }),
    );

    const modal = document.body.querySelector('[data-testid="batch-plugin-install-modal"]')!;
    await click(modal.querySelector('[data-testid="batch-install-confirm"]') as HTMLButtonElement);
    await settle();
    await settle();

    // Failure recovery panel visible with both manual & Agent buttons.
    const recovery = modal.querySelector('[data-testid="batch-install-failure-recovery"]');
    expect(recovery).not.toBeNull();
    expect(modal.textContent).toContain("could not reach github.com");

    await click(modal.querySelector('[data-testid="batch-failure-manual-config"]') as HTMLButtonElement);
    expect(onOpenSources).toHaveBeenCalledTimes(1);

    await click(modal.querySelector('[data-testid="batch-failure-agent-config"]') as HTMLButtonElement);
    expect(onConfigureWithAi).toHaveBeenCalledWith([
      { specifier: "@acme/beta", error: "could not reach github.com" },
    ]);

    // Retry only retries @acme/beta, skipping already-installed @acme/alpha.
    failBeta = false;
    calls.length = 0;
    await click(modal.querySelector('[data-testid="batch-install-retry"]') as HTMLButtonElement);
    await settle();
    await settle();
    expect(calls).toEqual(["@acme/beta"]);
    expect(modal.querySelector('[data-testid="batch-install-failure-recovery"]')).toBeNull();
  });
});
