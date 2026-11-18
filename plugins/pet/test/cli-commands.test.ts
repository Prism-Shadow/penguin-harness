/**
 * The pet's CLI command contribution: the data half as the class declares it (the page, the
 * command and the routes), and the code half (`registerPetCommands`) against a fake state
 * channel — the same shape `setup` closes over, the commander node the server would locate
 * for the `pet` key.
 */
import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { cliCommandKeyFault } from "@prismshadow/penguin-core/cli";
import { Pet } from "../src/index.js";
import { registerPetCommands } from "../src/cli-commands.js";
import type { PetStateChannel } from "../src/settings.js";

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

/** The state channel, as `setup` builds it over the settings store: in-memory here. */
function fakeState(initial: Record<string, unknown> = {}): PetStateChannel & {
  doc: Record<string, unknown>;
  merges: Array<Record<string, unknown>>;
} {
  const fake = {
    doc: structuredClone(initial),
    merges: [] as Array<Record<string, unknown>>,
  };
  return {
    doc: fake.doc,
    merges: fake.merges,
    read: () => structuredClone(fake.doc),
    merge(update) {
      fake.merges.push(structuredClone(update));
      // Shallow per facet, the way mergePetState runs; the commands' updates are flat enough.
      const next = { ...fake.doc };
      for (const [facet, value] of Object.entries(update)) {
        if (value === null) {
          delete next[facet];
          continue;
        }
        next[facet] =
          typeof value === "object" && value !== null && typeof next[facet] === "object" && next[facet] !== null
            ? { ...(next[facet] as Record<string, unknown>), ...(value as Record<string, unknown>) }
            : value;
      }
      fake.doc = next;
      return structuredClone(next);
    },
  };
}

function registered(state: PetStateChannel, language: "en" | "zh" = "en") {
  const program = new Command();
  program.name("penguin").exitOverride();
  registerPetCommands(program as never, state, language);
  return program;
}

describe("the data half", () => {
  it("contributes a page, a command and its own state routes, and binds the command's code half", () => {
    // The field decorators record a class's @Bind fields when an instance is constructed
    // (kernel: fieldsOf); build one so the bind table exists.
    void new Pet();
    const meta = (Pet as unknown as Record<symbol, { contributes: Record<string, unknown[]> }>)[
      META
    ];
    const pages = meta.contributes["WebModule.pages"] as Array<Record<string, unknown>>;
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      id: "pet.page",
      key: "pet",
      path: "/pet",
      nav: "none",
      admin: false,
      title: "Pet",
      titleZh: "宠物",
    });
    expect((pages[0].renderer as { iframe: { src: string } }).iframe.src).toBe(
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

    const routes = meta.contributes["HttpModule.routes"] as Array<Record<string, unknown>>;
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      id: "PetStateRoutes.routes",
      prefix: "/api/plugins/@penguinharness/pet/state",
      auth: "user",
      order: 69,
    });

    const bind = (Pet as unknown as Record<symbol, Map<string, string>>)[FIELDS].bind;
    expect(bind.get("pet")).toBe("pet.cmd");
    expect(bind.get("routes")).toBe("PetStateRoutes.routes");
  });

  it("the key is a valid command path", () => {
    expect(cliCommandKeyFault("pet")).toBeNull();
  });
});

describe("the code half", () => {
  it("status prints the name and fullness from the state", async () => {
    const state = fakeState({ pet: { name: "Mochi", fullness: 42 } });
    const program = registered(state);
    const run = await capture(() => program.parseAsync(["status"], { from: "user" }));
    expect(run.exitCode).toBe(0);
    expect(run.out).toContain("Mochi");
    expect(run.out).toContain("42/100");
    expect(state.merges).toHaveLength(0);
  });

  it("status speaks the language the server resolved", async () => {
    const state = fakeState({ pet: { fullness: 42 } });
    const program = registered(state, "zh");
    const run = await capture(() => program.parseAsync(["status"], { from: "user" }));
    expect(run.out).toContain("饱食度");
    expect(run.out).toContain("宠物");
  });

  it("feed eats a portion from the pantry and prints what the merge kept", async () => {
    const state = fakeState({ pet: { name: "Mochi", fullness: 90, food: 2 } });
    const program = registered(state);
    const run = await capture(() => program.parseAsync(["feed"], { from: "user" }));
    expect(run.exitCode).toBe(0);
    expect(state.merges).toEqual([{ pet: { fullness: 100, food: 1 } }]);
    expect(run.out).toContain("100/100");
    expect(run.out).toContain("1 portion");
  });

  it("feed takes several portions at once", async () => {
    const state = fakeState({ pet: { fullness: 10, food: 3 } });
    const program = registered(state);
    const run = await capture(() =>
      program.parseAsync(["feed", "--portions", "2"], { from: "user" }),
    );
    expect(run.exitCode).toBe(0);
    expect(state.merges).toEqual([{ pet: { fullness: 50, food: 1 } }]);
  });

  it("feed refuses a short pantry and a portion count that is not a positive whole number", async () => {
    const state = fakeState({ pet: { fullness: 10, food: 1 } });
    const program = registered(state);
    const short = await capture(() =>
      program.parseAsync(["feed", "--portions", "2"], { from: "user" }),
    );
    expect(short.exitCode).toBe(1);
    expect(short.err).toContain("not enough food");
    expect(state.merges).toHaveLength(0);

    const bad = await capture(() =>
      program.parseAsync(["feed", "--portions", "0"], { from: "user" }),
    );
    expect(bad.exitCode).toBe(1);
    expect(bad.err).toContain("positive whole number");
  });

  it("name merges the name, say merges the bubble", async () => {
    const state = fakeState();
    const program = registered(state);
    await capture(() => program.parseAsync(["name", "Mochi"], { from: "user" }));
    expect(state.merges[0]).toEqual({ pet: { name: "Mochi" } });
    await capture(() => program.parseAsync(["say", "hello"], { from: "user" }));
    expect(state.merges[1]).toEqual({ mood: { bubble: "hello", doing: "idle" } });
  });

  it("unknown subcommands fail the run", async () => {
    const state = fakeState();
    const program = registered(state);
    const run = await capture(() =>
      program.parseAsync(["typo"], { from: "user" }).catch(() => {}),
    );
    expect(run.err).toContain("typo");
    expect(state.merges).toHaveLength(0);
  });

  it("a state channel that throws fails the command on stderr, not the module", async () => {
    const program = new Command();
    program.name("penguin").exitOverride();
    registerPetCommands(
      program as never,
      {
        read: () => {
          throw new Error("store gone");
        },
        merge: () => {
          throw new Error("store gone");
        },
      },
      "en",
    );
    const run = await capture(async () => {
      // A handler's throw rejects the parse (commander does not print it itself).
      await expect(program.parseAsync(["status"], { from: "user" })).rejects.toThrow(
        "store gone",
      );
    });
    expect(run.out).toBe("");
  });
});
