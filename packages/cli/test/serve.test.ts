import { describe, expect, it } from "vitest";
import { Command } from "commander";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  browserCommand,
  browserUrl,
  registerServeCommands,
  resolvePort,
} from "../src/commands/serve.js";
import { getMessages } from "../src/i18n.js";

describe("resolvePort（选项 > 环境变量 > 缺省 7364）", () => {
  it("都未给时用缺省 7364", () => {
    expect(DEFAULT_PORT).toBe(7364);
    expect(resolvePort(undefined, undefined)).toBe(7364);
    expect(resolvePort(undefined, "")).toBe(7364); // an empty string counts as unset
  });
  it("只有环境变量时取环境变量", () => {
    expect(resolvePort(undefined, "8080")).toBe(8080);
  });
  it("选项优先于环境变量", () => {
    expect(resolvePort("9000", "8080")).toBe(9000);
  });
  it("非法值（非整数 / 越界）抛错", () => {
    expect(() => resolvePort("abc", undefined)).toThrow(/abc/);
    expect(() => resolvePort("3.14", undefined)).toThrow();
    expect(() => resolvePort("-1", undefined)).toThrow();
    expect(() => resolvePort("65536", undefined)).toThrow();
    expect(() => resolvePort(undefined, "not-a-port")).toThrow(/not-a-port/);
  });
});

describe("browserCommand（按平台选择打开命令）", () => {
  const url = "http://127.0.0.1:7364/";
  it("darwin → open", () => {
    expect(browserCommand("darwin", url)).toEqual({ command: "open", args: [url] });
  });
  it("win32 → cmd /c start（空标题占位在 URL 前）", () => {
    expect(browserCommand("win32", url)).toEqual({
      command: "cmd",
      args: ["/c", "start", "", url],
    });
  });
  it("其他平台（linux 等）→ xdg-open", () => {
    expect(browserCommand("linux", url)).toEqual({ command: "xdg-open", args: [url] });
    expect(browserCommand("freebsd", url)).toEqual({ command: "xdg-open", args: [url] });
  });
});

describe("browserUrl（通配监听地址转 127.0.0.1）", () => {
  it("常规 host 原样拼接", () => {
    expect(browserUrl(DEFAULT_HOST, 7364)).toBe("http://127.0.0.1:7364/");
    expect(browserUrl("192.168.1.2", 8080)).toBe("http://192.168.1.2:8080/");
  });
  it("0.0.0.0 / :: 时浏览器 URL 用 127.0.0.1", () => {
    expect(browserUrl("0.0.0.0", 7364)).toBe("http://127.0.0.1:7364/");
    expect(browserUrl("::", 7364)).toBe("http://127.0.0.1:7364/");
  });
});

describe("registerServeCommands（命令注册）", () => {
  it("注册 server 与 web 两个顶层命令，web 缺省 open=true（--no-open 可关）", () => {
    const program = new Command();
    registerServeCommands(program, getMessages("en"));
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("server");
    expect(names).toContain("web");
    const web = program.commands.find((c) => c.name() === "web")!;
    expect(web.opts().open).toBe(true);
  });
});
