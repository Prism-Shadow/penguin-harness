import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  posixShimScript,
  windowsShimScript,
} from "../../../packages/server/src/services/cli-shim.js";

const SCRIPTS = path.join(import.meta.dirname, "../skills/skillweaver-rsi-toolkit/scripts");
const TOOL = path.join(SCRIPTS, "skillweaver.mjs");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tool: any = await import(TOOL);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runtime: any = await import(path.join(SCRIPTS, "skillweaver-api.mjs"));

const SITE = "http://shop.example:7770/store";

function api(
  name: string,
  overrides: Partial<Record<"meta" | "body" | "imports" | "tail", string>> = {},
) {
  const meta =
    overrides.meta ??
    `{
  name: "${name}",
  description: "Search the catalogue for a query and return the first product names shown.",
  params: { query: { type: "string", description: "What to search for." } },
  returns: "An array of product names, in page order.",
  usage_log: ["iter_3: query 'tea' returned 12 names; the first page only."],
}`;
  const body =
    overrides.body ??
    `  browser.open("/catalogsearch/result/?q=" + encodeURIComponent(query));
  return browser.exec("return [...document.querySelectorAll('.product-name')].map((e) => e.textContent.trim());");`;
  return `${overrides.imports ?? 'import { browser, runApi } from "./skillweaver-api.mjs";'}

export const meta = ${meta};

export async function run({ query }) {
${body}
}

${overrides.tail ?? "runApi(import.meta.url, meta, run);"}
`;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "skillweaver-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function put(name: string, source: string) {
  const file = path.join(dir, `${name}.mjs`);
  writeFileSync(file, source);
  return file;
}

describe("role reply verification", () => {
  function record(role: string, text: string) {
    return JSON.stringify({ type: "model_msg", payload: { type: "text", role, text } });
  }

  it("reads the final JSON reply rather than streamed narration or an earlier attempt", () => {
    const first = path.join(dir, "first.jsonl");
    const second = path.join(dir, "second.jsonl");
    writeFileSync(first, record("assistant", 'I found this: {"success":false}') + "\n");
    writeFileSync(
      second,
      [record("user", "Resend the JSON only"), record("assistant", '{"success":true}')].join("\n"),
    );
    expect(tool.readRoleReply([first, second])).toEqual({
      text: '{"success":true}',
      reply: { success: true },
      problems: [],
    });
    expect(tool.readRoleReply([first]).problems).toHaveLength(1);
  });
});

