// @vitest-environment jsdom
/**
 * Unified multi-plugin bottom-right download dock & AI source-config assist:
 * 1. Opens in review/consent mode showing structured `PluginInstallReason`s (`feature`,
 *    `requester`, `requiredBy`, `update`) and clickable links with zero silent downloads.
 * 2. Uses a flat `rounded-sm` surface (no nested boxes, no secondary folding) and folds into one
 *    32px integrated progress bar showing "Downloading X/N plugins…".
 * 3. Deduplicates identical `(machineId, specifier)` items while keeping multi-machine entries
 *    grouped and downloading concurrently across machines.
 * 4. On failure, stays open, displays the error, recommends manual Plugin Sources and Agent-assisted
 *    configuration, and retries failed items only.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import {
  PluginBatchInstallModal,
  batchItemKey,
  batchOverallPercent,
  currentItemFraction,
  mergeBatchItems,
  type BatchPluginItem,
} from "../src/features/plugins/plugin-batch-install";
import { pluginSourceConfigRequest } from "../src/features/plugins/plugin-source-assist";
import { setActiveStrings } from "../src/lib/strings";
import { EN_STRINGS } from "../src/lib/strings-en";
import { click, mount, settle, unmount } from "./ui-harness";

const ITEMS: BatchPluginItem[] = [
  {
    specifier: "@acme/alpha",
    title: "Alpha",
    version: "1.0.0",
    reasons: [{ kind: "feature", label: "Sandbox" }],
  },
  {
    specifier: "@acme/beta",
    title: "Beta",
    version: "2.1.0",
    reasons: [
      { kind: "requester", label: "Agent: qa-helper" },
      { kind: "requiredBy", label: "@acme/alpha" },
    ],
  },
];

describe("batch install progress math and deduplication", () => {
  it("computes unified progress across pending, running, done, and failed items", () => {
    expect(batchOverallPercent([], {})).toBe(100);
    expect(
      batchOverallPercent(ITEMS, {
        "@acme/alpha": { status: "pending", stage: null, progress: null, error: null },
        "@acme/beta": { status: "pending", stage: null, progress: null, error: null },
      }),
    ).toBe(0);
    expect(
      batchOverallPercent(ITEMS, {
        [batchItemKey(ITEMS[0]!)]: {
          status: "done",
          stage: null,
          progress: null,
          error: null,
        },
        [batchItemKey(ITEMS[1]!)]: {
          status: "running",
          stage: { stage: "downloading" },
          progress: { received: 500, total: 1000 },
          error: null,
        },
      }),
    ).toBe(76);
    // Failed items do not inflate overall progress.
    expect(
      batchOverallPercent(ITEMS, {
        [batchItemKey(ITEMS[0]!)]: {
          status: "failed",
          stage: null,
          progress: null,
          error: "502",
        },
        [batchItemKey(ITEMS[1]!)]: {
          status: "pending",
          stage: null,
          progress: null,
          error: null,
        },
      }),
    ).toBe(0);
    expect(currentItemFraction({ stage: "checking" }, null)).toBe(0.1);
    expect(currentItemFraction({ stage: "loading" }, null)).toBe(0.94);
  });

  it("merges duplicate (machineId, specifier) items by combining reasons while keeping distinct machines separate", () => {
    const merged = mergeBatchItems([
      {
        specifier: "@acme/wsl",
        title: "WSL",
        machineId: "m1",
        reasons: [{ kind: "feature", label: "Sandbox" }],
      },
      {
        specifier: "@acme/wsl",
        title: "WSL",
        machineId: "m1",
        version: "0.2.3",
        reasons: [
          { kind: "feature", label: "Sandbox" },
          { kind: "requester", label: "Alice" },
        ],
      },
      {
        specifier: "@acme/wsl",
        title: "WSL",
        machineId: "m2",
        reasons: [{ kind: "feature", label: "Sandbox" }],
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]?.version).toBe("0.2.3");
    expect(merged[0]?.reasons).toEqual([
      { kind: "feature", label: "Sandbox" },
      { kind: "requester", label: "Alice" },
    ]);
    expect(merged[1]?.machineId).toBe("m2");
  });
});

describe("pluginSourceConfigRequest", () => {
  const agents = [
    { agentId: "a1", name: "Helper", model: "m" },
    { agentId: "a2", name: "Secondary", model: "m" },
  ] as unknown as AgentSummary[];

  it("builds a /chat/new handoff mentioning failed plugins and mirror/source options", () => {
    const req = pluginSourceConfigRequest(agents, [
      { specifier: "@acme/alpha", error: "timed out reaching github.com" },
    ]);
    expect(req.path).toBe("/chat/new");
    expect(req.state.agentId).toBe("a1");
    expect(req.state.draft).toContain("@acme/alpha");
    expect(req.state.draft).toContain("timed out reaching github.com");
    expect(req.state.draft).toContain("gh-proxy.com");
  });
});

describe("PluginBatchInstallModal", () => {
  beforeEach(() => {
    setActiveStrings(EN_STRINGS);
  });

  afterEach(async () => {
    await unmount();
  });

  it("shows structured reasons and clickable links before consent with zero silent downloads, then runs sequentially", async () => {
    let releaseFirst!: () => void;
    const started: string[] = [];
    const onOpenPlugin = vi.fn();
    const onFeatureClick = vi.fn();
    const onDepClick = vi.fn();

    const items: BatchPluginItem[] = [
      {
        specifier: "@acme/alpha",
        title: "Alpha",
        version: "1.0.0",
        onOpenPlugin,
        reasons: [
          { kind: "feature", label: "Sandbox", onClick: onFeatureClick },
          { kind: "requester", label: "Alice" },
        ],
      },
      {
        specifier: "@acme/beta",
        title: "Beta",
        version: "2.1.0",
        reasons: [
          { kind: "update", from: "2.0.0", to: "2.1.0" },
          { kind: "requiredBy", label: "@acme/alpha", onClick: onDepClick },
          { kind: "requiredBy", label: "@acme/gamma" },
        ],
      },
    ];

    const runInstall = vi.fn(
      (
        item: BatchPluginItem,
        cb: {
          onProgress: (r: number, t: number | null) => void;
          onStage: (s: { stage: "checking" | "downloading" | "loading" }) => void;
        },
      ) => {
        started.push(item.specifier);
        if (item.specifier === "@acme/alpha") {
          cb.onStage({ stage: "downloading" });
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
        items,
        runInstall,
        onComplete,
        onClose: vi.fn(),
      }),
    );

    const modal = document.body.querySelector('[data-testid="batch-plugin-install-modal"]')!;
    expect(modal).not.toBeNull();
    // Outer radius uses rounded-sm (never rounded-lg).
    expect(modal.className).toContain("rounded-sm");
    expect(modal.className).not.toContain("rounded-lg");
    // Zero silent downloads before confirmation.
    expect(runInstall).not.toHaveBeenCalled();

    // Structured reasons render cleanly and links invoke callbacks.
    expect(modal.textContent).toContain("@acme/alpha");
    expect(modal.textContent).toContain("For Sandbox");
    expect(modal.textContent).toContain("Requested by Alice");
    expect(modal.textContent).toContain("Update 2.0.0 → 2.1.0");
    expect(modal.textContent).toContain("Required by @acme/alpha, @acme/gamma");

    const alphaButtons = Array.from(modal.querySelectorAll("button")).filter(
      (b) => b.textContent === "@acme/alpha",
    );
    expect(alphaButtons.length).toBeGreaterThanOrEqual(2);
    await click(alphaButtons[0]!);
    expect(onOpenPlugin).toHaveBeenCalledTimes(1);
    await click(alphaButtons[1]!);
    expect(onDepClick).toHaveBeenCalledTimes(1);

    const sandboxBtn = Array.from(modal.querySelectorAll("button")).find(
      (b) => b.textContent === "Sandbox",
    )!;
    await click(sandboxBtn);
    expect(onFeatureClick).toHaveBeenCalledTimes(1);

    // Confirm download: unified progress bar appears and shows live progress.
    const confirmBtn = modal.querySelector('[data-testid="batch-install-confirm"]') as HTMLButtonElement;
    await click(confirmBtn);
    await settle();

    expect(started).toEqual(["@acme/alpha"]);
    expect(modal.textContent).toContain("Downloading 1/2 plugins…");
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

  it("folds into one 32px progress bar with clear 'Downloading X/N plugins…' wording", async () => {
    let release!: () => void;
    const runInstall = vi.fn(
      (_item: BatchPluginItem, cb: { onProgress: (r: number, t: number | null) => void }) => {
        cb.onProgress(256 * 1024, 1024 * 1024);
        return new Promise<{ loadError?: string }>((resolve) => {
          release = () => resolve({});
        });
      },
    );

    await mount(
      h(PluginBatchInstallModal, {
        open: true,
        items: ITEMS,
        runInstall,
        onClose: vi.fn(),
      }),
    );

    const modal = document.body.querySelector('[data-testid="batch-plugin-install-modal"]')!;
    expect(modal.getAttribute("aria-modal")).toBe("false");
    expect(modal.getAttribute("data-expanded")).toBe("true");

    await click(modal.querySelector('[data-testid="batch-install-confirm"]') as HTMLButtonElement);
    await settle();

    // Fold during download: body collapses into a single 32px integrated progress bar.
    await click(modal.querySelector('[data-testid="batch-install-toggle-fold"]') as HTMLButtonElement);
    await settle();
    expect(modal.getAttribute("data-expanded")).toBe("false");
    expect(modal.querySelector('[data-testid="batch-install-body"]')).toBeNull();
    const progressEl = modal.querySelector('[role="progressbar"]');
    expect(progressEl).not.toBeNull();
    expect(progressEl!.className).toContain("h-8");
    expect(modal.textContent).toContain("Downloading 1/2 plugins…");

    // Expand again: full body and plugin list return.
    await click(modal.querySelector('[data-testid="batch-install-toggle-fold"]') as HTMLButtonElement);
    await settle();
    expect(modal.getAttribute("data-expanded")).toBe("true");
    expect(modal.querySelector('[data-testid="batch-install-body"]')).not.toBeNull();

    release();
    await settle();
  });

  it("groups multi-machine downloads, runs machines concurrently, and retries failed items only", async () => {
    let failRemote = true;
    const started: string[] = [];
    const multiItems: BatchPluginItem[] = [
      {
        specifier: "@acme/wsl",
        title: "WSL",
        machineId: "local",
        machineLabel: "This server",
        reasons: [{ kind: "feature", label: "Sandbox" }],
      },
      {
        specifier: "@acme/bwrap",
        title: "Bwrap",
        machineId: "gpu-node-1",
        machineLabel: "gpu-node-1",
        reasons: [{ kind: "feature", label: "Sandbox" }],
      },
    ];

    const runInstall = vi.fn(async (item: BatchPluginItem) => {
      started.push(`${item.machineId}:${item.specifier}`);
      if (item.machineId === "gpu-node-1" && failRemote) {
        throw new Error("could not reach github.com");
      }
      return {};
    });
    const onOpenSources = vi.fn();
    const onConfigureWithAi = vi.fn();

    await mount(
      h(PluginBatchInstallModal, {
        open: true,
        items: multiItems,
        runInstall,
        onOpenSources,
        onConfigureWithAi,
        onClose: vi.fn(),
      }),
    );

    const modal = document.body.querySelector('[data-testid="batch-plugin-install-modal"]')!;
    expect(modal.querySelector('[data-testid="batch-machine-local"]')).not.toBeNull();
    expect(modal.querySelector('[data-testid="batch-machine-gpu-node-1"]')).not.toBeNull();

    await click(modal.querySelector('[data-testid="batch-install-confirm"]') as HTMLButtonElement);
    await settle();
    await settle();

    // Local succeeded even while gpu-node-1 failed.
    expect(started).toEqual(["local:@acme/wsl", "gpu-node-1:@acme/bwrap"]);
    const recovery = modal.querySelector('[data-testid="batch-install-failure-recovery"]');
    expect(recovery).not.toBeNull();
    expect(modal.textContent).toContain("gpu-node-1");
    expect(modal.textContent).toContain("could not reach github.com");

    await click(modal.querySelector('[data-testid="batch-failure-manual-config"]') as HTMLButtonElement);
    expect(onOpenSources).toHaveBeenCalledTimes(1);

    await click(modal.querySelector('[data-testid="batch-failure-agent-config"]') as HTMLButtonElement);
    expect(onConfigureWithAi).toHaveBeenCalledWith([
      { specifier: "@acme/bwrap", error: "could not reach github.com" },
    ]);

    // Retry only retries the failed remote item, skipping already-installed local item.
    failRemote = false;
    started.length = 0;
    await click(modal.querySelector('[data-testid="batch-install-retry"]') as HTMLButtonElement);
    await settle();
    await settle();
    expect(started).toEqual(["gpu-node-1:@acme/bwrap"]);
    expect(modal.querySelector('[data-testid="batch-install-failure-recovery"]')).toBeNull();
  });
});
