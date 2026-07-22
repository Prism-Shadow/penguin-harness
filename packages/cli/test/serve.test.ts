import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { DEFAULT_SERVER_PORT, RESERVED_PORTS } from "@prismshadow/penguin-core";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  browserCommand,
  browserUrl,
  registerServeCommands,
  resolvePort,
} from "../src/commands/serve.js";
import { getMessages } from "../src/i18n.js";

describe("resolvePort (option > env var > default 7364)", () => {
  it("derives DEFAULT_PORT from core's DEFAULT_SERVER_PORT (a reserved port)", () => {
    expect(DEFAULT_PORT).toBe(DEFAULT_SERVER_PORT);
    expect(RESERVED_PORTS).toContain(DEFAULT_PORT);
  });
  it("uses the default 7364 when neither is given", () => {
    expect(DEFAULT_PORT).toBe(7364);
    expect(resolvePort(undefined, undefined)).toBe(7364);
    expect(resolvePort(undefined, "")).toBe(7364); // an empty string counts as unset
  });
  it("takes the env var when only the env var is set", () => {
    expect(resolvePort(undefined, "8080")).toBe(8080);
  });
  it("the option beats the env var", () => {
    expect(resolvePort("9000", "8080")).toBe(9000);
  });
  it("throws on invalid values (non-integer / out of range)", () => {
    expect(() => resolvePort("abc", undefined)).toThrow(/abc/);
    expect(() => resolvePort("3.14", undefined)).toThrow();
    expect(() => resolvePort("-1", undefined)).toThrow();
    expect(() => resolvePort("65536", undefined)).toThrow();
    expect(() => resolvePort(undefined, "not-a-port")).toThrow(/not-a-port/);
  });
});

describe("browserCommand (picks the open command per platform)", () => {
  const url = "http://127.0.0.1:7364/";
  it("darwin → open", () => {
    expect(browserCommand("darwin", url)).toEqual({ command: "open", args: [url] });
  });
  it("win32 -> cmd /c start (empty title placeholder before the URL)", () => {
    expect(browserCommand("win32", url)).toEqual({
      command: "cmd",
      args: ["/c", "start", "", url],
    });
  });
  it("other platforms (linux etc.) -> xdg-open", () => {
    expect(browserCommand("linux", url)).toEqual({ command: "xdg-open", args: [url] });
    expect(browserCommand("freebsd", url)).toEqual({ command: "xdg-open", args: [url] });
  });
});

describe("browserUrl (wildcard listen addresses map to 127.0.0.1)", () => {
  it("a regular host is joined as-is", () => {
    expect(browserUrl(DEFAULT_HOST, 7364)).toBe("http://127.0.0.1:7364/");
    expect(browserUrl("192.168.1.2", 8080)).toBe("http://192.168.1.2:8080/");
  });
  it("the browser URL uses 127.0.0.1 for 0.0.0.0 / ::", () => {
    expect(browserUrl("0.0.0.0", 7364)).toBe("http://127.0.0.1:7364/");
    expect(browserUrl("::", 7364)).toBe("http://127.0.0.1:7364/");
  });
});

describe("registerServeCommands (command registration)", () => {
  it("registers the server and web top-level commands; web defaults to open=true (--no-open turns it off)", () => {
    const program = new Command();
    registerServeCommands(program, getMessages("en"));
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("server");
    expect(names).toContain("web");
    const web = program.commands.find((c) => c.name() === "web")!;
    expect(web.opts().open).toBe(true);
  });
});
