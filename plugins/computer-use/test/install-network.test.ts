/**
 * Where agent-desktop's download comes from, and how long it may take. The registry is the one
 * fake (fetch, honouring its abort signal); the files are real, in a temp data root.
 *
 * - Given the Plugin Sources registry and the npm registry mirror, the download tries the
 *   registry first and the mirror when the registry cannot be reached, stalls, or answers an
 *   error; given every address failing, the error names what each one did.
 * - Given a slow link that keeps sending, the download keeps going past what a single short
 *   budget would allow; given one that sends nothing for the idle timeout, that address is given
 *   up; given the whole budget spent, the install ends.
 * - Given the install stopped mid-download (the module disposed, the plugin removed), it ends at
 *   once and leaves no staging directory behind.
 * - Given the npm registry mirror chosen under Plugin mirrors, the addresses are the registry and
 *   its npmmirror twin; given none, the registry alone.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  installAgentDesktop,
  installDirOf,
  InstallStoppedError,
  tarballUrl,
} from "../src/install.js";
import type { AgentDesktopPin } from "../src/pin.js";
import { registriesOf } from "../src/settings.js";
import { sha256, sha512, tarGz, tempDir } from "./helpers.js";

/** Incompressible, so the gzipped tarball keeps its size and arrives in many pieces. */
const PROGRAM = randomBytes(20_000);

function fixture() {
  const tarball = tarGz([{ path: "package/bin/agent-desktop-linux-x64", data: PROGRAM }]);
  const pin: AgentDesktopPin = {
    name: "agent-desktop",
    version: "9.9.9",
    integrity: sha512(tarball),
    size: tarball.length,
    targets: {
      "linux-x64": {
        program: {
          entry: "package/bin/agent-desktop-linux-x64",
          sha256: sha256(PROGRAM),
          name: "agent-desktop",
        },
      },
    },
  };
  return { tarball, pin };
}

type Behaviour =
  | { kind: "ok" }
  | { kind: "refuse" }
  | { kind: "status"; status: number }
  | { kind: "stall"; after: number }
  | { kind: "slow"; chunk: number; everyMs: number };

/** A registry per host, each behaving as told; records the URLs asked, in order. */
function registries(tarball: Buffer, by: Record<string, Behaviour>) {
  const asked: string[] = [];
  const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push(url.host);
    const how = by[url.host] ?? { kind: "refuse" };
    if (how.kind === "refuse") throw new TypeError("fetch failed: connect ECONNREFUSED");
    if (how.kind === "status") return new Response("no", { status: how.status });
    const signal = init?.signal;
    let sent = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          controller.error(new DOMException("The operation was aborted.", "AbortError"));
        });
      },
      pull(controller) {
        if (how.kind === "ok") {
          controller.enqueue(new Uint8Array(tarball));
          controller.close();
          return;
        }
        if (how.kind === "stall") {
          if (sent === 0) {
            sent = how.after;
            controller.enqueue(new Uint8Array(tarball.subarray(0, how.after)));
          }
          return new Promise<void>(() => {});
        }
        return new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            const next = tarball.subarray(sent, sent + how.chunk);
            sent += next.length;
            if (next.length > 0) controller.enqueue(new Uint8Array(next));
            if (sent >= tarball.length) controller.close();
            resolve();
          }, how.everyMs);
        });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-length": String(tarball.length) },
    });
  }) as typeof fetch;
  return { fetch: fetchFake, asked };
}

const linux = { platform: "linux" as const, arch: "x64" };
const ADDRESSES = ["https://registry.npmjs.org", "https://registry.npmmirror.com"];

