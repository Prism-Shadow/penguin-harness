/**
 * @prismshadow/penguin-plugin-machine-wsl — the WSL machine KIND, for a server on Windows:
 * every WSL distro installed there is a machine, `wsl:<distro>`, reached through wsl.exe.
 *
 * A PLUGIN PACKAGE, not part of the platform: a Project enables it on the Plugins page, like a
 * sandbox backend. It compiles against `@prismshadow/penguin-server/plugin` (types only) and
 * contributes to `MachinesModule.kinds`.
 *
 * A distro is ANOTHER MACHINE, not this one: its own filesystem, its own data root, installed
 * the POSIX way; the host's self-check goes by machine id, not by address.
 *
 *   launch   `wsl.exe -d <distro> [-u <user>] --exec sh`, with `WSL_UTF8=1` — the host holds it
 *            and frames its commands like any other shell
 *   dial     a bridge (bridge.ts): `wsl.exe … --exec sh -c '<node> -e <bridge> <port>'`, with the
 *            Node the installed program carries, connecting to the distro's own loopback
 *   discover `wsl.exe --list --quiet`, cached and refreshed in the background — discover must not
 *            start a process on the list's own path
 *   forwards none: this kind has no port forwarding, and says so (`forwards()` is null)
 *
 * WHICH DISTROS ARE NOT MACHINES. Docker Desktop's own (`docker-desktop*`), and any whose name
 * starts `penguin-`: the WSL sandbox backend (plugins/sandbox-wsl) creates `penguin-sandbox`,
 * a distro with interop switched off for confining this server's own Agents — installing a
 * server in it would be a machine made of the sandbox. A sandbox distro given another name in
 * that plugin's settings is not recognized; that residue is stated in the README.
 *
 * wsl.exe writes UTF-16 by default; `WSL_UTF8=1` asks for UTF-8, and the listing is decoded
 * either way (with or without a BOM), since a build that ignores the variable exists.
 */
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import type {
  ExecResult,
  Machine,
  MachineDefinition,
  MachineDial,
  MachineForwards,
  MachineKind,
  ShellLaunch,
} from "@prismshadow/penguin-server/plugin";
import type net from "node:net";
import path from "node:path";
import { bridgeArgs, dialViaBridge, runProgram, runText } from "./bridge.js";

export { BRIDGE_SCRIPT, bridgeArgs, dialViaBridge } from "./bridge.js";

/** The environment every wsl.exe call gets: UTF-8 out, rather than UTF-16. */
const WSL_ENV = { WSL_UTF8: "1" };

/**
 * The distros a `wsl.exe --list --quiet` listing names, less the ones that are not machines.
 * UTF-16LE is recognised by its BOM or by the NUL every ASCII character carries in it.
 */
export function parseDistros(output: Buffer): string[] {
  const utf16 =
    (output.length >= 2 && output[0] === 0xff && output[1] === 0xfe) ||
    (output.length >= 2 && output[1] === 0 && output[0] !== 0);
  const text = (utf16 ? output.toString("utf16le") : output.toString("utf8")).replace(/^﻿/, "");
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.replaceAll("\0", "").trim())
        .filter((name) => name !== "" && isMachineDistro(name)),
    ),
  ];
}

/** Not Docker Desktop's plumbing, and not one of this harness's own (sandbox-wsl's `penguin-sandbox`). */
export function isMachineDistro(name: string): boolean {
  return !/^docker-desktop/i.test(name) && !/^penguin-/i.test(name);
}

/** Test seams. */
export interface WslInternals {
  platform?: NodeJS.Platform;
  /** The wsl.exe to run. */
  wsl?: string;
}

/** How long a listing is trusted before the next read refreshes it in the background. */
const LIST_TTL_MS = 30_000;

export class WslMachine implements Machine {
  constructor(
    readonly distro: string,
    private readonly wsl: string,
    readonly user = "",
  ) {}

