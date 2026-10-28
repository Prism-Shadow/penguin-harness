/**
 * The Machines page's cards, the Machine dialog they open, and the update notice
 * (features/machines/machine-card.tsx, machine-detail-dialog.tsx, machines-view.ts `updateNotice`).
 *
 * A card
 * - opens its machine's dialog on a click anywhere on its body, and from its title, which says a
 *   dialog is what it opens; Settings opens it too;
 * - starts a conversation in the machine's temporary workspace with Use, opening nothing, while
 *   the machine is connected; otherwise Use waits and the card says why in words, not on a hover —
 *   a server stopped only when it is, not connected for one out of reach — and while a job moves
 *   there, its stepper says what is happening instead;
 * - while the server brings the machine back, says in its middle where that stands — the attempt
 *   of how many and the countdown to it, the last failure behind a "?", Retry now and Stop
 *   retrying — and after the automatic attempts stopped, that they failed, with Retry; each press
 *   asks the page for its own request; a refused password says the fix and offers nothing;
 * - asks to delete the machine with its trash button, never while a job is on its way;
 * - holds Use and Delete while a request is in flight;
 * - offers Sync config only on a connected machine on this server's build;
 * - on this server's own entry offers Use and Settings, and a delete that cannot be pressed.
 *
 * The dialog
 * - lays its verbs out in one toolbar, each asking its page for its own verb: Enable and Update
 *   for the whole pipeline, Stop or Start, Restart, Sync config, Configure SSH, Reinstall,
 *   Uninstall;
 * - says when the config was last synced, or why that failed, and lists what it could not carry:
 *   models keyed from this server's environment, models the machine would not take;
 * - greys a verb that cannot run and says why in one sentence under the toolbar, never on a
 *   hover; holds every verb while a request is in flight, the sentence unchanged;
 * - explains a failure: the step it stopped at, in the far side's own words, what the server's
 *   connection check found, then Retry — and, only when installing again may mend it, a line
 *   pointing at the toolbar's Reinstall, the one way to reinstall;
 * - says, while the server brings a machine back, where that stands with its presses (Retry asks
 *   the page to reconnect, Stop retrying to stop; none for a refused password), for how long, the
 *   last failure in full, and what the automatic check found;
 * - folds a job that finished well into one line with its log closed, opens a running job's log,
 *   and copies the whole log from a button beside it;
 * - says in Details, as text, ssh's own words for a machine out of reach and the time of the last
 *   check beside how long ago it was;
 * - repeats the page's last error, since it covers the notice that says it;
 * - is this server's record alone for its own entry: no verb, no steps.
 *
 * Every state renders a card and a dialog, the state said in words by the card's status pill — its
 * reason beside the word for a reader that cannot hover — and by the dialog's, and neither carries
 * a hint that cannot open: none but a marked one sits on words already on screen — what a card's
 * stat means, and the machine's id, are the dialog's to say.
 *
 * The update notice counts the machines in use on another build; waved away, it stays down while
 * the same machines are behind and comes back when another falls behind or the build moves.
 *
 * vitest runs node-only here, so components are called as functions — the shared package's
 * machine views (the card, the toolbar) drawn too, since they are this page's presentation — and
 * their handlers handed clicks as a browser delivers them (test/helpers/fake-dom.ts); a few are
 * rendered to static markup and read back as a tree (test/helpers/markup.ts). The dialog's verbs are found by their `data-verb`,
 * its steps by their `data-step`, the card's buttons by their `data-action`, never by their words.
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
import { MachineCard, machineMark } from "../src/features/machines/machine-card";
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
import { clickOn, fakeElement } from "./helpers/fake-dom";
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
  socket: null,
  api: null,
  status: { state: "stopped", checkedAt: CHECKED },
  root: "/home/ubuntu/.penguin/data",
  ...extra,
});
const stopped = remote("lab-mac");
const ready = remote("gpu-a100", {
  connection: { pid: 41226 },
  keepConnected: true,
  status: { state: "running", checkedAt: CHECKED, port: 7364 },
});
const behind = remote("build-box", {
  installed: { version: "0.2.12", at: "2026-09-20T08:00:00.000Z" },
  status: { state: "running", checkedAt: CHECKED, port: 7364 },
});
const readyBehind = remote("build-box-2", {
  installed: { version: "0.2.12", at: "2026-09-20T08:00:00.000Z" },
  connection: { pid: 41227 },
  keepConnected: true,
  status: { state: "running", checkedAt: CHECKED, port: 7364 },
});
const notConnected = remote("office-2", {
  status: { state: "running", checkedAt: CHECKED, port: 7364 },
});
/** ssh's own words for a machine it could not reach. */
const TIMED_OUT = "ssh: connect to host 10.0.0.12 port 22: Connection timed out";
const unreachable = remote("edge-1", {
  status: { state: "unreachable", checkedAt: CHECKED, detail: TIMED_OUT },
});
/** Kept connected, and being brought back by the server after its connection dropped. */
const comingBack = remote("mini", {
  connection: null,
  keepConnected: true,
  reconnect: {
    since: new Date(Date.now() - 6 * 60_000).toISOString(),
    attempts: 3,
    maxAttempts: 5,
    nextAt: new Date(Date.now() + 80_000).toISOString(),
    lastError: "mini refused. (ssh: connect to host mini port 22: Connection refused)",
    sshReason: "refused",
    diagnosis: {
      machineId: "ssh:mini",
      checkedAt: CHECKED,
      checks: [
        {
          id: "ssh",
          state: "fail",
          reason: "refused",
          said: "ssh: connect to host mini port 22: Connection refused",
        },
        { id: "platform", state: "skip" },
      ],
    },
  },
});
/** Kept connected, and the server stopped bringing it back after five failures in a row. */
const gaveUp = remote("lab-2", {
  connection: null,
  keepConnected: true,
  reconnect: {
    since: new Date(Date.now() - 4 * 60_000).toISOString(),
    attempts: 5,
    maxAttempts: 5,
    nextAt: null,
    gaveUp: "attempts",
    lastError: "lab-2 refused. (ssh: connect to host lab-2 port 22: Connection refused)",
    sshReason: "refused",
    diagnosis: null,
  },
});
/** Kept connected, and its stored password refused: nothing is tried until it is saved again. */
const locked = remote("vault", {
  connection: null,
  keepConnected: true,
  reconnect: {
    since: new Date(Date.now() - 2 * 60_000).toISOString(),
    attempts: 1,
    maxAttempts: 5,
    nextAt: null,
    lastError:
      "vault rejected the password saved for it. Enter it again in this machine's SSH settings.",
    sshReason: "password-rejected",
    diagnosis: null,
    waitsForPassword: true,
  },
});
const winBox = remote("win-box");
const fresh = remote("fresh", { status: null });
/** Added to the Project, nothing installed there yet: no record, no id, never probed. */
const added = remote("spare", { installed: null, machineId: null, status: null, member: true });
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
  steps: ["check", "install", "handover", "restart", "connect", "sync"],
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

