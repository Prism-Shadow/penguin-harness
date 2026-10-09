/**
 * The Machines page's cards, the Machine dialog they open, and the update notice
 * (features/machines/machine-card.tsx, machine-detail-dialog.tsx, machines-view.ts `updateNotice`).
 *
 * A card
 * - opens its machine's dialog on a click anywhere on its body, a stopped machine's as any;
 * - has its title as its main button, which opens the dialog and says a dialog is what it opens;
 * - lets its Enable button enable the machine without opening anything;
 * - offers Update in Enable's place for a machine on another build, and neither for one that is
 *   connected or has a job on its way, whose stepper it shows instead;
 * - never offers Disable beside them, which would read as a toggle contradicting itself: the
 *   dialog holds it;
 * - offers no verb at all on this server's own card;
 * - holds its verbs while a request is in flight.
 *
 * The dialog
 * - offers, for a failed machine, every per-machine action the page had before — Retry, Force
 *   install, Enable, Disable, the ssh host — and the single steps the server takes one at a time,
 *   each asking its page for its own verb;
 * - offers Force install only when the failure asks for it;
 * - holds the steps that would collide with a running job, but never the ones that let go;
 * - offers Disconnect only while there is a connection to drop, and Install only while this server
 *   has a build to push;
 * - holds every verb while a request is in flight;
 * - is this server's record alone for its own entry: no job, no verbs.
 *
 * Every state renders a card and a dialog, the state said by the mark's accessible name.
 *
 * The update notice counts the machines in use on another build; waved away, it stays down while
 * the same machines are behind and comes back when another falls behind or the build moves.
 *
 * vitest runs node-only here, so components are called as functions and their handlers handed
 * clicks as a browser delivers them (test/helpers/dom.ts); a few are rendered to static markup.
 */
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MachineInfo, MachineJob, MachinesResponse } from "@prismshadow/penguin-server/api";
import { Button } from "@prismshadow/penguin-ui";
import { Stepper, MachineCard, machineMark } from "../src/features/machines/machine-card";
import type { MachineCardProps } from "../src/features/machines/machine-card";
import { MachineDetailBody } from "../src/features/machines/machine-detail-dialog";
import type {
  MachineDetailBodyProps,
  MachineVerb,
} from "../src/features/machines/machine-detail-dialog";
import { readMachine, updateNotice } from "../src/features/machines/machines-view";
import { S } from "../src/lib/strings";
import { clickOn, fakeElement } from "./helpers/dom";

const IMAGE = "0.2.13";
const CHECKED = "2026-10-09T08:00:00.000Z";

const remote = (alias: string, extra: Partial<MachineInfo> = {}): MachineInfo => ({
  id: `ssh:${alias}`,
  alias,
  installed: { version: IMAGE, at: "2026-10-01T08:00:00.000Z" },
  machineId: `Id${alias.replace(/[^a-z0-9]/gi, "")}0000000000`.slice(0, 16),
  local: false,
  connection: null,
  api: null,
  status: { state: "stopped", checkedAt: CHECKED },
  root: "/home/ubuntu/.penguin/data",
  ...extra,
});
const stopped = remote("lab-mac");
const ready = remote("gpu-a100", {
  connection: { pid: 41226 },
  status: { state: "running", checkedAt: CHECKED, port: 7364 },
});
const behind = remote("build-box", {
  installed: { version: "0.2.12", at: "2026-09-20T08:00:00.000Z" },
  status: { state: "running", checkedAt: CHECKED, port: 7364 },
});
const unreachable = remote("edge-1", {
  status: { state: "unreachable", checkedAt: CHECKED, detail: "Connection timed out" },
});
const here: MachineInfo = {
  ...remote("penguin-dev"),
  id: "local",
  local: true,
  status: { state: "running", checkedAt: CHECKED, port: 7364 },
};

