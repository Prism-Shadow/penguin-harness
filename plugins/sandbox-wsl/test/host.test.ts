/**
 * WSL output as the settings card and provisioning task receive it.
 *
 * - Given UTF-16LE Chinese diagnostics, with or without a BOM and split across byte boundaries,
 *   when WSL exits, the caller receives readable text on both stdout and stderr.
 * - Given UTF-8 output, with or without a BOM, when WSL exits, Chinese text stays intact.
 * - Given differently encoded stdout and stderr, when WSL exits, each is decoded independently
 *   and WSL proxy notices are removed after decoding.
 * - Given UTF-8 provisioning progress split inside a Chinese character, when a line arrives,
 *   the callback receives the complete text before the process exits.
 * - Given no output, when WSL exits, both result streams are empty.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWsl } from "../src/host.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

function wslProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
  return child;
}

beforeEach(() => vi.clearAllMocks());

describe("WSL output", () => {
  it.each([false, true])("preserves split UTF-16LE Chinese diagnostics (BOM: %s)", async (bom) => {
    const child = wslProcess();
    const result = runWsl(["--version"]);
    const message = "未安装适用于 Linux 的 Windows 子系统。请运行 wsl.exe --install。";
    const bytes = Buffer.from(`${bom ? "\uFEFF" : ""}${message}\r\n`, "utf16le");
    for (const byte of bytes) {
      child.stdout.write(Buffer.from([byte]));
      child.stderr.write(Buffer.from([byte]));
    }
    child.emit("close", 1);
    expect(await result).toEqual({ code: 1, stdout: message, stderr: message });
  });

  it.each([false, true])("preserves UTF-8 Chinese output (BOM: %s)", async (bom) => {
    const child = wslProcess();
    const result = runWsl(["--list", "--quiet"]);
    child.stdout.write(Buffer.from(`${bom ? "\uFEFF" : ""}开发环境\r\nUbuntu\r\n`));
    child.emit("close", 0);
    expect(await result).toEqual({ code: 0, stdout: "开发环境\nUbuntu", stderr: "" });
  });

  it("decodes each stream independently and filters decoded WSL notices", async () => {
    const child = wslProcess();
    const result = runWsl(["--version"]);
    child.stdout.write(Buffer.from("WSL 版本： 2.7.14.0\r\n"));
    child.stderr.write(
      Buffer.from("wsl: 检测到 localhost 代理配置\r\n需要重新启动 Windows。\r\n", "utf16le"),
    );
    child.emit("close", 0);
    expect(await result).toEqual({
      code: 0,
      stdout: "WSL 版本： 2.7.14.0",
      stderr: "需要重新启动 Windows。",
    });
  });

  it("delivers complete UTF-8 provisioning lines before the process exits", async () => {
    const child = wslProcess();
    const onLine = vi.fn();
    const result = runWsl(["--exec", "/bin/sh", "-s"], { onLine });
    const bytes = Buffer.from("正在安装软件包\r\n");
    child.stdout.write(bytes.subarray(0, 2));
    expect(onLine).not.toHaveBeenCalled();
    child.stdout.write(bytes.subarray(2));
    expect(onLine).toHaveBeenCalledExactlyOnceWith("正在安装软件包");
    child.emit("close", 0);
    expect((await result).stdout).toBe("正在安装软件包");
  });

  it("returns empty streams when WSL writes nothing", async () => {
    const child = wslProcess();
    const result = runWsl(["--terminate", "penguin-sandbox"]);
    child.emit("close", 0);
    expect(await result).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});
