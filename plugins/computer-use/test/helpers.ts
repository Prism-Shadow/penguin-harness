/**
 * What the suites share: a temp directory per test, the fake agent-desktop (one fake at the
 * program boundary, fixtures/fake-agent-desktop.mjs) with its scenario and call log, a tarball
 * writer for the installer's fixture, and a host-shaped run of the `computer` command.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Command, CommanderError } from "commander";
import type { CliCommandCaller, CliCommandFile } from "@prismshadow/penguin-core/cli";
import { afterEach } from "vitest";
import { computerCommand } from "../src/cli.js";
import { Probe } from "../src/probe.js";
import type { AgentDesktopProgram } from "../src/runner.js";
import { ComputerUseService } from "../src/service.js";
import { SelfTree } from "../src/self-target.js";
import type { ProcessRow } from "../src/self-target.js";

const made: string[] = [];
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A fresh directory, removed after the test. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "penguin-cu-"));
  made.push(dir);
  return dir;
}

export const FAKE = path.join(import.meta.dirname, "fixtures", "fake-agent-desktop.mjs");

/** One recorded call of the fake. */
export interface FakeCall {
  argv: string[];
  stdin: string;
  env: Record<string, string>;
  cwd: string;
}

export interface FakeAnswer {
  stdout?: unknown;
  stderr?: string;
  exit?: number;
  delayMs?: number;
  /** `screenshot`: base64 PNG bytes written to the path it was given. */
  png?: string;
}

/** A running app in a fake's world: its name as `list-apps` prints it, and the aliases a command's `--app` also takes. */
export interface FakeApp {
  name: string;
  pid: number;
  aliases?: string[];
}