/** The shared package's components: the browser renders them; here they stay as they are. */
const SHARED: ReadonlySet<unknown> = new Set(Object.values(ui));
/** The shared machine views this page hands its data to: drawn, so what they draw is in the list. */
const MACHINE_VIEWS: ReadonlySet<unknown> = new Set([ui.MachineCard, ui.MachineToolbar]);

/** A node's children as one flat list: a component may hand on a list inside its own. */
const nodes = (node: ReactNode): ReactNode[] =>
  Array.isArray(node) ? node.flatMap((child: ReactNode) => nodes(child)) : [node];

/**
 * Every element of a tree, depth first, with the dialog's own components drawn — called as
 * functions, as React would call them — so what they draw is in the list. The shared package's
 * components keep their children only, and the log fold, which holds state, is read from static
 * markup instead (`fold`).
 */
function drawn(node: ReactNode): AnyElement[] {
  return nodes(node)
    .filter(isValidElement)
    .flatMap((el) => {
      const element = el as AnyElement;
      const own =
        typeof element.type === "function" &&
        (!SHARED.has(element.type) || MACHINE_VIEWS.has(element.type)) &&
        element.type !== LogFold;
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

/** The sentence under the dialog's toolbar, read off the markup; null when there is none. */
function heldSentence(html: string): string | null {
  const found = elementsOf(readMarkup(html)).find((el) => "data-held" in el.attrs);
  return found === undefined ? null : seenText(found).trim();
}

/** What one of the dialog's ruled sections draws, found by its title; null when it is absent. */
function section(tree: AnyElement[], title: string): AnyElement[] | null {
  const found = tree.find((el) => el.type === RuledSection && el.props.title === title);
  return found === undefined ? null : drawn(found.props.children as ReactNode);
}

/** The job's log fold as it first renders: whether it is open, and whether it offers its copy. */
function fold(tree: AnyElement[]): { open: boolean; copy: boolean } | null {
  const found = tree.find((el) => el.type === LogFold);
  if (found === undefined) return null;
  const html = renderToStaticMarkup(createElement(LogFold, found.props as { job: MachineJob }));
  return {
    open: /aria-expanded="true"/.test(html),
    copy: elementsOf(readMarkup(html)).some(
      (el) => el.attrs["aria-label"] === S.machines.detail.copyLog,
    ),
  };
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
    onSyncConfig: vi.fn(),
    onDelete: vi.fn(),
    onRetry: vi.fn(async () => {}),
    onStopRetry: vi.fn(async () => {}),
  };
  // The card hands its data to the shared view; the view's own band is what a browser shows.
  const view = MachineCard(props) as AnyElement;
  const element = ui.MachineCard(view.props as unknown as ui.MachineCardProps) as AnyElement;
  const tree = all(element);
  /** The card's buttons by their `data-action`. */
  const buttons = new Map(
    tree
      .filter((el) => el.type === Button && typeof el.props["data-action"] === "string")
      .map((el) => [String(el.props["data-action"]), el]),
  );
  const main = tree.find((el) => el.type === "button" && el.props["aria-haspopup"] === "dialog");
  const html = renderToStaticMarkup(createElement(MachineCard, props));
  const waits = elementsOf(readMarkup(html)).find((el) => "data-use-waits" in el.attrs);
  return {
    props,
    element,
    tree,
    buttons,
    html,
    main: main!,
    waits: waits === undefined ? null : seenText(waits).trim(),
    /** The retry status in the card's middle, as the card hands it to the shared view. */
    retry: tree.find((el) => el.type === ui.RetryStatus)?.props as ui.RetryStatusProps | undefined,
  };
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
  return { props, tree, html, verbs: verbsOf(tree), held: heldSentence(html), onAct };
}

describe("a machine's card", () => {
  it("a click anywhere on its body opens its dialog, and so do its title and Settings", () => {
    const { element, props, main, buttons } = card(stopped);
    const { box, rootLine } = layout();
    const onClick = element.props.onClick as (event: never) => void;
    onClick(clickOn(rootLine, box));
    onClick(clickOn(box, box));
    expect(main.props["aria-haspopup"]).toBe("dialog");
    (main.props.onClick as () => void)();
    (buttons.get("settings")!.props.onClick as () => void)();
    expect(props.onOpen).toHaveBeenCalledTimes(4);
  });

  it("Use starts a conversation on a connected machine and opens nothing", () => {
    const { element, buttons, props, waits } = card(ready);
    const { box, glyph } = layout();
    expect(buttons.get("use")!.props.disabled).toBe(false);
    // The browser runs the button's handler, then the card's with the click's own target.
    (buttons.get("use")!.props.onClick as () => void)();
    (element.props.onClick as (event: never) => void)(clickOn(glyph, box));
    expect(props.onUse).toHaveBeenCalledOnce();
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(waits).toBeNull();
  });

  it("Use waits on a machine that is not connected, and the card says why in words", () => {
    const why = S.machines.card.why;
    const cases: [MachineInfo, MachineJob | null, string][] = [
      [stopped, null, why.stopped],
      [unreachable, null, why.notConnected],
      [added, null, why.notInstalled],
      [stopped, failedJob(stopped, true), why.failed],
    ];
    for (const [machine, job, line] of cases) {
      const shown = card(machine, job);
      expect(shown.buttons.get("use")!.props.disabled, machine.alias).toBe(true);
      expect(shown.waits, machine.alias).toBe(line);
    }
  });

  it("while the server brings the machine back, counts down in its middle to the attempt of how many, the last failure behind a ?; Retry now and Stop retrying each ask the page", () => {
    const shown = card(comingBack);
    expect(shown.retry).toMatchObject({
      phase: "waiting",
      label: S.machines.retry.trying(4, 5),
      reason: S.machines.check.ssh.refused("mini"),
      reasonTitle: S.machines.retry.lastFailure,
    });
    expect(shown.html).toContain("data-retry-countdown");
    // The failure is the "?"'s, not a line of the card.
    expect(seenText(readMarkup(shown.html))).not.toContain(S.machines.check.ssh.refused("mini"));
    expect(shown.waits).toBeNull();
    expect(shown.buttons.get("use")!.props.disabled).toBe(true);
    expect(shown.retry?.retry?.label).toBe(S.machines.retry.retryNow);
    expect(shown.retry?.secondary?.label).toBe(S.machines.retry.stop);
    void shown.retry!.retry!.onClick();
    expect(shown.props.onRetry).toHaveBeenCalledOnce();
    void shown.retry!.secondary!.onClick();
    expect(shown.props.onStopRetry).toHaveBeenCalledOnce();
    // A request from the page in flight holds both, as it holds Use and Delete.
    const held = card(comingBack, null, true).retry;
    expect(held?.retry?.disabled).toBe(true);
    expect(held?.secondary?.disabled).toBe(true);
  });

  it("after the automatic attempts ran out, says they failed with Retry alone, its pill in the row's danger tone; a refused password says the fix and offers nothing", () => {
    expect(card(gaveUp).html).toContain('data-machine-state="reconnectFailed"');
    expect(seenText(readMarkup(card(gaveUp).html))).toContain(S.machines.state.reconnectFailed);
    expect(card(gaveUp).retry).toMatchObject({
      phase: "gaveUp",
      label: S.machines.retry.gaveUp(5),
      reason: S.machines.check.ssh.refused("lab-2"),
      reasonTitle: S.machines.retry.lastFailure,
      retry: { label: S.machines.retry.retry },
      secondary: null,
    });
    const refused = card(locked);
    expect(refused.retry).toMatchObject({
      phase: "blocked",
      reason: S.machines.check.ssh["password-rejected"]("vault"),
    });
    expect(refused.retry?.retry).toBeNull();
    expect(refused.retry?.secondary).toBeNull();
    expect(refused.html).not.toContain("data-retry-action");
  });

  it("while a job moves there, shows its stepper in place of a reason, and holds Use and Delete", () => {
    const updating = card(behind, runningJob(behind));
    expect(updating.tree.some((el) => el.type === ui.MachineStepper)).toBe(true);
    expect(updating.waits).toBeNull();
    expect(updating.buttons.get("use")!.props.disabled).toBe(true);
    expect(updating.buttons.get("delete")!.props.disabled).toBe(true);
    expect(card(behind).tree.some((el) => el.type === ui.MachineStepper)).toBe(false);
  });

  it("asks to delete the machine with its trash button, and opens nothing", () => {
    const { buttons, props } = card(ready);
    (buttons.get("delete")!.props.onClick as () => void)();
    expect(props.onDelete).toHaveBeenCalledOnce();
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("holds Use and Delete while a request is in flight", () => {
    const { buttons } = card(ready, null, true);
    expect(buttons.get("use")!.props.disabled).toBe(true);
    expect(buttons.get("delete")!.props.disabled).toBe(true);
  });

  it("offers Sync config only on a connected machine on this server's build", () => {
    const { buttons, props } = card(ready);
    (buttons.get("sync-config")!.props.onClick as () => void)();
    expect(props.onSyncConfig).toHaveBeenCalledOnce();
    expect(props.onOpen).not.toHaveBeenCalled();
    for (const machine of [readyBehind, stopped, comingBack, added, here]) {
      expect(card(machine).buttons.has("sync-config"), machine.alias).toBe(false);
    }
  });

  it("this server's own card starts a conversation here, opens its dialog, and cannot be deleted", () => {
    const { buttons, props } = card(here);
    expect([...buttons.keys()]).toEqual(["use", "settings"]);
    expect(buttons.get("use")!.props.disabled).toBe(false);
    (buttons.get("use")!.props.onClick as () => void)();
    expect(props.onUse).toHaveBeenCalledOnce();
  });
});

describe("the Machine dialog", () => {
  it("lays its verbs out in one toolbar, each asking its page for its own verb", () => {
    const connected = dialog(readyBehind, null);
    expect([...connected.verbs.keys()]).toEqual([
      "update",
      "stop",
      "restart",
      "configure",
      "reinstall",
      "uninstall",
    ]);
    const asks: [string, MachineVerb][] = [
      ["update", "use"],
      ["stop", "stop"],
      ["restart", "restart"],
      ["configure", "configure"],
      ["reinstall", "reinstall"],
      ["uninstall", "uninstall"],
    ];
    for (const [verb, page] of asks) {
      connected.onAct.mockClear();
      connected.verbs.get(verb)!.press();
      expect(connected.onAct, verb).toHaveBeenCalledWith(page);
    }
    expect(connected.verbs.get("update")!.variant).toBe("primary");
    expect(connected.held).toBeNull();
    // A stopped machine is started; one with nothing installed is enabled.
    const start = dialog(stopped, null);
    start.verbs.get("start")!.press();
    expect(start.onAct).toHaveBeenCalledWith("start");
    const enable = dialog(added, null);
    expect([...enable.verbs.keys()]).toEqual(["enable", "configure"]);
    enable.verbs.get("enable")!.press();
    expect(enable.onAct).toHaveBeenCalledWith("use");
    // On this server's build, a connected machine's config is synced from the toolbar too.
    const inSync = dialog(ready, null);
    inSync.verbs.get("syncConfig")!.press();
    expect(inSync.onAct).toHaveBeenCalledWith("syncConfig");
  });

  it("says when the config was last synced or why it failed, and lists what it could not carry", () => {
    const at = new Date(Date.now() - 3 * 60_000).toISOString();
    const synced = dialog(
      { ...ready, configSync: { at, ok: true, envOnly: [], skipped: [] } },
      null,
    ).html;
    const line = elementsOf(readMarkup(synced)).find((el) => "data-config-sync" in el.attrs);
    expect(line?.attrs["data-config-sync"]).toBe("ok");
    expect(synced).not.toContain("data-env-only");
    expect(synced).not.toContain("data-skipped");

    const failed = dialog(
      {
        ...ready,
        configSync: {
          at,
          ok: false,
          detail: "Plugins not synced — it answered 500",
          envOnly: [
            { projectId: "p", provider: "openai", modelId: "gpt-5", variable: "OPENAI_API_KEY" },
          ],
          skipped: [
            {
              projectId: "p",
              provider: "penguin-go",
              modelId: "gemini-3.7-flash",
              code: "model_not_addable",
              reason: "cannot be added",
            },
            // One of this server's built-in models: the machine's build does not list it yet.
            {
              projectId: "p",
              provider: "minimax",
              modelId: "MiniMax-M3.1-Flash",
              code: "model_not_addable",
              reason: "cannot be added",
              builtInHere: true,
            },
          ],
        },
      },
      null,
    ).html;
    const c = S.machines.detail.configSync;
    const seen = seenText(readMarkup(failed));
    expect(seen).toContain(c.failed("Plugins not synced — it answered 500"));
    expect(seen).toContain(c.envOnly);
    expect(seen).toContain(
      c.skippedModel("penguin-go/gemini-3.7-flash", S.errors.byCode.model_not_addable),
    );
    expect(seen).toContain(c.skippedModel("minimax/MiniMax-M3.1-Flash", c.notInMachineBuild));
  });

  it("greys what cannot run, saying why once under the toolbar", () => {
    const shown = dialog(comingBack, null);
    expect(shown.verbs.get("stop")?.disabled).toBe(true);
    expect(shown.verbs.get("restart")?.disabled).toBe(true);
    expect(shown.verbs.get("uninstall")?.disabled).toBe(true);
    expect(shown.verbs.get("configure")?.disabled).toBe(false);
    expect(shown.held).toBe(S.machines.detail.held.unreachable);
  });

  it("holds every verb while a request is in flight, and leaves the sentence as it was", () => {
    for (const [machine, job] of [
      [stopped, failedJob(stopped, true)],
      [readyBehind, null],
      [comingBack, null],
    ] as const) {
      const { verbs, held } = dialog(machine, job, { busy: true });
      expect(verbs.size, machine.alias).toBeGreaterThan(0);
      for (const [verb, button] of verbs) expect(button.disabled, verb).toBe(true);
      expect(held, machine.alias).toBe(dialog(machine, job).held);
    }
  });

  it("explains a failure: the step, the far side's words, then Retry — and points at Reinstall only when it may mend it", () => {
    const { tree, html, verbs, onAct } = dialog(stopped, failedJob(stopped, true));
    expect(words(tree)).toContain(NO_ANSWER);
    const marked = tree.filter((el) => el.type === "li" && el.props["data-state"] === "failed");
    expect(marked.map((el) => el.props["data-step"])).toEqual(["restart"]);
    verbs.get("retry")!.press();
    expect(onAct).toHaveBeenCalledWith("use");
    // One way to reinstall: the toolbar's, which the failure points at in words.
    expect(seenText(readMarkup(html))).toContain(S.machines.detail.reinstallHint);
    expect([...verbsOf(section(tree, S.machines.detail.progress)!).keys()]).toEqual(["retry"]);
    verbs.get("reinstall")!.press();
    expect(onAct).toHaveBeenCalledWith("reinstall");
    const plain = dialog(stopped, failedJob(stopped, false)).html;
    expect(seenText(readMarkup(plain))).not.toContain(S.machines.detail.reinstallHint);
  });

  it("says what the server's connection check found after a failure, or that it is still checking", () => {
    const failing = (diagnosis: MachineJob["diagnosis"]) =>
      dialog(stopped, { ...failedJob(stopped, true), diagnosis });
    expect(seenText(readMarkup(failing({ state: "running" }).html))).toContain(
      S.machines.detail.checking,
    );
    const { html } = failing({
      state: "done",
      machineId: stopped.id,
      checkedAt: CHECKED,
      checks: [
        {
          id: "ssh",
          state: "fail",
          reason: "auth",
          said: "lab-mac did not accept any key… (ssh: ubuntu@10.0.0.12: Permission denied (publickey).)",
        },
        { id: "platform", state: "skip" },
      ],
    });
    const rows = elementsOf(readMarkup(html)).filter((el) => "data-check" in el.attrs);
    expect(rows.map((el) => [el.attrs["data-check"], el.attrs["data-state"]])).toEqual([
      ["ssh", "fail"],
      ["platform", "skip"],
    ]);
    expect(seenText(rows[0]!)).toContain(S.machines.check.ssh.auth("lab-mac"));
  });

  it("says, while the server brings the machine back, where that stands, for how long, the last failure and what the check found", () => {
    const { html, tree } = dialog(comingBack, null);
    const section_ = section(tree, S.machines.detail.reconnect.title);
    expect(section_).not.toBeNull();
    const seen = seenText(readMarkup(html));
    expect(html).toContain('data-retry-phase="waiting"');
    expect(seen).toContain(S.machines.detail.reconnect.lasting("6 minutes"));
    expect(seen).toContain(S.machines.check.ssh.refused("mini"));
    const rows = elementsOf(readMarkup(html)).filter((el) => "data-check" in el.attrs);
    expect(rows.map((el) => el.attrs["data-check"])).toEqual(["ssh", "platform"]);
    // Not coming back, nothing of it.
    expect(section(dialog(ready, null).tree, S.machines.detail.reconnect.title)).toBeNull();
  });

  it("offers Retry now and Stop retrying beside where the streak stands, each asking the page for its verb; a refused password offers none", () => {
    const retryIn = (machine: MachineInfo) => {
      const shown = dialog(machine, null);
      const found = section(shown.tree, S.machines.detail.reconnect.title)?.find(
        (el) => el.type === ui.RetryStatus,
      );
      return { status: found?.props as ui.RetryStatusProps | undefined, onAct: shown.onAct };
    };
    const back = retryIn(comingBack);
    expect(back.status?.size).toBe("sm");
    // The section says the last failure in full under the row: no "?" for it.
    expect(back.status?.reason).toBeNull();
    void back.status!.retry!.onClick();
    expect(back.onAct).toHaveBeenCalledWith("reconnect");
    void back.status!.secondary!.onClick();
    expect(back.onAct).toHaveBeenCalledWith("stopReconnecting");
    expect(retryIn(gaveUp).status).toMatchObject({
      phase: "gaveUp",
      retry: { label: S.machines.retry.retry },
    });
    expect(retryIn(locked).status).toMatchObject({ phase: "blocked", retry: null });
  });

  it("folds a job that finished well into one line with its log closed, opens a running job's log, and offers to copy it", () => {
    const done = dialog(ready, doneJob(ready));
    expect(done.tree.some((el) => el.type === JobSteps)).toBe(false);
    expect(words(done.tree)).toContain(S.machines.detail.lastJobDone);
    expect(fold(done.tree)?.open).toBe(false);

    const running = dialog(ready, runningJob(ready));
    expect(running.tree.some((el) => el.type === JobSteps)).toBe(true);
    // Open, the whole log can be copied in one press, as a code block's code can.
    expect(fold(running.tree)).toEqual({ open: true, copy: true });
    expect(fold(dialog(stopped, failedJob(stopped, true)).tree)).toEqual({
      open: false,
      copy: false,
    });
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

  it("repeats the page's last error, since it covers the notice that says it", () => {
    const refused = "This server could not reach its ssh agent.";
    expect(words(dialog(stopped, null, { error: refused }).tree)).toContain(refused);
    expect(words(dialog(stopped, null).tree)).not.toContain(refused);
  });

  it("is this server's record alone for its own entry: no verb, no steps", () => {
    const { tree, verbs, held } = dialog(here, null);
    expect(verbs.size).toBe(0);
    expect(held).toBeNull();
    expect(tree.some((el) => el.type === JobSteps)).toBe(false);
  });
});

describe("every state", () => {
  const cases: [string, MachineInfo, MachineJob | null][] = [
    ["this server", here, null],
    ["stopped", stopped, null],
    ["connected", ready, null],
    ["connected, its last job done", ready, doneJob(ready)],
    ["connected, on another build", readyBehind, null],
    ["not connected", notConnected, null],
    ["on another build", behind, null],
    ["out of reach", unreachable, null],
    ["failed", stopped, failedJob(stopped, true)],
    ["working", behind, runningJob(behind)],
    ["queued", stopped, queuedJob(stopped)],
    ["being brought back", comingBack, null],
    ["stopped being brought back", gaveUp, null],
    ["its password refused", locked, null],
    ["installed as far as it goes", winBox, installedJob(winBox)],
    ["never probed", fresh, null],
    ["added, nothing installed", added, null],
  ];

  /**
   * The unmarked hints in a piece of markup, each with the words of its own a reader sees. A
   * marked hint (`data-tooltip-extra`, the status pill's reason) says what the screen does not, and
   * shows over the words it sits on.
   */
  const hintsIn = (html: string) =>
    elementsOf(readMarkup(html))
      .filter((el) => "data-tooltip" in el.attrs && !("data-tooltip-extra" in el.attrs))
      .map((el) => ({ hint: el.attrs["data-tooltip"], words: seenText(el).trim() }));

  it.each(cases)(
    "%s: neither the card nor the dialog carries a hint that cannot open — none sits on words already on screen",
    (_, machine, job) => {
      const cardHtml = renderToStaticMarkup(createElement(MachineCard, card(machine, job).props));
      expect(cardHtml).toContain(machine.alias);
      for (const html of [cardHtml, dialog(machine, job, { host: HOST, noImage: true }).html]) {
        expect(hintsIn(html).filter((found) => found.words !== "")).toEqual([]);
      }
    },
  );

  it.each(cases)(
    "%s: renders a card and a dialog, the state said in words by the card's pill and the dialog's",
    (_, machine, job) => {
      const reading = machine.local ? null : readMachine(machine, job, IMAGE);
      const mark = machineMark(reading);
      const html = renderToStaticMarkup(
        createElement(MachineCard, { ...card(machine, job).props }),
      );
      expect(html).toContain(machine.alias);
      const markup = readMarkup(html);
      expect(seenText(markup)).toContain(mark.word);
      // The reason is the pill's hover, marked so it shows over the word, and is read out with it.
      if (mark.reason !== null) {
        const pill = elementsOf(markup).find((el) => el.attrs["data-tooltip"] === mark.reason);
        expect(pill?.attrs["data-tooltip-extra"]).toBe("true");
        expect(html).toContain(` · ${mark.reason}`);
      }
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