  #target(): string[] {
    return ["-d", this.distro, ...(this.user === "" ? [] : ["-u", this.user])];
  }

  async launch(): Promise<ShellLaunch> {
    return { program: this.wsl, args: [...this.#target(), "--exec", "sh"], env: WSL_ENV };
  }

  async up(): Promise<void> {}

  /**
   * Nothing to bring up: wsl.exe starts a stopped distro on the first call. (Reasoned, not
   * measured on a real Windows: a distro WSL stopped for idling is started again by `launch`.)
   */
  async ready(): Promise<{ ok: true }> {
    return { ok: true };
  }

  dial(port: number, via: MachineDial): Promise<net.Socket> {
    return dialViaBridge(
      this.wsl,
      [...this.#target(), "--exec", ...bridgeArgs(via.node, port)],
      WSL_ENV,
    );
  }

  oneShot(command: string, opts: { timeoutMs?: number; input?: Buffer }): Promise<ExecResult> {
    return runText(this.wsl, [...this.#target(), "--exec", "sh", "-c", command], {
      env: WSL_ENV,
      ...(opts.input === undefined ? {} : { input: opts.input }),
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    });
  }

  /** Each file streamed into the distro on a `cat`, one call per file. */
  async copyTo(localFiles: string[], remoteDir: string): Promise<ExecResult> {
    const fs = await import("node:fs/promises");
    for (const file of localFiles) {
      const input = await fs.readFile(file);
      const target = `${remoteDir.replace(/\/$/, "")}/${path.basename(file)}`;
      const result = await runText(
        this.wsl,
        [...this.#target(), "--exec", "sh", "-c", 'cat > "$1"', "sh", target],
        { env: WSL_ENV, input },
      );
      if (result.code !== 0) return result;
    }
    return { code: 0, stdout: "", stderr: "", timedOut: false };
  }

  diagnose(): null {
    return null;
  }

  /** This kind has no port forwarding. */
  forwards(): MachineForwards | null {
    return null;
  }
}

/** The WSL kind: the distros installed on this Windows machine. */
export class WslKind implements MachineKind {
  readonly #platform: NodeJS.Platform;
  readonly #wsl: string;
  #distros: string[] = [];
  #listedAt = 0;
  #refreshing: Promise<void> | null = null;

  constructor(internals: WslInternals = {}) {
    this.#platform = internals.platform ?? process.platform;
    this.#wsl = internals.wsl ?? "wsl.exe";
  }

  /** The last listing; a stale one is refreshed in the background, never on this call's path. */
  discover(): string[] {
    if (this.#platform !== "win32") return [];
    if (Date.now() - this.#listedAt > LIST_TTL_MS) void this.refresh();
    return [...this.#distros];
  }

  /** Reads the listing now. A failed read keeps the last one: no WSL means no distros, not an error. */
  refresh(): Promise<void> {
    if (this.#platform !== "win32") return Promise.resolve();
    this.#refreshing ??= (async () => {
      const result = await runProgram(this.#wsl, ["--list", "--quiet"], {
        env: WSL_ENV,
        timeoutMs: 15_000,
      });
      this.#listedAt = Date.now();
      if (result.code === 0) this.#distros = parseDistros(result.stdout);
    })().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  /** Distros are installed with WSL, not defined here. */
  form(): null {
    return null;
  }

  async define(): Promise<MachineDefinition> {
    return {
      ok: false,
      field: null,
      message: "WSL distros are installed with WSL, not defined here",
    };
  }

  read(): null {
    return null;
  }

  connect(name: string): Machine {
    return new WslMachine(name, this.#wsl);
  }
}

@Component({
  contributes: {
    "WebModule.quickStarts": [
      {
        id: "machine-wsl.quick-start",
        prompt:
          "List the WSL distros on this Windows machine with `wsl.exe --list --verbose` and report a table: name, state, WSL version. Then say which of them the Machines page offers as machines — every one except Docker Desktop's (docker-desktop*) and this harness's own (penguin-*, such as the sandbox distro).",
        promptZh:
          "用 `wsl.exe --list --verbose` 列出这台 Windows 机器上的 WSL 发行版，用表格报告：名称、状态、WSL 版本。然后说明机器页会把其中哪些列为机器——除 Docker Desktop 的（docker-desktop*）与本 harness 自己的（penguin-*，例如沙盒发行版）之外的全部。",
      },
    ],
    "MachinesModule.kinds": [{ id: "machine-wsl.kind", kind: "wsl", title: "WSL" }],
  },
})
export class MachineWsl {
  @Bind("machine-wsl.kind") kind!: MachineKind;

  setup() {
    this.kind = new WslKind();
  }
}

const plugin: Plugin = { modules: [MachineWsl] };
export default plugin;