const failedJob = (machine: MachineInfo, canReplaceProgram: boolean): MachineJob => ({
  kind: "use",
  machineId: machine.id,
  alias: machine.alias,
  queued: false,
  running: false,
  phase: "restart",
  log: ["Restarting its server…", "No answer on port 7364 within 30 s."],
  result: {
    ok: false,
    step: "restart",
    message: "No answer on port 7364 within 30 s.",
    canReplaceProgram,
  },
});
const runningJob = (machine: MachineInfo): MachineJob => ({
  kind: "use",
  machineId: machine.id,
  alias: machine.alias,
  queued: false,
  running: true,
  phase: "install",
  log: ["Downloading penguin-harness 0.2.13…"],
  result: null,
});

type AnyElement = ReactElement<Record<string, unknown>>;

/** Every element in a tree of plain elements, depth first, its children followed; nothing rendered. */
function all(node: ReactNode): AnyElement[] {
  return ([] as ReactNode[])
    .concat(node)
    .filter(isValidElement)
    .flatMap((el) => {
      const element = el as AnyElement;
      return [element, ...all(element.props.children as ReactNode)];
    });
}

/** The words a tree of elements spells. */
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement(node)) return text((node.props as { children?: ReactNode }).children);
  return "";
}

function card(machine: MachineInfo, job: MachineJob | null = null, busy = false) {
  const props: MachineCardProps = {
    machine,
    job,
    imageVersion: IMAGE,
    locale: "en",
    busy,
    onOpen: vi.fn(),
    onUse: vi.fn(),
    onConfigure: vi.fn(),
  };
  const element = MachineCard(props) as AnyElement;
  const tree = all(element);
  /** The card's buttons by their words, or by their name when they have none. */
  const buttons = new Map(
    tree
      .filter((el) => el.type === Button)
      .map((el) => [String(el.props["aria-label"] ?? text(el.props.children as ReactNode)), el]),
  );
  const main = tree.find((el) => el.type === "button" && el.props["aria-haspopup"] === "dialog");
  return { props, element, tree, buttons, main: main! };
}

/** The card's box, a line of its body, and a button inside it with its glyph. */
function layout() {
  const box = fakeElement("div");
  const rootLine = fakeElement("p", {}, box);
  const button = fakeElement("button", { type: "button" }, box);
  const glyph = fakeElement("svg", {}, button);
  return { box, rootLine, button, glyph };
}

function dialog(
  machine: MachineInfo,
  job: MachineJob | null,
  over: Partial<MachineDetailBodyProps> = {},
) {
  const onAct = vi.fn<(verb: MachineVerb) => void>();
  const props: MachineDetailBodyProps = {
    machine,
    job,
    imageVersion: IMAGE,
    locale: "en",
    host: null,
    error: null,
    busy: false,
    noImage: false,
    onAct,
    ...over,
  };
  const tree = all(MachineDetailBody(props));
  /** The dialog's verbs by their words: whether each waits, and what pressing it asks for. */
  const verbs = new Map(
    tree
      .filter((el) => typeof el.props.label === "string" && typeof el.props.onClick === "function")
      .map((el) => [
        el.props.label as string,
        { disabled: el.props.disabled === true, press: el.props.onClick as () => void },
      ]),
  );
  return { props, tree, verbs, onAct };
}

