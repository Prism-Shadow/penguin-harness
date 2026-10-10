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
 * - gives the one thing to do one home, or none: under the failure for a failed machine, at the
 *   top of Actions for every other machine that needs one, and nowhere for a ready machine, one
 *   installed as far as it goes, one with a job on its way, or this server's own entry;
 * - lets a failed machine reach every action — Retry, Force install, the single steps and the ways
 *   out — each asking its page for its own verb;
 * - explains a failure: the step it stopped at, in the far side's own words, with Force install
 *   only when the failure offers it;
 * - holds the single steps while a job is on its way, and says why, but never the ways out; says
 *   why Install, Disconnect and Restart wait when there is no build to push, nothing connected, or
 *   a machine out of reach; offers Disconnect while a connection is held;
 * - holds every verb while a request is in flight;
 * - repeats the page's last error, since it covers the notice that says it;
 * - is this server's record alone for its own entry: no verb, no steps, no Actions;
 * - folds a job that finished well into one line with its log closed, and opens a running job's
 *   log.
 *
 * Every state renders a card and a dialog, the state said by the card mark's accessible name and
 * by the dialog's status chip.
 *
 * The update notice counts the machines in use on another build; waved away, it stays down while
 * the same machines are behind and comes back when another falls behind or the build moves.
 *
 * vitest runs node-only here, so components are called as functions and their handlers handed
 * clicks as a browser delivers them (test/helpers/dom.ts); a few are rendered to static markup.
 * The dialog's verbs are found by their `data-verb`, its steps by their `data-step`, never by
 * their words.
 */
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MachineInfo, MachineJob, MachinesResponse } from "@prismshadow/penguin-server/api";
import * as ui from "@prismshadow/penguin-ui";
import { Button, RuledSection } from "@prismshadow/penguin-ui";
import { Stepper, MachineCard, machineMark } from "../src/features/machines/machine-card";
import type { MachineCardProps } from "../src/features/machines/machine-card";
import {
  JobSteps,
  LogFold,
  MachineDetailBody,
} from "../src/features/machines/machine-detail-dialog";
import type {
  MachineDetailBodyProps,
  MachineVerb,
} from "../src/features/machines/machine-detail-dialog";
import { machineChip } from "../src/features/machines/machine-detail-view";
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
const readyBehind = remote("build-box-2", {
  installed: { version: "0.2.12", at: "2026-09-20T08:00:00.000Z" },
  connection: { pid: 41227 },
  status: { state: "running", checkedAt: CHECKED, port: 7364 },
});
const notConnected = remote("office-2", {
  status: { state: "running", checkedAt: CHECKED, port: 7364 },
});
const linkedStopped = remote("mini", { connection: { pid: 2 } });
const unreachable = remote("edge-1", {
  status: { state: "unreachable", checkedAt: CHECKED, detail: "Connection timed out" },
});
const winBox = remote("win-box");
const fresh = remote("fresh", { status: null });
const here: MachineInfo = {
  ...remote("penguin-dev"),
  id: "local",
  local: true,
  status: { state: "running", checkedAt: CHECKED, port: 7364 },
};

const job = (machine: MachineInfo, over: Partial<MachineJob>): MachineJob => ({
  kind: "use",
  machineId: machine.id,
  alias: machine.alias,
  queued: false,
  running: false,
  phase: null,
  log: [],
  result: null,
  ...over,
});
/** The far side's own words for a failed restart. */
const NO_ANSWER = "No answer on port 7364 within 30 s.";
const failedJob = (machine: MachineInfo, canReplaceProgram: boolean): MachineJob =>
  job(machine, {
    phase: "restart",
    log: ["Restarting its server…", NO_ANSWER],
    result: { ok: false, step: "restart", message: NO_ANSWER, canReplaceProgram },
  });
const runningJob = (machine: MachineInfo): MachineJob =>
  job(machine, {
    running: true,
    phase: "install",
    log: ["Downloading penguin-harness 0.2.13…"],
  });
const queuedJob = (machine: MachineInfo): MachineJob => job(machine, { queued: true });
const doneJob = (machine: MachineInfo): MachineJob =>
  job(machine, {
    phase: "sync",
    log: ["Connected on port 7364.", "Handed over the Model config."],
    result: { ok: true, connected: true },
  });
