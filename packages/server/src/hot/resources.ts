/**
 * Runtime-side live resources for the hot platform tree.
 *
 * The linear-state rule for live resources: a pty/child process never enters
 * the parked context document — it lives here, the document only carries its
 * handle id, and boot claims it back. Because the registry (and its output
 * buffers) sit outside the reloadable tree, a platform swap never interrupts
 * the process and never loses output produced during the freeze window.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { Resources } from "@prismshadow/penguin-core/kernel";

/** Output buffer cap per process (chunks are dropped oldest-first past this). */
const MAX_BUFFER_BYTES = 128 * 1024;

export interface ShellProcResource {
  kind: "shell-proc";
  proc: ChildProcess;
  /** Full buffered output (stdout+stderr interleaved), capped. */
  read(): string;
  write(data: string): void;
  alive(): boolean;
  kill(): void;
}

export class HotResources implements Resources {
  private readonly map = new Map<string, unknown>();

  register(id: string, resource: unknown): void {
    this.map.set(id, resource);
  }

  claim<T = unknown>(id: string): T | undefined {
    return this.map.get(id) as T | undefined;
  }

  release(id: string): void {
    this.map.delete(id);
  }

  /** Process-exit sweep: kill every live shell process. Not part of any upgrade path. */
  disposeAll(): void {
    for (const resource of this.map.values()) {
      const proc = resource as Partial<ShellProcResource>;
      if (proc.kind === "shell-proc" && typeof proc.kill === "function") proc.kill();
    }
    this.map.clear();
  }
}

/** Spawns a shell command whose lifetime and output buffer are runtime-owned. */
export function spawnShellResource(
  resources: Resources,
  id: string,
  command: string,
  cwd: string,
): ShellProcResource {
  const proc = spawn(command, { shell: true, cwd, stdio: ["pipe", "pipe", "pipe"] });
  const chunks: string[] = [];
  let bufferedBytes = 0;
  let exited = false;
  const push = (data: Buffer): void => {
    const text = data.toString("utf8");
    chunks.push(text);
    bufferedBytes += text.length;
    while (bufferedBytes > MAX_BUFFER_BYTES && chunks.length > 1) {
      bufferedBytes -= chunks[0]!.length;
      chunks.shift();
    }
  };
  proc.stdout?.on("data", push);
  proc.stderr?.on("data", push);
  proc.on("exit", () => {
    exited = true;
  });
  // 'error' (e.g. spawn failure) must not crash the server; surface it in the buffer.
  proc.on("error", (err) => {
    exited = true;
    push(Buffer.from(`[spawn error] ${err.message}\n`));
  });

  const resource: ShellProcResource = {
    kind: "shell-proc",
    proc,
    read: () => chunks.join(""),
    write: (data) => void proc.stdin?.write(data),
    alive: () => !exited,
    kill: () => {
      if (!exited) proc.kill();
    },
  };
  resources.register(id, resource);
  return resource;
}