describe("a machine's card", () => {
  it("a click on a stopped machine's card opens its dialog, wherever on the body it lands", () => {
    const { element, props } = card(stopped);
    const { box, rootLine } = layout();
    const onClick = element.props.onClick as (event: never) => void;
    onClick(clickOn(rootLine, box));
    onClick(clickOn(box, box));
    expect(props.onOpen).toHaveBeenCalledTimes(2);
  });

  it("its title is the main button: it opens the dialog and says a dialog is what it opens", () => {
    const { main, props } = card(stopped);
    expect(main.props["aria-haspopup"]).toBe("dialog");
    (main.props.onClick as () => void)();
    expect(props.onOpen).toHaveBeenCalledOnce();
  });

  it("its Enable button enables the machine and opens nothing", () => {
    const { element, buttons, props } = card(stopped);
    const { box, glyph } = layout();
    // The browser runs the button's handler, then the card's with the click's own target.
    (buttons.get(S.machines.use)!.props.onClick as () => void)();
    (element.props.onClick as (event: never) => void)(clickOn(glyph, box));
    expect(props.onUse).toHaveBeenCalledOnce();
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("offers Update in Enable's place on another build, and neither when connected or busy with a job", () => {
    const old = card(behind);
    expect(old.buttons.has(S.machines.card.update)).toBe(true);
    expect(old.buttons.has(S.machines.use)).toBe(false);
    (old.buttons.get(S.machines.card.update)!.props.onClick as () => void)();
    expect(old.props.onUse).toHaveBeenCalledOnce();

    const connected = card(ready);
    expect(connected.buttons.has(S.machines.use)).toBe(false);
    expect(connected.buttons.has(S.machines.card.update)).toBe(false);

    const updating = card(behind, runningJob(behind));
    expect(updating.buttons.has(S.machines.use)).toBe(false);
    expect(updating.buttons.has(S.machines.card.update)).toBe(false);
    expect(updating.tree.some((el) => el.type === Stepper)).toBe(true);
    expect(card(behind).tree.some((el) => el.type === Stepper)).toBe(false);

    for (const c of [old, connected, updating]) {
      expect(c.buttons.has(S.machines.host.configure)).toBe(true);
    }
  });

  it("never offers Disable beside Enable or Update: the dialog holds it", () => {
    for (const machine of [stopped, ready, behind, unreachable]) {
      const { buttons } = card(machine);
      expect(buttons.has(S.machines.stopUsing), machine.alias).toBe(false);
      expect(dialog(machine, null).verbs.has(S.machines.stopUsing), machine.alias).toBe(true);
    }
  });

  it("this server's own card offers no verb: it is where the page is served from", () => {
    const { buttons, main, props } = card(here);
    expect(buttons.size).toBe(0);
    (main.props.onClick as () => void)();
    expect(props.onOpen).toHaveBeenCalledOnce();
  });

  it("holds its verbs while a request is in flight", () => {
    const { buttons } = card(stopped, null, true);
    expect([...buttons.keys()].sort()).toEqual([S.machines.use, S.machines.host.configure].sort());
    for (const [name, button] of buttons) expect(button.props.disabled, name).toBe(true);
  });
});

describe("the Machine dialog", () => {
  it("offers a failed machine every action the page had, and the single steps, each asking for its verb", () => {
    const { verbs, onAct } = dialog(stopped, failedJob(stopped, true));
    const expected: [string, MachineVerb][] = [
      [S.machines.detail.retry, "use"],
      [S.machines.replaceProgram, "replaceProgram"],
      [S.machines.use, "use"],
      [S.machines.stopUsing, "stopUsing"],
      [S.machines.verbs.install, "install"],
      [S.machines.verbs.connect, "connect"],
      [S.machines.verbs.restart, "restart"],
      [S.machines.verbs.release, "release"],
      [S.machines.host.configure, "configure"],
    ];
    for (const [label, verb] of expected) {
      const entry = verbs.get(label);
      expect(entry?.disabled, label).toBe(false);
      onAct.mockClear();
      entry!.press();
      expect(onAct, label).toHaveBeenCalledWith(verb);
    }
    // Nothing is connected, so there is nothing to disconnect.
    expect(verbs.get(S.machines.verbs.disconnect)?.disabled).toBe(true);
  });

  it("offers Force install only when the failure asks for it", () => {
    const { verbs } = dialog(stopped, failedJob(stopped, false));
    expect(verbs.has(S.machines.detail.retry)).toBe(true);
    expect(verbs.has(S.machines.replaceProgram)).toBe(false);
  });

  it("holds the steps that would collide with a running job, never the ones that let go", () => {
    const { verbs } = dialog(ready, runningJob(ready));
    for (const label of [
      S.machines.verbs.install,
      S.machines.verbs.connect,
      S.machines.verbs.restart,
    ]) {
      expect(verbs.get(label)?.disabled, label).toBe(true);
    }
    for (const label of [
      S.machines.stopUsing,
      S.machines.verbs.disconnect,
      S.machines.verbs.release,
      S.machines.host.configure,
    ]) {
      expect(verbs.get(label)?.disabled, label).toBe(false);
    }
    expect(verbs.has(S.machines.use)).toBe(false);
    expect(verbs.has(S.machines.detail.retry)).toBe(false);
  });

  it("offers Disconnect while a connection is held, and Install while this server has a build", () => {
    const connected = dialog(ready, null);
    connected.verbs.get(S.machines.verbs.disconnect)!.press();
    expect(connected.onAct).toHaveBeenCalledWith("disconnect");
    expect(
      dialog(ready, null, { noImage: true }).verbs.get(S.machines.verbs.install)?.disabled,
    ).toBe(true);
  });

  it("holds every verb while a request is in flight", () => {
    const { verbs } = dialog(stopped, failedJob(stopped, true), { busy: true });
    expect(verbs.size).toBeGreaterThan(0);
    for (const [label, entry] of verbs) expect(entry.disabled, label).toBe(true);
  });

  it("is this server's record alone for its own entry: no job, no verbs", () => {
    const { verbs, tree } = dialog(here, null);
    expect(verbs.size).toBe(0);
    expect(tree.some((el) => el.type === Stepper)).toBe(false);
  });
});

describe("every state", () => {
  const cases: [string, MachineInfo, MachineJob | null][] = [
    ["this server", here, null],
    ["stopped", stopped, null],
    ["connected", ready, null],
    ["on another build", behind, null],
    ["out of reach", unreachable, null],
    ["failed", stopped, failedJob(stopped, true)],
    ["working", behind, runningJob(behind)],
    ["never probed", remote("fresh", { status: null }), null],
  ];

  it.each(cases)(
    "%s: renders a card and a dialog, the state said by the mark's name",
    (_, machine, job) => {
      const label = machineMark(machine.local ? null : readMachine(machine, job, IMAGE)).label;
      const html = renderToStaticMarkup(
        createElement(MachineCard, { ...card(machine, job).props }),
      );
      expect(html).toContain(machine.alias);
      expect(html).toContain(`aria-label="${label.replace(/"/g, "&quot;")}"`);
      expect(
        renderToStaticMarkup(createElement(MachineDetailBody, dialog(machine, job).props)),
      ).toContain(machine.root);
    },
  );
});

describe("the update notice", () => {
  const response = (machines: MachineInfo[], imageVersion = IMAGE): MachinesResponse => ({
    machines: [here, ...machines],
    imageVersion,
    job: null,
    jobs: [],
  });

  it("counts the machines in use on another build, and is absent when none is", () => {
    expect(updateNotice(response([ready, behind]), new Set())?.ids).toEqual([behind.id]);
    expect(updateNotice(response([ready, stopped]), new Set())).toBeNull();
  });

  it("waved away, stays down for the same machines and comes back when another falls behind or the build moves", () => {
    const first = updateNotice(response([ready, behind]), new Set())!;
    const dismissed = new Set(first.keys);
    expect(updateNotice(response([ready, behind]), dismissed)).toBeNull();

    const another = remote("nas", { installed: { version: "0.2.11", at: CHECKED } });
    expect(updateNotice(response([ready, behind, another]), dismissed)?.ids).toEqual([
      behind.id,
      another.id,
    ]);
    expect(updateNotice(response([ready, behind], "0.2.14"), dismissed)?.ids).toEqual([
      behind.id,
      ready.id,
    ]);
  });
});