/** A use that ended at installed: as far as this server can take the machine. */
const installedJob = (machine: MachineInfo): MachineJob =>
  job(machine, {
    phase: "install",
    log: ["Installed 0.2.13."],
    result: { ok: true, installed: "installed", version: IMAGE },
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

/** The shared package's components: the browser renders them; here they stay as they are. */
const SHARED: ReadonlySet<unknown> = new Set(Object.values(ui));

/** A node's children as one flat list: a component may hand on a list inside its own. */
const nodes = (node: ReactNode): ReactNode[] =>
  Array.isArray(node) ? node.flatMap((child: ReactNode) => nodes(child)) : [node];

/**
 * Every element of a tree, depth first, with the dialog's own components drawn — called as
 * functions, as React would call them — so what they draw is in the list. The shared package's
 * components keep their children only, and the log fold, which holds state, is read from static
 * markup instead (`foldOpen`).
 */
function drawn(node: ReactNode): AnyElement[] {
  return nodes(node)
    .filter(isValidElement)
    .flatMap((el) => {
      const element = el as AnyElement;
      const own =
        typeof element.type === "function" && !SHARED.has(element.type) && element.type !== LogFold;
      const inside = own
        ? (element.type as (props: unknown) => ReactNode)(element.props)
        : element.props.children;
      return [element, ...drawn(inside as ReactNode)];
    });
}

/** The words a drawn tree spells, run together. */
const words = (tree: AnyElement[]) =>
  tree
    .flatMap((el) => nodes(el.props.children as ReactNode))
    .filter((child) => typeof child === "string" || typeof child === "number")
    .join(" ");

/** A verb's button as the dialog draws it: its look, whether it waits, its hint, and its press. */
interface VerbButton {
  variant: unknown;
  disabled: boolean;
  /** The hint on the wrapper the button sits in: why it waits, or what it does. */
  hint: unknown;
  press: () => void;
}

/** The verb buttons of a drawn tree, by `data-verb`. */
function verbsOf(tree: AnyElement[]): Map<string, VerbButton> {
  const verbs = new Map<string, VerbButton>();
  for (const wrapper of tree) {
    for (const child of nodes(wrapper.props.children as ReactNode)) {
      if (!isValidElement(child) || child.type !== Button) continue;
      const button = child as AnyElement;
      const verb = button.props["data-verb"];
      if (typeof verb !== "string") continue;
      verbs.set(verb, {
        variant: button.props.variant,
        disabled: button.props.disabled === true,
        hint: wrapper.props["data-tooltip"],
        press: button.props.onClick as () => void,
      });
    }
  }
  return verbs;
}

const isPrimary = (el: AnyElement) => el.type === Button && el.props.variant === "primary";

/** What one of the dialog's ruled sections draws, found by its title; null when it is absent. */
function section(tree: AnyElement[], title: string): AnyElement[] | null {
  const found = tree.find((el) => el.type === RuledSection && el.props.title === title);
  return found === undefined ? null : drawn(found.props.children as ReactNode);
}

/** Whether the job's log fold starts open; null when the dialog draws none. */
function foldOpen(tree: AnyElement[]): boolean | null {
  const fold = tree.find((el) => el.type === LogFold);
  if (fold === undefined) return null;
  const html = renderToStaticMarkup(createElement(LogFold, fold.props as { job: MachineJob }));
  return /aria-expanded="true"/.test(html);
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
  const tree = drawn(MachineDetailBody(props));
  return { props, tree, verbs: verbsOf(tree), onAct };
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
      expect(dialog(machine, null).verbs.has("stopUsing"), machine.alias).toBe(true);
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
  /** Each state, and where its one thing to do lives: under the failure, in Actions, or nowhere. */
  const HOMES: [string, MachineInfo, MachineJob | null, "progress" | "actions" | null][] = [
    ["this server", here, null, null],
    ["connected", ready, doneJob(ready), null],
    ["connected, on another build", readyBehind, null, "actions"],
    ["on another build", behind, null, "actions"],
    ["not connected", notConnected, null, "actions"],
    ["stopped", stopped, null, "actions"],
    ["connected, its server stopped", linkedStopped, null, "actions"],
    ["out of reach", unreachable, null, "actions"],
    ["installed as far as it goes", winBox, installedJob(winBox), null],
    ["never checked", fresh, null, "actions"],
    ["queued", stopped, queuedJob(stopped), null],
    ["working", behind, runningJob(behind), null],
    ["failed", stopped, failedJob(stopped, true), "progress"],
  ];

  it.each(HOMES)("%s: the one thing to do has one home, or none", (_, machine, job, home) => {
    const { tree, verbs, onAct } = dialog(machine, job);
    const count = (els: AnyElement[] | null) => (els ?? []).filter(isPrimary).length;
    expect(count(tree)).toBe(home === null ? 0 : 1);
    expect(count(section(tree, S.machines.detail.progress))).toBe(home === "progress" ? 1 : 0);
    expect(count(section(tree, S.machines.detail.actions))).toBe(home === "actions" ? 1 : 0);
    // Whatever it says, it asks for the whole pipeline.
    for (const primary of tree.filter(isPrimary)) {
      expect(primary.props["data-verb"]).toBe("use");
      (primary.props.onClick as () => void)();
      expect(onAct).toHaveBeenLastCalledWith("use");
    }
    // Nothing else asks for the whole pipeline.
    expect(verbs.has("use")).toBe(home !== null);
  });

  it("lets a failed machine reach every action — Retry, Force install, the single steps and the ways out — each asking its page for its own verb", () => {
    const { verbs, onAct } = dialog(stopped, failedJob(stopped, true));
    const offered: MachineVerb[] = [
      "use",
      "replaceProgram",
      "install",
      "connect",
      "restart",
      "configure",
      "stopUsing",
      "release",
    ];
    for (const verb of offered) {
      const button = verbs.get(verb);
      expect(button?.disabled, verb).toBe(false);
      onAct.mockClear();
      button!.press();
      expect(onAct, verb).toHaveBeenCalledWith(verb);
    }
    // Nothing is connected, so there is nothing to disconnect.
    expect(verbs.get("disconnect")?.disabled).toBe(true);
  });

  it("explains a failure: the step it stopped at, in the far side's own words, with Force install only when the failure offers it", () => {
    const { tree, verbs } = dialog(stopped, failedJob(stopped, true));
    expect(words(tree)).toContain(NO_ANSWER);
    const marked = tree.filter((el) => el.type === "li" && el.props["data-state"] === "failed");
    expect(marked.map((el) => el.props["data-step"])).toEqual(["restart"]);
    expect(verbs.has("replaceProgram")).toBe(true);
    expect(dialog(stopped, failedJob(stopped, false)).verbs.has("replaceProgram")).toBe(false);
  });

  it("holds the single steps while a job is on its way, saying why, and never the ways out", () => {
    const { verbs } = dialog(ready, runningJob(ready));
    for (const verb of ["install", "connect", "restart"]) {
      expect(verbs.get(verb), verb).toMatchObject({
        disabled: true,
        hint: S.machines.detail.hold.moving,
      });
    }
    for (const verb of ["stopUsing", "disconnect", "release", "configure"]) {
      expect(verbs.get(verb)?.disabled, verb).toBe(false);
    }
  });

  it("says why Install, Disconnect and Restart wait — no build to push, nothing connected, a machine out of reach — and offers Disconnect while a connection is held", () => {
    const hold = S.machines.detail.hold;
    expect(dialog(ready, null, { noImage: true }).verbs.get("install")).toMatchObject({
      disabled: true,
      hint: hold.noImage,
    });
    expect(dialog(stopped, null).verbs.get("disconnect")).toMatchObject({
      disabled: true,
      hint: hold.noConnection,
    });
    expect(dialog(unreachable, null).verbs.get("restart")).toMatchObject({
      disabled: true,
      hint: hold.unreachable,
    });
    const connected = dialog(ready, null);
    connected.verbs.get("disconnect")!.press();
    expect(connected.onAct).toHaveBeenCalledWith("disconnect");
  });

  it("holds every verb while a request is in flight", () => {
    for (const [machine, job] of [
      [stopped, failedJob(stopped, true)],
      [behind, null],
    ] as const) {
      const { verbs } = dialog(machine, job, { busy: true });
      expect(verbs.size, machine.alias).toBeGreaterThan(0);
      for (const [verb, button] of verbs) expect(button.disabled, verb).toBe(true);
    }
  });

  it("repeats the page's last error, since it covers the notice that says it", () => {
    const refused = "This server could not reach its ssh agent.";
    expect(words(dialog(stopped, null, { error: refused }).tree)).toContain(refused);
    expect(words(dialog(stopped, null).tree)).not.toContain(refused);
  });

  it("is this server's record alone for its own entry: no verb, no steps, no Actions", () => {
    const { tree, verbs } = dialog(here, null);
    expect(verbs.size).toBe(0);
    expect(tree.some((el) => el.type === JobSteps)).toBe(false);
    expect(section(tree, S.machines.detail.actions)).toBeNull();
  });

  it("folds a job that finished well into one line with its log closed, and opens a running job's log", () => {
    const done = dialog(ready, doneJob(ready));
    expect(done.tree.some((el) => el.type === JobSteps)).toBe(false);
    expect(words(done.tree)).toContain(S.machines.detail.lastJobDone);
    expect(foldOpen(done.tree)).toBe(false);

    const running = dialog(ready, runningJob(ready));
    expect(running.tree.some((el) => el.type === JobSteps)).toBe(true);
    expect(foldOpen(running.tree)).toBe(true);
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
    ["queued", stopped, queuedJob(stopped)],
    ["connected, its server stopped", linkedStopped, null],
    ["installed as far as it goes", winBox, installedJob(winBox)],
    ["never probed", fresh, null],
  ];

  it.each(cases)(
    "%s: renders a card and a dialog, the state said by the mark's name and the dialog's chip",
    (_, machine, job) => {
      const reading = machine.local ? null : readMachine(machine, job, IMAGE);
      const label = machineMark(reading).label;
      const html = renderToStaticMarkup(
        createElement(MachineCard, { ...card(machine, job).props }),
      );
      expect(html).toContain(machine.alias);
      expect(html).toContain(`aria-label="${label.replace(/"/g, "&quot;")}"`);
      const body = renderToStaticMarkup(
        createElement(MachineDetailBody, dialog(machine, job).props),
      );
      // A path may break after any separator: the markup carries those breaks between its parts.
      expect(body.split("<wbr/>").join("")).toContain(machine.root);
      expect(body).toContain(machineChip(reading, IMAGE).word);
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