describe("where the download comes from", () => {
  it("tries the mirror when the registry cannot be reached, stalls or answers an error", async () => {
    const { tarball, pin } = fixture();
    for (const first of [
      { kind: "refuse" },
      { kind: "stall", after: 64 },
      { kind: "status", status: 503 },
    ] as Behaviour[]) {
      const root = await tempDir();
      const reg = registries(tarball, {
        "registry.npmjs.org": first,
        "registry.npmmirror.com": { kind: "ok" },
      });
      const installed = await installAgentDesktop({
        root,
        registries: ADDRESSES,
        fetch: reg.fetch,
        pin,
        idleTimeoutMs: 150,
        ...linux,
      });
      expect(reg.asked, first.kind).toEqual(["registry.npmjs.org", "registry.npmmirror.com"]);
      expect(installed.version).toBe("9.9.9");
    }
  });

  it("names what every address did when none succeeds", async () => {
    const { tarball, pin } = fixture();
    const reg = registries(tarball, {
      "registry.npmjs.org": { kind: "stall", after: 10 },
      "registry.npmmirror.com": { kind: "status", status: 404 },
    });
    await expect(
      installAgentDesktop({
        root: await tempDir(),
        registries: ADDRESSES,
        fetch: reg.fetch,
        pin,
        idleTimeoutMs: 100,
        ...linux,
      }),
    ).rejects.toThrow(
      /could not be downloaded \(registry\.npmjs\.org: no data arrived for 0\.1 s; registry\.npmmirror\.com: answered 404\)/,
    );
  });

  it("keeps going on a slow link that still sends, and gives up only at the whole budget", async () => {
    const { tarball, pin } = fixture();
    const chunk = Math.ceil(tarball.length / 8);
    const slow = registries(tarball, {
      "registry.npmjs.org": { kind: "slow", chunk, everyMs: 60 },
    });
    // Eight chunks a minute apart in miniature: ~480 ms in all, each gap well inside the idle
    // timeout — a single budget of 200 ms would have cut it off.
    const installed = await installAgentDesktop({
      root: await tempDir(),
      registries: [ADDRESSES[0]!],
      fetch: slow.fetch,
      pin,
      idleTimeoutMs: 200,
      totalTimeoutMs: 5_000,
      ...linux,
    });
    expect(installed.version).toBe("9.9.9");
    const capped = registries(tarball, {
      "registry.npmjs.org": { kind: "slow", chunk, everyMs: 60 },
    });
    await expect(
      installAgentDesktop({
        root: await tempDir(),
        registries: [ADDRESSES[0]!],
        fetch: capped.fetch,
        pin,
        idleTimeoutMs: 200,
        totalTimeoutMs: 150,
        ...linux,
      }),
    ).rejects.toThrow(/registry\.npmjs\.org: the install ran out of its/);
  });

  it("stops at once mid-download and leaves nothing staged", async () => {
    const { tarball, pin } = fixture();
    const root = await tempDir();
    const reg = registries(tarball, {
      "registry.npmjs.org": { kind: "slow", chunk: 16, everyMs: 30 },
    });
    const stop = new AbortController();
    const install = installAgentDesktop({
      root,
      registries: ADDRESSES,
      fetch: reg.fetch,
      pin,
      signal: stop.signal,
      ...linux,
    });
    setTimeout(() => stop.abort(), 100);
    await expect(install).rejects.toBeInstanceOf(InstallStoppedError);
    // The mirror is not tried after a stop.
    expect(reg.asked).toEqual(["registry.npmjs.org"]);
    const parent = path.dirname(installDirOf(root, pin));
    const left = await fs.readdir(parent).catch(() => [] as string[]);
    expect(left.filter((n) => n.includes(".staging-") || n === "9.9.9")).toEqual([]);
    expect(tarballUrl(ADDRESSES[0]!, pin)).toContain("registry.npmjs.org");
  });
});

describe("the addresses Plugin Sources names", () => {
  it("adds the npmmirror twin of the registry when the npm registry mirror is chosen", () => {
    expect(registriesOf({}, { mirrors: ["npm-registry"] }, {})).toEqual(ADDRESSES);
    expect(registriesOf({}, { mirrors: ["github-raw"] }, {})).toEqual([ADDRESSES[0]]);
    expect(registriesOf({}, {}, {})).toEqual([ADDRESSES[0]]);
    // A registry chosen as npmmirror already is tried once.
    expect(registriesOf({ npmRegistry: ADDRESSES[1] }, { mirrors: ["npm-registry"] }, {})).toEqual([
      ADDRESSES[1],
    ]);
    // npm's own setting counts when Plugin Sources names none.
    expect(
      registriesOf(
        {},
        { mirrors: ["npm-registry"] },
        { npm_config_registry: "https://npm.corp.example/" },
      ),
    ).toEqual(["https://npm.corp.example"]);
  });
});