describe("code verification", () => {
  it("accepts a well-formed API", async () => {
    tool.init(dir, SITE);
    const res = await tool.checkApi(put("search_products", api("search_products")));
    expect(res).toEqual({ name: "search_products", problems: [] });
  });

  it.each([
    [
      "an import other than the runtime",
      {
        imports:
          'import { browser, runApi } from "./skillweaver-api.mjs";\nimport fs from "node:fs";',
      },
      /only \.\/skillweaver-api\.mjs/,
    ],
    ["a missing runApi line", { tail: "" }, /runApi\(import\.meta\.url/],
    [
      "an absolute first navigation",
      { body: '  browser.open("https://evil.example/");\n  return browser.exec("return 1");' },
      /site-relative/,
    ],
    [
      "a first call that is not open",
      { body: '  browser.click("#go");\n  return browser.exec("return 1");' },
      /site-relative/,
    ],
    [
      "a single browser call",
      { body: '  return browser.open("/x");' },
      /fewer than two browser calls/,
    ],
    [
      "process.env access",
      { body: '  browser.open("/x" + process.env.HOME);\n  return browser.exec("return 1");' },
      /process\.exit or process\.env/,
    ],
  ])("rejects %s", async (_label, overrides, pattern) => {
    tool.init(dir, SITE);
    const res = await tool.checkApi(put("search_products", api("search_products", overrides)));
    expect(res.problems.join("\n")).toMatch(pattern);
  });

  it("rejects a syntax error before importing anything", async () => {
    const res = await tool.checkApi(put("broken_api", "export const meta = {;\n"));
    expect(res.problems[0]).toMatch(/^syntax error/);
  });

  it("checks the meta: name, prefix, params and usage log", () => {
    const run = async () => null;
    const good = {
      name: "filter_orders",
      description: "Filter the order list by status and return the visible rows.",
      params: { status: { type: "string", description: "Order status label." } },
      returns: "Rows as objects.",
      usage_log: ["iter_1: status 'Pending' showed 3 rows."],
    };
    expect(tool.checkMeta(good, run, "/x/filter_orders.mjs")).toEqual([]);
    expect(tool.checkMeta(good, run, "/x/other.mjs").join()).toMatch(
      /does not match the file name/,
    );
    expect(tool.checkMeta({ ...good, name: "test_orders" }, run).join()).toMatch(
      /may not start with/,
    );
    expect(
      tool
        .checkMeta({ ...good, params: { order_id: { type: "string", description: "x" } } }, run)
        .join(),
    ).toMatch(/id or URL/);
    expect(
      tool
        .checkMeta({ ...good, params: { status: { type: "object", description: "x" } } }, run)
        .join(),
    ).toMatch(/has type "object"/);
    expect(tool.checkMeta({ ...good, usage_log: [] }, run).join()).toMatch(/usage_log/);
    expect(tool.checkMeta(good, () => null).join()).toMatch(/async function/);
  });
});

describe("the shipped references", () => {
  const REFS = path.join(import.meta.dirname, "../skills/skillweaver-rsi-toolkit/references");

  it("api-format.md's example passes the checker it documents", async () => {
    const doc = readFileSync(path.join(REFS, "api-format.md"), "utf8");
    const example = doc.match(/```js\n([\s\S]*?)```/)?.[1];
    expect(example).toBeDefined();
    tool.init(dir, SITE);
    const res = await tool.checkApi(put("search_products_by_keyword", example!));
    expect(res).toEqual({ name: "search_products_by_keyword", problems: [] });
  });

  it("evaluation.md is the common copy every RSI toolkit ships", () => {
    const ours = readFileSync(path.join(REFS, "evaluation.md"), "utf8");
    const awm = path.join(
      import.meta.dirname,
      "../../awm-rsi-toolkit/skills/awm-rsi-toolkit/references/evaluation.md",
    );
    expect(ours).toBe(readFileSync(awm, "utf8"));
  });
});

describe("the library", () => {
  it("initialises once, copies the runtime and refuses to reinitialise", () => {
    expect(tool.init(dir, SITE)).toEqual({ site: SITE, apis: 0 });
    expect(readFileSync(path.join(dir, "skillweaver-api.mjs"), "utf8")).toBe(
      readFileSync(path.join(SCRIPTS, "skillweaver-api.mjs"), "utf8"),
    );
    expect(() => tool.init(dir, SITE)).toThrow(/never reinitialise/);
  });

  it("versions APIs, resets their tests on a new version and counts passing tests", () => {
    tool.init(dir, SITE);
    put("search_products", api("search_products"));
    expect(tool.register(dir, "search_products", "iter_2")).toMatchObject({
      version: 1,
      tests: [],
    });
    expect(tool.tested(dir, "search_products", "iter_3")).toEqual({
      name: "search_products",
      tests: 1,
    });
    expect(tool.register(dir, "search_products", "iter_4")).toMatchObject({
      version: 2,
      created: "iter_2",
      tests: [],
    });
    expect(() => tool.tested(dir, "missing_api", "iter_5")).toThrow(/not registered/);
  });

  it("picks only untested APIs, by practice utility, reproducibly", () => {
    tool.init(dir, SITE);
    put("search_products", api("search_products"));
    put(
      "open_cart",
      api("open_cart", {
        body: '  browser.open("/cart");\n  browser.click(".a");\n  browser.click(".b");\n  return browser.exec("return 1");',
      }).replace(/name: "search_products"/, 'name: "open_cart"'),
    );
    tool.register(dir, "search_products", "iter_1");
    tool.register(dir, "open_cart", "iter_2");
    const first = tool.pickTest(dir, 7);
    expect(first.utilities).toEqual({ open_cart: 3, search_products: 1 });
    expect(tool.pickTest(dir, 7)).toEqual(first);
    tool.tested(dir, "open_cart", "iter_3");
    expect(tool.pickTest(dir, 7).name).toBe("search_products");
    tool.tested(dir, "search_products", "iter_4");
    expect(tool.pickTest(dir, 7)).toEqual({ name: null, utilities: {} });
  });

  it("writes INDEX.md from registered APIs only", async () => {
    tool.init(dir, SITE);
    put("search_products", api("search_products"));
    put("unverified_api", api("unverified_api"));
    tool.register(dir, "search_products", "iter_1");
    expect(await tool.buildIndex(dir)).toEqual({ apis: 1 });
    const index = readFileSync(path.join(dir, "INDEX.md"), "utf8");
    expect(index).toContain(`# Skill library for ${SITE}`);
    expect(index).toContain("## search_products(query: string)");
    expect(index).toContain("Version 1; untested.");
    expect(index).not.toContain("unverified_api");
  });
});

describe("integrity", () => {
  it("fingerprints every file, and any change, addition or removal moves the digest", () => {
    tool.init(dir, SITE);
    put("search_products", api("search_products"));
    const first = tool.fingerprint(dir);
    expect(Object.keys(first.files).sort()).toEqual([
      "library.json",
      "search_products.mjs",
      "skillweaver-api.mjs",
    ]);
    expect(tool.fingerprint(dir)).toEqual(first);
    writeFileSync(path.join(dir, "search_products.mjs"), api("search_products") + "\n");
    const edited = tool.fingerprint(dir);
    expect(edited.digest).not.toBe(first.digest);
    mkdirSync(path.join(dir, "sub"));
    writeFileSync(path.join(dir, "sub", "x.txt"), "x");
    expect(tool.fingerprint(dir).files["sub/x.txt"]).toBeDefined();
    rmSync(path.join(dir, "sub"), { recursive: true });
    expect(tool.fingerprint(dir)).toEqual(edited);
  });

  it("refuses a runtime copy that differs from the shipped one", () => {
    tool.init(dir, SITE);
    expect(tool.verifyRuntime(dir)).toEqual({ problems: [] });
    writeFileSync(path.join(dir, "skillweaver-api.mjs"), "// changed\n");
    expect(tool.verifyRuntime(dir).problems[0]).toMatch(/differs from the shipped runtime/);
    rmSync(path.join(dir, "skillweaver-api.mjs"));
    expect(tool.verifyRuntime(dir).problems[0]).toMatch(/missing/);
  });
});

describe("the API runtime", () => {
  function fakePenguin(behaviour: "ok" | "fail") {
    const log = path.join(dir, "calls.jsonl");
    const bin = path.join(dir, "fake-penguin.mjs");
    writeFileSync(
      bin,
      `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const cmd = args[1];
if (${JSON.stringify(behaviour)} === "fail" && cmd === "exec") {
  process.stdout.write(JSON.stringify({ status: "failed", tabId: 1, error: "boom" }));
  process.exit(1);
}
if (cmd === "open") process.stdout.write(JSON.stringify({ tab: { id: 1, url: args[2], title: "t" } }));
else process.stdout.write(JSON.stringify({ status: "success", tabId: 1, value: ["Green tea", "Black tea"] }));
`,
    );
    return { bin, log };
  }

  function callApi(file: string, args: string[], bin: string) {
    return spawnSync(process.execPath, [file, ...args], {
      encoding: "utf8",
      env: { ...process.env, SKILLWEAVER_PENGUIN: bin },
    });
  }

  it("runs an API against the site and prints one JSON result line", () => {
    tool.init(dir, SITE);
    const file = put("search_products", api("search_products"));
    const { bin, log } = fakePenguin("ok");
    const res = callApi(file, ["--args", JSON.stringify({ query: "green tea" })], bin);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ ok: true, result: ["Green tea", "Black tea"] });
    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(calls[0]).toEqual([
      "browser",
      "open",
      "http://shop.example:7770/store/catalogsearch/result/?q=green%20tea",
      "--json",
    ]);
    expect(calls[1].slice(0, 2)).toEqual(["browser", "exec"]);
    expect(calls[1].slice(-3)).toEqual(["--timeout", "30s", "--json"]);
  });

  it("reports a failed browser call, a missing argument and an unknown one", () => {
    tool.init(dir, SITE);
    const file = put("search_products", api("search_products"));
    const failing = fakePenguin("fail");
    const failed = callApi(file, ["--args", '{"query":"x"}'], failing.bin);
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stdout)).toEqual({
      ok: false,
      error: "penguin browser exec failed: boom",
    });
    expect(JSON.parse(callApi(file, ["--args", "{}"], failing.bin).stdout).error).toBe(
      'missing argument "query"',
    );
    expect(
      JSON.parse(callApi(file, ["--args", '{"query":"x","page":2}'], failing.bin).stdout).error,
    ).toBe('unknown argument "page"');
  });

  it("reads the arguments from --args-file too, and refuses both at once", () => {
    const argsFile = path.join(dir, "args.json");
    writeFileSync(argsFile, '{"query":"green tea"}');
    expect(runtime.parseArgs(["node", "x.mjs", "--args-file", argsFile])).toEqual({
      query: "green tea",
    });
    expect(() =>
      runtime.parseArgs(["node", "x.mjs", "--args", "{}", "--args-file", argsFile]),
    ).toThrow(/not both/);
    expect(runtime.parseArgs(["node", "x.mjs"])).toEqual({});
    expect(() => runtime.parseArgs(["node", "x.mjs", "--args", "[1]"])).toThrow(/JSON object/);
  });

  it("does nothing when imported", () => {
    tool.init(dir, SITE);
    const file = put("search_products", api("search_products"));
    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(m.meta.name);`,
      ],
      { encoding: "utf8" },
    );
    expect(out.trim()).toBe("search_products");
  });

  it("resolves only site-relative paths, under the site's own path", () => {
    expect(runtime.resolveOnSite(SITE, "/cart?x=1")).toBe(
      "http://shop.example:7770/store/cart?x=1",
    );
    expect(runtime.resolveOnSite("http://a.example/", "/b")).toBe("http://a.example/b");
    expect(() => runtime.resolveOnSite(SITE, "https://evil.example/")).toThrow(/site-relative/);
  });
});

describe("starting penguin", () => {
  const launch = {
    root: "C:\\Users\\me\\.penguin",
    execPath: "C:\\Program Files\\PenguinHarness\\PenguinHarness.exe",
    execArgs: ["--no-warnings"],
    entry: "C:\\Program Files\\PenguinHarness\\resources\\cli 100%\\penguin.js",
    electron: true,
  };

  it("reads the server's own Windows shim: runtime, arguments, entry and variables", () => {
    const shim = windowsShimScript(launch);
    expect(runtime.parseWindowsShim(shim, {})).toEqual({
      command: launch.execPath,
      args: ["--no-warnings", launch.entry],
      env: { PENGUIN_HOME: launch.root, ELECTRON_RUN_AS_NODE: "1" },
    });
    // A caller that set PENGUIN_HOME keeps it, as cmd's `if not defined` would.
    expect(runtime.parseWindowsShim(shim, { PENGUIN_HOME: "D:\\other" }).env).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
    });
  });

  it("finds penguin.cmd on PATH on Windows, and explains a stub shim", () => {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "penguin.cmd"), windowsShimScript({ ...launch, electron: false }));
    const env = { PATH: ["/nowhere", bin].join(path.delimiter) };
    expect(runtime.resolvePenguin(env, "win32")).toMatchObject({ command: launch.execPath });
    writeFileSync(
      path.join(bin, "penguin.cmd"),
      "@echo off\r\n>&2 echo penguin: this instance cannot run its own CLI: no build\r\nexit /b 1\r\n",
    );
    expect(() => runtime.resolvePenguin(env, "win32")).toThrow(
      /cannot start the CLI: penguin: this instance cannot run its own CLI: no build/,
    );
    expect(() => runtime.resolvePenguin({ PATH: "/nowhere" }, "win32")).toThrow(
      /no penguin.cmd on PATH/,
    );
  });

  it("uses penguin from PATH elsewhere, and runs a JavaScript stand-in on Node", () => {
    expect(runtime.resolvePenguin({}, "linux")).toEqual({ command: "penguin", args: [], env: {} });
    expect(posixShimScript({ ...launch, electron: false })).toContain('"$@"');
    expect(runtime.resolvePenguin({ SKILLWEAVER_PENGUIN: "/t/fake.mjs" }, "win32")).toEqual({
      command: process.execPath,
      args: ["/t/fake.mjs"],
      env: {},
    });
  });

  it("treats a symlinked path as the file it points to", () => {
    const real = path.join(dir, "real");
    mkdirSync(real);
    writeFileSync(path.join(real, "a.mjs"), "");
    const link = path.join(dir, "link");
    symlinkSync(real, link, "junction");
    expect(runtime.samePath(path.join(link, "a.mjs"), path.join(real, "a.mjs"))).toBe(true);
  });

  it("runs an API reached through a symlinked directory", () => {
    const real = path.join(dir, "lib");
    mkdirSync(real);
    tool.init(real, SITE);
    writeFileSync(path.join(real, "search_products.mjs"), api("search_products"));
    const link = path.join(dir, "lib-link");
    symlinkSync(real, link, "junction");
    const fake = path.join(dir, "fake.mjs");
    writeFileSync(
      fake,
      'process.stdout.write(JSON.stringify(process.argv[3] === "open" ? { tab: { id: 1 } } : { status: "success", value: 7 }));',
    );
    const res = spawnSync(
      process.execPath,
      [path.join(link, "search_products.mjs"), "--args", '{"query":"x"}'],
      {
        encoding: "utf8",
        env: { ...process.env, SKILLWEAVER_PENGUIN: fake },
      },
    );
    expect(JSON.parse(res.stdout)).toEqual({ ok: true, result: 7 });
  });

  it("compares Windows paths without case", () => {
    expect(runtime.samePath("C:\\Lib\\a.mjs", "c:\\lib\\A.MJS", "win32")).toBe(true);
    expect(runtime.samePath("/lib/a.mjs", "/lib/A.mjs", "linux")).toBe(false);
  });
});
