import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { Command } from "commander";
import { DEFAULT_SERVER_PORT } from "@prismshadow/penguin-core";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  browserCommand,
  appPagePath,
  browserUrl,
  cliEntryFor,
  describeReadinessFailure,
  registerServeCommands,
  resolvePort,
  supervisorDecision,
  waitForReady,
} from "../src/commands/serve.js";
import { getMessages } from "../src/i18n.js";

describe("resolvePort (option > env var > default 7364)", () => {
  it("derives DEFAULT_PORT from core's DEFAULT_SERVER_PORT", () => {
    expect(DEFAULT_PORT).toBe(DEFAULT_SERVER_PORT);
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

describe("cliEntryFor (the entry advertised for the web self-update)", () => {
  it("advertises only entries plain node can re-run (.js/.mjs/.cjs), resolved absolute", () => {
    // Expectations go through path.resolve too: on win32 an absolute POSIX-style input
    // gains a drive prefix and backslashes, and the contract is "resolved", not a literal.
    expect(cliEntryFor("/opt/penguin/lib/dist/index.js")).toBe(
      path.resolve("/opt/penguin/lib/dist/index.js"),
    );
    expect(cliEntryFor("/x/cli.MJS")).toBe(path.resolve("/x/cli.MJS"));
    expect(cliEntryFor("/x/cli.cjs")).toBe(path.resolve("/x/cli.cjs"));
  });
  it("refuses a tsx dev entry and a missing argv[1] (the endpoint then reports unsupported)", () => {
    expect(cliEntryFor("/repo/packages/cli/src/index.ts")).toBeNull();
    expect(cliEntryFor(undefined)).toBeNull();
    expect(cliEntryFor("")).toBeNull();
  });
});

describe("supervisorDecision (the service child's exit → respawn or exit)", () => {
  it("relaunches the service only on the restart code, and only while not stopping", () => {
    expect(supervisorDecision({ code: 75, signal: null }, false)).toEqual({ action: "respawn" });
    // The supervisor was told to stop (Ctrl+C reached it too): the child's last word is moot.
    expect(supervisorDecision({ code: 75, signal: null }, true)).toEqual({
      action: "exit",
      code: 75,
    });
  });

  it("passes every other exit through, and reads a signal death as failure", () => {
    expect(supervisorDecision({ code: 0, signal: null }, false)).toEqual({
      action: "exit",
      code: 0,
    });
    expect(supervisorDecision({ code: 3, signal: null }, false)).toEqual({
      action: "exit",
      code: 3,
    });
    expect(supervisorDecision({ code: null, signal: "SIGKILL" }, false)).toEqual({
      action: "exit",
      code: 1,
    });
    expect(supervisorDecision({ code: null, signal: null }, true)).toEqual({
      action: "exit",
      code: 0,
    });
  });
});

describe("readiness probe diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a successful HTTP response as ready regardless of its status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    await expect(waitForReady("http://127.0.0.1:7364/", 0, 0)).resolves.toEqual({
      ready: true,
    });
  });

  it("keeps polling after failed probes and reports ready once a response arrives", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(new Response(null, { status: 200 }));

    await expect(waitForReady("http://127.0.0.1:7364/", 5_000, 0)).resolves.toEqual({
      ready: true,
    });
  });

  it("retains the nested undici error from the last failed probe", async () => {
    const cause = Object.assign(new Error("Connect Timeout Error"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause }),
    );

    await expect(waitForReady("http://127.0.0.1:7364/", 0, 0)).resolves.toEqual({
      ready: false,
      failure: {
        kind: "timeout",
        detail: "UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error",
      },
    });
  });

  it.each([
    ["ECONNREFUSED", "refused"],
    ["ECONNRESET", "reset"],
    ["EACCES", "permission"],
    ["ENOTFOUND", "dns"],
  ] as const)("classifies %s failures as %s", (code, kind) => {
    expect(describeReadinessFailure(Object.assign(new Error("probe failed"), { code }))).toEqual({
      kind,
      detail: `${code}: probe failed`,
    });
  });

  it("classifies the probe's own 1s abort (DOMException TimeoutError) as a timeout", () => {
    expect(
      describeReadinessFailure(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      ),
    ).toEqual({
      kind: "timeout",
      detail: "TimeoutError: The operation was aborted due to timeout",
    });
  });

  it("digs the connect error out of an empty-message AggregateError (multi-address host)", () => {
    const aggregate = Object.assign(
      new AggregateError([
        Object.assign(new Error("connect ECONNREFUSED ::1:7364"), { code: "ECONNREFUSED" }),
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:7364"), { code: "ECONNREFUSED" }),
      ]),
      { code: "ECONNREFUSED" },
    );
    const error = Object.assign(new TypeError("fetch failed"), { cause: aggregate });

    expect(describeReadinessFailure(error)).toEqual({
      kind: "refused",
      detail: "ECONNREFUSED: connect ECONNREFUSED ::1:7364",
    });
  });

  it("includes actionable localized firewall guidance for connection timeouts", () => {
    const detail = "UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error";
    const url = "http://127.0.0.1:7364/";
    for (const lang of ["en", "zh"] as const) {
      const timeout = getMessages(lang).webProbeFailed(url, detail, "timeout", 7364);
      // Actionable means naming the port the user has to let through, not just reporting a
      // timeout; the probe error stays visible either way.
      expect(timeout, lang).toContain("7364");
      expect(timeout, lang).toContain(detail);
      // The kind picks the hint: a timeout must not read like a refused connection.
      expect(timeout, lang).not.toBe(
        getMessages(lang).webProbeFailed(url, detail, "refused", 7364),
      );
    }
  });
});

describe("appPagePath (--app <project>/<agent>/<workflow>)", () => {
  it("maps the spec to the Web App's full-page route, segments encoded", () => {
    expect(appPagePath("default_project/default_agent/todo")).toBe(
      "app/default_project/default_agent/todo",
    );
    expect(appPagePath("p 1/a/w")).toBe("app/p%201/a/w");
  });
  it("refuses anything but three non-empty segments", () => {
    for (const bad of ["todo", "p/a", "p/a/w/x", "p//w", "/a/w"]) {
      expect(() => appPagePath(bad)).toThrow(/Invalid --app/);
    }
  });
});
