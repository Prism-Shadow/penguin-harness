// @vitest-environment jsdom
/**
 * AgentTopologyView (features/chat/agent-topology-view.tsx): the pan-and-zoom call-graph canvas
 * in the subagents panel.
 *
 * - When only the root is present, neither the canvas nor the zoom control is shown.
 * - With spawned children, the header row holds the zoom control group (− / % / +) and optional
 *   turn pager, while the canvas group (`aria-label="Call graph"`) holds only the topology node
 *   buttons inside one transformed drawing layer.
 * - Opens fitted (`fitView`): a tree wider than the frame shrinks to fit and centres vertically;
 *   − / + step around the frame's centre and the percent button returns to the fit.
 * - Wheel events on the canvas zoom around the cursor and prevent outer scroll; keyboard shortcuts
 *   (+, -, 0, arrow keys) zoom, reset and pan when the canvas itself is focused.
 * - Dragging on the canvas (from empty space or starting on a node button) pans the view and
 *   suppresses the trailing node click, whereas a stationary click on a node button selects it.
 * - Switching to another Task turn re-fits the canvas to the newly displayed tree.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { fitView, viewTransform, zoomAt, ZOOM_STEP } from "../src/lib/canvas-view";
import {
  AgentTopologyView,
  layoutTopology,
  type TopologyNode,
} from "@prismshadow/penguin-library-session/web";
import { button, click, hasButton, mount, run, unmountAll } from "./helpers/dom";

const ROOT: TopologyNode = {
  sessionId: "root",
  agentId: "main_agent",
  description: null,
  origin: [],
  parentId: null,
  spawnThinkingLevel: null,
  depth: 0,
  running: true,
};

const CHILD_1: TopologyNode = {
  sessionId: "session-2026-07-14-09-05-11-child001",
  agentId: "researcher",
  description: "Survey existing canvas implementations",
  origin: ["session-2026-07-14-09-05-11-child001"],
  parentId: "root",
  spawnThinkingLevel: null,
  depth: 1,
  running: false,
  elapsedMs: 4200,
};

const CHILD_2: TopologyNode = {
  sessionId: "session-2026-07-14-09-05-12-child002",
  agentId: "coder",
  description: "Implement pan and zoom",
  origin: ["session-2026-07-14-09-05-11-child001", "session-2026-07-14-09-05-12-child002"],
  parentId: "session-2026-07-14-09-05-11-child001",
  spawnThinkingLevel: null,
  depth: 2,
  running: true,
  startedMs: 1_000,
};

function pointer(type: string, x: number, y: number): Event {
  const Ctor = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  return new Ctor(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
}

function canvasGroup(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[role="group"][aria-label="${en.subagentPanel.topologyLabel}"]`,
  );
  if (!el) throw new Error("no topology canvas group on screen");
  return el;
}

function drawingLayer(): HTMLElement {
  const layer = canvasGroup().firstElementChild as HTMLElement | null;
  if (!layer) throw new Error("no drawing layer inside canvas");
  return layer;
}

/** Stubs the canvas frame's measured box to `width` × `height` and triggers a resize measurement. */
async function sizeCanvasFrame(width: number, height: number): Promise<void> {
  const el = canvasGroup();
  Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: height });
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  await run(() => window.dispatchEvent(new Event("resize")));
}

beforeAll(() => setActiveStrings(en));
afterAll(() => setActiveStrings(zh));
afterEach(async () => {
  await unmountAll();
});

