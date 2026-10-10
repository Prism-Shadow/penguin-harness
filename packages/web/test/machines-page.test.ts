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
 * - says beside each single step and way out what it does;
 * - holds the single steps while a job is on its way and says why in their place, but never the
 *   ways out; says why Install, Disconnect and Restart wait when there is no build to push,
 *   nothing connected, or a machine out of reach; offers Disconnect while a connection is held;
 * - holds every verb while a request is in flight, and rewrites no line for it;
 * - offers Reconnect only where the one thing to do does not already connect;
 * - says in Details, as text, ssh's own words for a machine out of reach and the time of the last
 *   check beside how long ago it was;
 * - carries no hint that cannot open: none sits on words already on screen, in any state;
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
 * clicks as a browser delivers them (test/helpers/dom.ts); a few are rendered to static markup and
 * read back as a tree (test/helpers/markup.ts). The dialog's verbs are found by their `data-verb`,
 * its steps by their `data-step`, never by their words.
 */
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  MachineInfo,
  MachineJob,
  MachinesResponse,
  SshHostResponse,
} from "@prismshadow/penguin-server/api";
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
import { formatShortDateTime } from "../src/lib/format";
import { S } from "../src/lib/strings";
import { clickOn, fakeElement } from "./helpers/dom";
import { elementsOf, readMarkup, seenText } from "./helpers/markup";

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
/** ssh's own words for a machine it could not reach. */
const TIMED_OUT = "ssh: connect to host 10.0.0.12 port 22: Connection timed out";
const unreachable = remote("edge-1", {
  status: { state: "unreachable", checkedAt: CHECKED, detail: TIMED_OUT },
});
const winBox = remote("win-box");
const fresh = remote("fresh", { status: null });
const here: MachineInfo = {
  ...remote("penguin-dev"),
  id: "local",
  local: true,
  status: { state: "running", checkedAt: CHECKED, port: 7364 },
};
/** The host block an alias names, once the dialog has read it. */
const HOST: SshHostResponse = {
  alias: "edge-1",
  hostName: "10.0.0.12",
  user: "ubuntu",
  port: 22,
  editable: true,
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

/** A verb's button as the dialog draws it: its look, whether it waits, and its press. */
interface VerbButton {
  variant: unknown;
  disabled: boolean;
  press: () => void;
}

/** The verb buttons of a drawn tree, by `data-verb`. */
function verbsOf(tree: AnyElement[]): Map<string, VerbButton> {
  const verbs = new Map<string, VerbButton>();
  for (const el of tree) {
    const verb = el.props["data-verb"];
    if (el.type !== Button || typeof verb !== "string") continue;
    verbs.set(verb, {
      variant: el.props.variant,
      disabled: el.props.disabled === true,
      press: el.props.onClick as () => void,
    });
  }
  return verbs;
}

/**
 * What a reader sees beside each verb's button, by `data-verb`: the rest of the button's row —
 * what the verb does, or why it waits — read off the markup.
 */
function linesOf(html: string): Map<string, string> {
  const lines = new Map<string, string>();
  for (const el of elementsOf(readMarkup(html))) {
    const verb = el.attrs["data-verb"];
    if (verb === undefined || el.parent === null) continue;
    const rest = el.parent.children.filter((node) => node !== el);
    lines.set(verb, rest.map(seenText).join("").trim());
  }
  return lines;
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
  const html = renderToStaticMarkup(createElement(MachineDetailBody, props));
  return { props, tree, html, verbs: verbsOf(tree), lines: linesOf(html), onAct };
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

  /** Whether a verb waits, and what a reader sees beside its button. */
  const row = (shown: ReturnType<typeof dialog>, verb: MachineVerb) => ({
    disabled: shown.verbs.get(verb)?.disabled,
    line: shown.lines.get(verb),
  });

  it("says beside each single step and way out what it does", () => {
    const shown = dialog(ready, null);
    const does: [MachineVerb, string][] = [
      ["install", S.machines.verbs.installWhy],
      ["connect", S.machines.verbs.connectWhy],
      ["restart", S.machines.verbs.restartWhy],
      ["configure", S.machines.detail.configureSshWhy],
      ["stopUsing", S.machines.verbs.stopUsingWhy],
      ["disconnect", S.machines.verbs.disconnectWhy],
      ["release", S.machines.verbs.releaseWhy],
    ];
    for (const [verb, line] of does) {
      expect(row(shown, verb), verb).toEqual({ disabled: false, line });
    }
  });

  it("holds the single steps while a job is on its way, saying why in their place, and never the ways out", () => {
    const shown = dialog(ready, runningJob(ready));
    for (const verb of ["install", "connect", "restart"] as const) {
      expect(row(shown, verb), verb).toEqual({
        disabled: true,
        line: S.machines.detail.hold.moving,
      });
    }
    for (const verb of ["stopUsing", "disconnect", "release", "configure"] as const) {
      expect(shown.verbs.get(verb)?.disabled, verb).toBe(false);
    }
  });

  it("says why Install, Disconnect and Restart wait — no build to push, nothing connected, a machine out of reach — and offers Disconnect while a connection is held", () => {
    const hold = S.machines.detail.hold;
    expect(row(dialog(ready, null, { noImage: true }), "install")).toEqual({
      disabled: true,
      line: hold.noImage,
    });
    expect(row(dialog(stopped, null), "disconnect")).toEqual({
      disabled: true,
      line: hold.noConnection,
    });
    expect(row(dialog(unreachable, null), "restart")).toEqual({
      disabled: true,
      line: hold.unreachable,
    });
    const connected = dialog(ready, null);
    connected.verbs.get("disconnect")!.press();
    expect(connected.onAct).toHaveBeenCalledWith("disconnect");
  });

  it("holds every verb while a request is in flight, and rewrites no line for it", () => {
    for (const [machine, job] of [
      [stopped, failedJob(stopped, true)],
      [behind, null],
      [ready, runningJob(ready)],
    ] as const) {
      const { verbs, lines } = dialog(machine, job, { busy: true });
      expect(verbs.size, machine.alias).toBeGreaterThan(0);
      for (const [verb, button] of verbs) expect(button.disabled, verb).toBe(true);
      // The request lasts a moment: what each row says stays as it was.
      expect(lines, machine.alias).toEqual(dialog(machine, job).lines);
    }
  });

  it("offers Reconnect only where the one thing to do does not already connect", () => {
    // Connect and Try again run the whole pipeline, which connects and more.
    for (const machine of [notConnected, fresh, unreachable]) {
      const { verbs } = dialog(machine, null);
      expect(verbs.get("use")?.variant, machine.alias).toBe("primary");
      expect(verbs.has("connect"), machine.alias).toBe(false);
    }
    for (const [machine, job] of [
      [ready, null],
      [stopped, null],
      [behind, null],
      [stopped, failedJob(stopped, true)],
      [ready, runningJob(ready)],
    ] as const) {
      expect(dialog(machine, job).verbs.has("connect"), machine.alias).toBe(true);
    }
  });

  it("says in Details, as text, ssh's own words for a machine out of reach and the time of the last check beside how long ago it was", () => {
    const checkedAt = new Date(Date.now() - 4 * 60_000).toISOString();
    const away = remote("edge-2", {
      status: { state: "unreachable", checkedAt, detail: TIMED_OUT },
    });
    const seen = seenText(readMarkup(dialog(away, null).html));
    expect(seen).toContain(TIMED_OUT);
    expect(seen).toContain(formatShortDateTime(checkedAt));
  });

  it.each(HOMES)(
    "%s: carries no hint that cannot open — none sits on words already on screen",
    (_, machine, job) => {
      const { html } = dialog(machine, job, { host: HOST, noImage: true });
      const hints = elementsOf(readMarkup(html)).filter((el) => "data-tooltip" in el.attrs);
      // Each fixture has a machine id, whose copy button carries a hint: the markup was read.
      expect(hints.length).toBeGreaterThan(0);
      const onWords = hints
        .filter((el) => seenText(el).trim() !== "")
        .map((el) => `${el.attrs["data-tooltip"]} — on "${seenText(el).trim()}"`);
      expect(onWords).toEqual([]);
    },
  );

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
