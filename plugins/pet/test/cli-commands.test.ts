/**
 * The pet's CLI command contribution: the data half as the class declares it (both slots,
 * the bind), and the code half (`registerPetCommands`) against a fake state channel — the
 * same shape the server hands a run (PluginCliCommandHost), the commander node the host
 * would locate for the `pet` key.
 */
import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { cliCommandKeyFault } from "@prismshadow/penguin-core/cli";
import { Pet } from "../src/index.js";
import { registerPetCommands } from "../src/cli-commands.js";
import type { PluginCliCommandHost } from "@prismshadow/penguin-server/plugin";

const META = Symbol.for("@prismshadow/penguin-core/kernel:meta");
const FIELDS = Symbol.for("@prismshadow/penguin-core/kernel:fields");

/** Captures the process streams for the duration of one fn, the way a server run does. */
async function capture(fn: () => Promise<void> | void) {
  const out = { text: "" };
  const err = { text: "" };
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  const priorExit = process.exitCode;
  process.stdout.write = (c: unknown) => void (out.text += String(c));
  process.stderr.write = (c: unknown) => void (err.text += String(c));
  process.exitCode = 0;
  try {
    await fn();
    return { out: out.text, err: err.text, exitCode: process.exitCode ?? 0 };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    process.exitCode = priorExit;
  }
}

interface FakeState {
  doc: Record<string, unknown>;
  merges: Array<Record<string, unknown>>;
}

function fakeHost(state: FakeState, language: "en" | "zh" = "en"): PluginCliCommandHost {
  return {
    messages: { language },
    state: {
      read: () => structuredClone(state.doc),
      merge: (update) => {
        state.merges.push(structuredClone(update));
        state.doc = { ...state.doc, ...structuredClone(update) };
        return structuredClone(state.doc);
      },
    },
  };
}

function registered(state: FakeState, language: "en" | "zh" = "en") {
  const program = new Command();
  program.name("penguin").exitOverride();
  registerPetCommands(program as never, fakeHost(state, language));
  return program;
}

describe("the data half", () => {
  it("contributes a widget and a command, and binds the command's code half", () => {
    const meta = (Pet as unknown as Record<symbol, { contributes: Record<string, unknown[]> }>)[
      META
    ];
    const widgets = meta.contributes["WebModule.widgets"] as Array<Record<string, unknown>>;
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({
      id: "pet.widget",
      key: "pet",
      title: "Pet",
      titleZh: "宠物",
      size: "small",
    });
    expect((widgets[0].renderer as { iframe: { src: string } }).iframe.src).toBe(
      "/api/plugins/@penguinharness/pet/ui/widget.html",
    );

    const commands = meta.contributes["PluginCliCommandsProvider.commands"] as Array<
      Record<string, unknown>
    >;
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      id: "pet.cmd",
      key: "pet",
      summary: { en: expect.any(String), zh: expect.any(String) },
    });

    const bind = (Pet as unknown as Record<symbol, Map<string, string>>)[FIELDS].bind;
    expect(bind.get("pet")).toBe("pet.cmd");
  });

  it("the key is a valid command path", () => {
    expect(cliCommandKeyFault("pet")).toBeNull();
  });
});

describe("the code half", () => {
  it("status prints the name and fullness from the state", async () => {
    const state: FakeState = { doc: { pet: { name: "Mochi", fullness: 42 } }, merges: [] };
    const program = registered(state);
    const run = await capture(() => program.parseAsync(["status"], { from: "user" }));
    expect(run.exitCode).toBe(0);
    expect(run.out).toContain("Mochi");
    expect(run.out).toContain("42/100");
    expect(state.merges).toHaveLength(0);
  });

  it("status speaks the host's language", async () => {
    const state: FakeState = { doc: { pet: { fullness: 42 } }, merges: [] };
    const program = registered(state, "zh");
    const run = await capture(() => program.parseAsync(["status"], { from: "user" }));
    expect(run.out).toContain("饱食度");
    expect(run.out).toContain("宠物");
  });

  it("feed merges the added fullness and prints what the server kept", async () => {
    const state: FakeState = { doc: { pet: { name: "Mochi", fullness: 90 } }, merges: [] };
    const program = registered(state);
    const run = await capture(() =>
      program.parseAsync(["feed", "--amount", "20"], { from: "user" }),
    );
    expect(run.exitCode).toBe(0);
    expect(state.merges).toEqual([{ pet: { fullness: 100 } }]);
    expect(run.out).toContain("100/100");
  });

  it("feed defaults to +20 and reports a non-numeric amount on stderr", async () => {
    const state: FakeState = { doc: {}, merges: [] };
    const program = registered(state);
    const ok = await capture(() => program.parseAsync(["feed"], { from: "user" }));
    expect(ok.exitCode).toBe(0);
    expect(state.merges[0]).toEqual({ pet: { fullness: 20 } });

    const bad = await capture(() =>
      program.parseAsync(["feed", "--amount", "lots"], { from: "user" }),
    );
    expect(bad.exitCode).toBe(1);
    expect(bad.err).toContain("number");
  });

  it("name merges the name, say merges the bubble", async () => {
    const state: FakeState = { doc: {}, merges: [] };
    const program = registered(state);
    await capture(() => program.parseAsync(["name", "Mochi"], { from: "user" }));
    expect(state.merges[0]).toEqual({ pet: { name: "Mochi" } });
    await capture(() => program.parseAsync(["say", "hello"], { from: "user" }));
    expect(state.merges[1]).toEqual({ mood: { bubble: "hello", doing: "idle" } });
  });

  it("unknown subcommands fail the run", async () => {
    const state: FakeState = { doc: {}, merges: [] };
    const program = registered(state);
    const run = await capture(() => program.parseAsync(["typo"], { from: "user" }));
    expect(run.exitCode).not.toBe(0);
    expect(run.err).toContain("typo");
    expect(state.merges).toHaveLength(0);
  });

  it("a state channel that throws fails the command on stderr, not the host", async () => {
    const program = new Command();
    program.name("penguin").exitOverride();
    registerPetCommands(program as never, {
      messages: { language: "en" },
      state: {
        read: () => {
          throw new Error("store gone");
        },
        merge: () => {
          throw new Error("store gone");
        },
      },
    });
    const run = await capture(() => program.parseAsync(["status"], { from: "user" }));
    expect(run.exitCode).toBe(1);
    expect(run.err).toContain("store gone");
  });
});