describe("AgentTopologyView canvas", () => {
  it("hides both the canvas and the zoom controls when only the root node is present", async () => {
    await mount(
      h(AgentTopologyView, {
        nodes: [ROOT],
        selectedId: null,
        labelFor: (n) => n.agentId ?? n.sessionId,
        avatarFor: () => undefined,
        onSelect: () => {},
      }),
    );

    expect(
      document.querySelector(`[role="group"][aria-label="${en.subagentPanel.topologyLabel}"]`),
    ).toBeNull();
    expect(hasButton(en.subagentPanel.zoomIn)).toBe(false);
    expect(hasButton(en.subagentPanel.zoomOut)).toBe(false);
  });

  it("keeps zoom controls in the header and only topology node buttons inside the call-graph group", async () => {
    const nodes = [ROOT, CHILD_1, CHILD_2];
    await mount(
      h(AgentTopologyView, {
        nodes,
        selectedId: CHILD_1.sessionId,
        labelFor: (n) => n.agentId ?? n.sessionId,
        avatarFor: () => undefined,
        onSelect: () => {},
        pager: h("span", { "data-testid": "turn-pager" }, "Page 2"),
      }),
    );

    const zoomGroup = document.querySelector(
      `[role="group"][aria-label="${en.subagentPanel.zoom}"]`,
    );
    expect(zoomGroup).not.toBeNull();
    expect(document.querySelector('[data-testid="turn-pager"]')?.textContent).toBe("Page 2");
    expect(zh.subagentPanel.page(3)).toBe("第 3 轮");

    // The call-graph group must contain only the topology node buttons (relied on by E2E locators).
    const graphButtons = canvasGroup().querySelectorAll("button");
    expect(graphButtons).toHaveLength(3);
  });

  it("opens fitted to the frame, steps zoom with + / −, and resets on clicking the percentage", async () => {
    const nodes = [ROOT, CHILD_1, CHILD_2];
    const layout = layoutTopology(nodes);
    await mount(
      h(AgentTopologyView, {
        nodes,
        selectedId: CHILD_1.sessionId,
        labelFor: (n) => n.agentId ?? n.sessionId,
        avatarFor: () => undefined,
        onSelect: () => {},
      }),
    );

    const frame = { width: 320, height: 120 };
    await sizeCanvasFrame(frame.width, frame.height);

    const fit = fitView(frame, { width: layout.width, height: layout.height });
    expect(fit.scale).toBeLessThan(1);
    expect(drawingLayer().style.transform).toBe(viewTransform(fit));

    // Zoom in around the frame's centre.
    await click(button(en.subagentPanel.zoomIn));
    const zoomedIn = zoomAt(fit, { x: frame.width / 2, y: frame.height / 2 }, ZOOM_STEP);
    expect(drawingLayer().style.transform).toBe(viewTransform(zoomedIn));

    // Clicking the percent readout returns to the fitted view.
    const fitBtn = document.querySelector<HTMLButtonElement>(
      `button[data-tooltip="${en.subagentPanel.zoomFit}"]`,
    )!;
    await click(fitBtn);
    expect(drawingLayer().style.transform).toBe(viewTransform(fit));
  });

  it("zooms around the cursor on wheel and pans/zooms via keyboard when the canvas is focused", async () => {
    const nodes = [ROOT, CHILD_1];
    await mount(
      h(AgentTopologyView, {
        nodes,
        selectedId: CHILD_1.sessionId,
        labelFor: (n) => n.agentId ?? n.sessionId,
        avatarFor: () => undefined,
        onSelect: () => {},
      }),
    );

    await sizeCanvasFrame(400, 120);
    const initialTransform = drawingLayer().style.transform;

    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
      clientX: 150,
      clientY: 60,
    });
    await run(() => canvasGroup().dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    const afterWheel = drawingLayer().style.transform;
    expect(afterWheel).not.toBe(initialTransform);

    // Keyboard shortcuts on the focused canvas: ArrowRight pans, "0" resets to fit.
    canvasGroup().focus();
    await run(() =>
      canvasGroup().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      ),
    );
    expect(drawingLayer().style.transform).not.toBe(afterWheel);

    await run(() =>
      canvasGroup().dispatchEvent(
        new KeyboardEvent("keydown", { key: "0", bubbles: true, cancelable: true }),
      ),
    );
    expect(drawingLayer().style.transform).toBe(initialTransform);
  });

  it("selects a node on a plain click, but pans the canvas and suppresses selection on a drag", async () => {
    const onSelect = vi.fn();
    const nodes = [ROOT, CHILD_1];
    await mount(
      h(AgentTopologyView, {
        nodes,
        selectedId: CHILD_1.sessionId,
        labelFor: (n) => n.agentId ?? n.sessionId,
        avatarFor: () => undefined,
        onSelect,
      }),
    );

    await sizeCanvasFrame(400, 120);
    const initialTransform = drawingLayer().style.transform;
    const rootBtn = canvasGroup().querySelectorAll("button")[0]!;

    // Plain click on the root node selects it without moving the view.
    await click(rootBtn);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith(ROOT);
    expect(drawingLayer().style.transform).toBe(initialTransform);

    // Dragging starting from the root node pans the canvas and suppresses the trailing click.
    onSelect.mockClear();
    await run(() => rootBtn.dispatchEvent(pointer("pointerdown", 100, 50)));
    await run(() => window.dispatchEvent(pointer("pointermove", 140, 70)));
    await run(() => window.dispatchEvent(pointer("pointerup", 140, 70)));
    await run(() =>
      rootBtn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 1 }),
      ),
    );

    expect(drawingLayer().style.transform).not.toBe(initialTransform);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("re-fits the canvas when switching to another Task turn or spawning additional subagents", async () => {
    const view = await mount(
      h(AgentTopologyView, {
        nodes: [ROOT, CHILD_1],
        selectedId: CHILD_1.sessionId,
        labelFor: (n) => n.agentId ?? n.sessionId,
        avatarFor: () => undefined,
        onSelect: () => {},
      }),
    );

    const frame = { width: 400, height: 120 };
    await sizeCanvasFrame(frame.width, frame.height);
    const fittedTransform = drawingLayer().style.transform;

    await click(button(en.subagentPanel.zoomIn));
    expect(drawingLayer().style.transform).not.toBe(fittedTransform);

    // Spawning a second subagent in the same turn re-fits the canvas so all subagents appear.
    const siblingChild: TopologyNode = {
      ...CHILD_1,
      sessionId: "session-2026-07-14-09-05-15-child003",
      origin: ["session-2026-07-14-09-05-15-child003"],
    };
    const twoChildNodes = [ROOT, CHILD_1, siblingChild];
    const twoChildLayout = layoutTopology(twoChildNodes);
    await view.rerender(
      h(AgentTopologyView, {
        nodes: twoChildNodes,
        selectedId: CHILD_1.sessionId,
        labelFor: (n) => n.agentId ?? n.sessionId,
        avatarFor: () => undefined,
        onSelect: () => {},
      }),
    );
    expect(drawingLayer().style.transform).toBe(
      viewTransform(fitView(frame, { width: twoChildLayout.width, height: twoChildLayout.height })),
    );

    // Zooming again and switching to another Task turn also re-fits.
    await click(button(en.subagentPanel.zoomIn));
    const otherTurnChild: TopologyNode = {
      ...CHILD_1,
      sessionId: "session-2026-07-14-09-06-00-otherturn",
      origin: ["session-2026-07-14-09-06-00-otherturn"],
    };
    await view.rerender(
      h(AgentTopologyView, {
        nodes: [ROOT, otherTurnChild],
        selectedId: otherTurnChild.sessionId,
        labelFor: (n) => n.agentId ?? n.sessionId,
        avatarFor: () => undefined,
        onSelect: () => {},
      }),
    );

    expect(drawingLayer().style.transform).toBe(fittedTransform);
  });
});
