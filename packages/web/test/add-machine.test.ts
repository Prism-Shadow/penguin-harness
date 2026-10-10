/**
 * The add dialog (features/machines/add-machine-dialog.tsx, add-machine-view.ts).
 *
 * - From the ssh config, it offers the hosts not on the page yet — not this server, not on this
 *   Project's list — in the config's order, each with how its own block reaches it beside the
 *   name (`user@host:port`, the default port unsaid, nothing when the block says no more than the
 *   name), and a host another Project installed says so; the search narrows them.
 * - With nothing left to offer it says so and points at the other tab, which its button opens;
 *   a search that matches nothing says so.
 * - By hand, it asks for the name, the host, the user name, the port (22 already filled in) and
 *   the key, and says only a wrong value in the danger ink.
 * - Add writes the new host first (by hand), then enables the machines when the box is ticked —
 *   it starts ticked — or only adds them to the page when it is not.
 * - Add waits until something is ticked on the first tab.
 *
 * vitest runs node-only here: the dialog's pure parts are rendered to static markup and read
 * back (test/helpers/markup.ts), its rows found by `data-host`, its fields by `data-field`, its
 * controls by `data-action` and `data-option`.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  MachineInfo,
  MachinesResponse,
  SshHostSummary,
} from "@prismshadow/penguin-server/api";
import { AddMachineBody, AddMachineFooter } from "../src/features/machines/add-machine-dialog";
import type {
  AddMachineBodyProps,
  AddMachineFooterProps,
} from "../src/features/machines/add-machine-dialog";
import { addPlan, hostRows, reachLine } from "../src/features/machines/add-machine-view";
import { NEW_HOST_FORM } from "../src/features/machines/ssh-host-dialog";
import { S } from "../src/lib/strings";
import { elementsOf, readMarkup, seenText } from "./helpers/markup";

const machine = (alias: string, extra: Partial<MachineInfo> = {}): MachineInfo => ({
  id: `ssh:${alias}`,
  alias,
  installed: null,
  machineId: null,
  local: false,
  connection: null,
  api: null,
  status: null,
  root: "$HOME/.penguin/data",
  ...extra,
});
const here = machine("workstation", { id: "local", local: true });
const INSTALLED = { version: "0.2.13", at: "2026-10-01T08:00:00.000Z" };

const state = (machines: MachineInfo[]): MachinesResponse => ({
  machines: [here, ...machines],
  imageVersion: "0.2.13",
  job: null,
  jobs: [],
});

const HOSTS: SshHostSummary[] = [
  { alias: "gpu-1", hostName: "10.0.0.21", user: "ubuntu", port: 2222 },
  { alias: "gpu-2", hostName: "10.0.0.22", user: "ubuntu", port: 22 },
  { alias: "nas" },
];

function body(over: Partial<AddMachineBodyProps> = {}) {
  const props: AddMachineBodyProps = {
    tab: "config",
    onTab: vi.fn(),
    rows: hostRows(state([machine("gpu-1"), machine("gpu-2"), machine("nas")]), HOSTS, ""),
    offered: 3,
    query: "",
    onQuery: vi.fn(),
    picked: new Set(),
    onPick: vi.fn(),
    form: NEW_HOST_FORM,
    errors: {},
    onField: vi.fn(),
    onEnter: vi.fn(),
    error: null,
    ...over,
  };
  const markup = readMarkup(renderToStaticMarkup(createElement(AddMachineBody, props)));
  const all = elementsOf(markup);
  return {
    props,
    markup,
    rows: all.filter((el) => "data-host" in el.attrs),
    fields: all.filter((el) => "data-field" in el.attrs),
    find: (attr: string, value: string) => all.find((el) => el.attrs[attr] === value),
  };
}

describe("the hosts the ssh config offers", () => {
  it("are those not on the page yet, in the config's order, each with how its own block reaches it", () => {
    const inUse = machine("box", { installed: INSTALLED, member: true });
    const added = machine("spare", { member: true });
    const rows = hostRows(
      state([machine("gpu-1"), inUse, machine("gpu-2"), added, machine("nas")]),
      HOSTS,
      "",
    );
    expect(rows.map((row) => [row.machine.alias, row.reach])).toEqual([
      ["gpu-1", "ubuntu@10.0.0.21:2222"],
      ["gpu-2", "ubuntu@10.0.0.22"],
      ["nas", null],
    ]);
  });

  it("say the reach the way ssh would be told it, and nothing when the block says no more than the name", () => {
    expect(reachLine({ alias: "a", hostName: "h.lan" })).toBe("h.lan");
    expect(reachLine({ alias: "a", user: "root" })).toBe("root@a");
    expect(reachLine({ alias: "a", port: 2200 })).toBe("a:2200");
    expect(reachLine({ alias: "a" })).toBeNull();
    expect(reachLine(undefined)).toBeNull();
  });

  it("narrow to the search, and render each as a row to tick with its reach and another Project's install", () => {
    const narrowed = hostRows(
      state([machine("gpu-1"), machine("gpu-2"), machine("nas")]),
      HOSTS,
      "g2",
    );
    expect(narrowed.map((row) => row.machine.alias)).toEqual(["gpu-2"]);
    const elsewhere = machine("nas", { elsewhere: INSTALLED });
    const { rows } = body({
      rows: hostRows(state([machine("gpu-1"), elsewhere]), HOSTS, ""),
      picked: new Set(["ssh:gpu-1"]),
    });
    expect(rows.map((el) => [el.attrs["data-host"], el.attrs["data-picked"]])).toEqual([
      ["gpu-1", "true"],
      ["nas", "false"],
    ]);
    expect(seenText(rows[0]!)).toContain("ubuntu@10.0.0.21:2222");
    expect(seenText(rows[1]!)).toContain(S.machines.addDialog.elsewhere("0.2.13"));
  });
});

describe("the dialog's tabs", () => {
  it("with nothing left in the config, says so and points at filling one in by hand", () => {
    const view = body({ rows: [], offered: 0 });
    expect(view.find("data-empty", "no-hosts")).toBeDefined();
    expect(seenText(view.markup)).toContain(S.machines.addDialog.noHosts);
    expect(view.find("data-action", "to-manual")).toBeDefined();
    expect(view.rows).toEqual([]);
  });

  it("says a search that matches nothing, naming it", () => {
    const view = body({ rows: [], offered: 3, query: "zz" });
    expect(view.find("data-empty", "no-match")).toBeDefined();
    expect(seenText(view.markup)).toContain(S.machines.addDialog.noMatch("zz"));
  });

  it("by hand, asks for the name, host, user name, port — 22 already filled in — and key, and says a wrong value under its field", () => {
    const view = body({ tab: "manual", errors: { port: S.machines.host.portRange } });
    expect(view.fields.map((el) => el.attrs["data-field"])).toEqual([
      "alias",
      "hostName",
      "user",
      "port",
      "identityFile",
    ]);
    expect(view.fields.find((el) => el.attrs["data-field"] === "port")?.attrs.value).toBe("22");
    expect(seenText(view.markup)).toContain(S.machines.host.portRange);
    expect(view.rows).toEqual([]);
  });

  it("says why the last Add did not go through", () => {
    expect(seenText(body({ error: "That alias is already in the ssh config." }).markup)).toContain(
      "That alias is already in the ssh config.",
    );
  });
});

describe("Add", () => {
  it("enables the ticked hosts when the box is ticked, and only adds them when it is not", () => {
    expect(addPlan("config", ["ssh:gpu-1", "ssh:nas"], "", true)).toEqual({
      writeHost: false,
      machines: ["ssh:gpu-1", "ssh:nas"],
      verb: "use",
    });
    expect(addPlan("config", ["ssh:gpu-1"], "", false).verb).toBe("add");
  });

  it("by hand, writes the new host first and then adds that one machine", () => {
    expect(addPlan("manual", ["ssh:gpu-1"], " lab-box ", true)).toEqual({
      writeHost: true,
      machines: ["ssh:lab-box"],
      verb: "use",
    });
  });

  it("waits until something is ticked, and the box beside it starts ticked", () => {
    const footer = (over: Partial<AddMachineFooterProps>) => {
      const props: AddMachineFooterProps = {
        installNow: true,
        onInstallNow: vi.fn(),
        submitLabel: S.machines.addDialog.submit,
        canSubmit: true,
        busy: false,
        onCancel: vi.fn(),
        onSubmit: vi.fn(),
        ...over,
      };
      const root = readMarkup(renderToStaticMarkup(createElement(AddMachineFooter, props)));
      const els = elementsOf(root);
      return {
        add: els.find((el) => el.attrs["data-action"] === "add")!,
        box: els.find((el) => el.attrs["data-option"] === "install-now")!,
        text: seenText(root),
      };
    };
    expect("disabled" in footer({ canSubmit: false }).add.attrs).toBe(true);
    const ready = footer({});
    expect("disabled" in ready.add.attrs).toBe(false);
    expect("checked" in ready.box.attrs).toBe(true);
    expect(ready.text).toContain(S.machines.addDialog.installNow);
  });
});