/** A scenario for the fake: its answers by command (and the running apps), and the calls it records. */
export async function fakeAgentDesktop(
  answers: Record<string, FakeAnswer> = {},
  world?: FakeApp[],
) {
  const dir = await tempDir();
  const log = path.join(dir, "calls.jsonl");
  const scenario = path.join(dir, "scenario.json");
  fs.writeFileSync(log, "");
  const write = (a: Record<string, FakeAnswer>) =>
    fs.writeFileSync(scenario, JSON.stringify({ log, answers: a, ...(world ? { world } : {}) }));
  write(answers);
  const program: AgentDesktopProgram = { file: process.execPath, args: [FAKE, scenario] };
  return {
    program,
    answer(more: Record<string, FakeAnswer>) {
      answers = { ...answers, ...more };
      write(answers);
    },
    calls(): FakeCall[] {
      return fs
        .readFileSync(log, "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as FakeCall);
    },
  };
}

/** An envelope as agent-desktop 1.3.1 prints one. */
export function ok(command: string, data: unknown = {}) {
  return { version: "2.6", ok: true, command, data };
}

export function err(command: string, code: string, message: string, delivery = "not_delivered") {
  return {
    version: "2.6",
    ok: false,
    command,
    error: {
      code,
      message,
      disposition: { delivery, retry: delivery === "not_delivered" ? "safe" : "unsafe" },
    },
  };
}

/** A gzipped ustar archive of `files`, the way npm packs a tarball. */
export function tarGz(files: ReadonlyArray<{ path: string; data: Buffer; mode?: number }>): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const header = Buffer.alloc(512);
    header.write(file.path, 0, 100, "utf8");
    header.write(`${(file.mode ?? 0o755).toString(8).padStart(7, "0")}\0`, 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${file.data.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header.write("        ", 148, 8, "ascii");
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header, file.data, Buffer.alloc((512 - (file.data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export const sha512 = (data: Buffer) =>
  `sha512-${createHash("sha512").update(data).digest("base64")}`;

/** A PNG's first bytes: as much of one as a test needs. */
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** The settings a service reads, as the server's PluginConfig would hand them out. */
export function settingsReader(docs: Record<string, Record<string, unknown>> = {}) {
  return { get: (name: string) => docs[name] ?? {}, docs };
}

/**
 * A service running the fake in place of agent-desktop, on a temp data root, whose own process
 * tree is `ownPids` (by a fake process table: every pid's parent is 1 unless `parents` says).
 */
export async function testService(opts: {
  program: AgentDesktopProgram;
  settings?: Record<string, unknown>;
  ownPids?: number[];
  parents?: Record<number, number>;
  platform?: NodeJS.Platform;
  launch?: {
    dataDirs?: string[];
    pathDirs?: string[];
    trusted?: (file: string) => Promise<boolean>;
  };
}) {
  const root = await tempDir();
  const ownPids = opts.ownPids ?? [];
  const table = new Map<number, ProcessRow>(
    Object.entries(opts.parents ?? {}).map(([k, v]) => [Number(k), { ppid: v }]),
  );
  const service = new ComputerUseService({
    root,
    program: opts.program,
    env: { ...process.env, PENGUIN_TEST_SECRET: "sk-not-for-agent-desktop" },
    selfTree: new SelfTree(async () => table, ownPids.length > 0 ? ownPids : [999_999]),
    log: () => {},
    ...(opts.platform !== undefined ? { platform: opts.platform } : {}),
    ...(opts.launch !== undefined ? { launch: opts.launch } : {}),
  });
  const reader = settingsReader({ "computer-use": opts.settings ?? {} });
  service.bind(reader);
  return { root, service, probe: new Probe(service), reader };
}

/**
 * A system applications directory holding one desktop entry per `entries` item — as
 * `<dir>/applications/<id>.desktop` — a `bin/` beside it holding each entry's program (a bare
 * Exec name), and the lookup options that treat both as the system's.
 */
export async function desktopEntries(
  entries: Array<{ id: string; name: string; exec: string; extra?: string }>,
  /** Programs for `bin/`, when an Exec's first word is not the program (`env A=b prog`). */
  programs: string[] = [],
) {
  const dir = await tempDir();
  const bin = path.join(dir, "bin");
  await fs.promises.mkdir(path.join(dir, "applications"));
  await fs.promises.mkdir(bin);
  for (const e of entries) {
    await fs.promises.writeFile(
      path.join(dir, "applications", `${e.id}.desktop`),
      `[Desktop Entry]\nType=Application\nName=${e.name}\nExec=${e.exec}\n${e.extra ?? ""}`,
    );
    const first = e.exec.split(/\s+/)[0]!;
    if (!first.includes("/") && first !== "env") programs.push(first);
  }
  for (const program of programs) {
    await fs.promises.writeFile(path.join(bin, program), "#!/bin/sh\n", { mode: 0o755 });
  }
  return { dataDirs: [dir], pathDirs: [bin], trusted: async () => true, dir, bin };
}

/** What one run of `penguin computer …` printed, its exit code and the files it handed back. */
export interface CommandRun {
  stdout: string;
  stderr: string;
  exitCode: number;
  files: CliCommandFile[];
  /** stdout parsed, when it is one line of JSON. */
  json: Record<string, any> | null;
}

/**
 * Runs `args` through the `computer` command the way the server's host does: a fresh commander
 * program, the command's node at its key, the context with the caller and the files the terminal
 * sent.
 */
export async function runComputer(
  ready: { service: ComputerUseService; probe: Probe },
  args: string[],
  opts: {
    caller?: Partial<CliCommandCaller>;
    sent?: Record<string, Buffer>;
    language?: "en" | "zh";
  } = {},
): Promise<CommandRun> {
  let stdout = "";
  let stderr = "";
  let exitCode: number | undefined;
  const files: CliCommandFile[] = [];
  const program = new Command();
  program
    .name("penguin")
    .exitOverride()
    .configureOutput({ writeOut: (s) => void (stdout += s), writeErr: (s) => void (stderr += s) });
  const node = program.command("computer");
  computerCommand(() => ready).register(node as never, {
    messages: { language: opts.language ?? "en" },
    stdout: { write: (s) => void (stdout += s) },
    stderr: { write: (s) => void (stderr += s) },
    exit: (code) => {
      exitCode = code;
    },
    caller: { userId: "ann", isAdmin: true, projectId: "p1", sessionId: "s1", ...opts.caller },
    input: (value) => {
      const data = opts.sent?.[value];
      return data === undefined ? undefined : { name: path.basename(value), data };
    },
    output: (file) => void files.push(file),
  });
  try {
    await program.parseAsync(["computer", ...args], { from: "user" });
  } catch (e) {
    if (!(e instanceof CommanderError)) throw e;
    exitCode = e.exitCode;
  }
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(stdout) as Record<string, any>;
  } catch {
    json = null;
  }
  return { stdout, stderr, exitCode: exitCode ?? 0, files, json };
}
