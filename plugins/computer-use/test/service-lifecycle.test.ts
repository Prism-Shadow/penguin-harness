/**
 * The service's install across its modules' lives. The registry is the one fake (fetch, sending
 * the tarball slowly and honouring its abort signal); the files are real, in a temp data root.
 *
 * - Given every module releasing the service mid-download (the plugin removed) and none taking it
 *   again within the grace, the download stops, nothing is left staged, and agent-desktop reads
 *   as not installed.
 * - Given a re-assembly — one generation releases the service and the next takes it within the
 *   grace — the download carries on to the end.
 * - Given every address failing, the failure names the settings that decide where the download
 *   comes from and the program-path override.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installDirOf } from "../src/install.js";
import type { AgentDesktopPin } from "../src/pin.js";
import { ComputerUseService } from "../src/service.js";
import { settingsReader, sha256, sha512, tarGz, tempDir, waitUntil } from "./helpers.js";

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

/** Sends the tarball in `chunk`-byte pieces every `everyMs`; an abort errors the stream. */
function slowFetch(tarball: Buffer, chunk: number, everyMs: number) {
  const aborted: boolean[] = [];
  const fetchFake = (async (_url: string, init?: RequestInit) => {
    let sent = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () => {
          aborted.push(true);
          clearTimeout(timer);
          controller.error(new DOMException("aborted", "AbortError"));
        });
      },
      pull(controller) {
        return new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            const next = tarball.subarray(sent, sent + chunk);
            sent += next.length;
            controller.enqueue(new Uint8Array(next));
            if (sent >= tarball.length) controller.close();
            resolve();
          }, everyMs);
        });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-length": String(tarball.length) },
    });
  }) as typeof fetch;
  return { fetch: fetchFake, aborted };
}

function service(root: string, pin: AgentDesktopPin, fetchImpl: typeof fetch) {
  const s = new ComputerUseService({
    root,
    platform: "linux",
    arch: "x64",
    glibc: "2.39",
    pin,
    fetch: fetchImpl,
    releaseGraceMs: 50,
    installTimeouts: { idleMs: 2_000 },
    log: () => {},
  });
  s.bind(settingsReader());
  return s;
}

describe("the install across the modules' lives", () => {
  it("stops when every module released the service, leaving nothing staged", async () => {
    const root = await tempDir();
    const { tarball, pin } = fixture();
    const reg = slowFetch(tarball, 64, 20);
    const s = service(root, pin, reg.fetch);
    await s.refresh();
    const release = s.retain();
    void s.install();
    await waitUntil(() => {
      const st = s.state();
      return st.kind === "installing" && st.progress !== null;
    });
    release();
    await waitUntil(() => s.state().kind === "missing", 3_000);
    expect(reg.aborted).toEqual([true]);
    const parent = path.dirname(installDirOf(root, pin));
    const left = await fs.readdir(parent).catch(() => [] as string[]);
    expect(left.filter((n) => n.startsWith("9.9.9"))).toEqual([]);
  });

  it("carries on through a re-assembly that takes the service again within the grace", async () => {
    const root = await tempDir();
    const { tarball, pin } = fixture();
    const reg = slowFetch(tarball, Math.ceil(tarball.length / 6), 30);
    const s = service(root, pin, reg.fetch);
    const first = s.retain();
    const done = s.install();
    first();
    const second = s.retain();
    await done;
    expect(s.state().kind).toBe("installed");
    expect(reg.aborted).toEqual([]);
    second();
  });

  it("names where the download comes from, and the program path, when it fails", async () => {
    const root = await tempDir();
    const { pin } = fixture();
    const refused = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const s = service(root, pin, refused);
    // As the module's start does: read what is installed, then install.
    await s.refresh();
    await s.install();
    expect(s.state().kind).toBe("failed");
    const choice = await s.program();
    expect(choice).toMatchObject({ ok: false, code: "install_failed" });
    const message = (choice as { message: string }).message;
    expect(message).toMatch(/registry\.npmjs\.org: could not be reached/);
    expect(message).toContain("Plugin Sources");
    expect(message).toContain("agent-desktop program path");
  });
});
