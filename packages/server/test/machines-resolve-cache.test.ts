/**
 * Caching `ssh -G`. It never connects — it parses config — but it is a process spawn sitting
 * in front of every directory listing and every probe, so repeating it per click costs more
 * than the command it precedes.
 *
 * Driven through a stub `ssh` on PATH that counts invocations, because the claim is about
 * how many processes are spawned.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetResolvedTargets, resolveTarget } from "../src/machines/targets.js";

let work: string;
let originalPath: string | undefined;

const calls = (): number => {
  const log = path.join(work, "calls.log");
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").length : 0;
};

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-resolve-test-"));
  fs.mkdirSync(path.join(work, "bin"));
  fs.writeFileSync(
    path.join(work, "bin", "ssh"),
    `#!/bin/sh\necho one >> ${JSON.stringify(path.join(work, "calls.log"))}\n` +
      `if [ "$2" = "unknown-host" ]; then exit 255; fi\n` +
      `printf 'user deploy\\nhostname %s.example\\nport 22\\n' "$2"\n`,
    { mode: 0o755 },
  );
  originalPath = process.env.PATH;
  process.env.PATH = `${path.join(work, "bin")}:${process.env.PATH ?? ""}`;
  forgetResolvedTargets();
});
afterEach(() => {
  forgetResolvedTargets();
  process.env.PATH = originalPath;
  fs.rmSync(work, { recursive: true, force: true });
});

/**
 * POSIX-only: the stub is a `#!/bin/sh` script reached through PATH, which Windows neither
 * executes nor joins with ':'. What is under test is the module's own logic, not anything
 * platform-specific — so the coverage is real everywhere the harness can drive it, and
 * pretending otherwise on Windows only produced 15 failures about the stub, not the code.
 */
describe.skipIf(process.platform === "win32")("resolveTarget", () => {
  it("resolves an alias to what ssh says it is", async () => {
    const target = await resolveTarget("build-box");
    expect(target?.settings.user).toBe("deploy");
    expect(target?.settings.hostname).toBe("build-box.example");
    expect(target?.machine).toBe("deploy@build-box");
  });

  it("spawns ssh ONCE for repeated asks — the point of the cache", async () => {
    for (let i = 0; i < 5; i++) await resolveTarget("build-box");
    expect(calls()).toBe(1);
  });

  it("keeps aliases apart", async () => {
    await resolveTarget("a");
    await resolveTarget("b");
    expect(calls()).toBe(2);
    expect((await resolveTarget("a"))?.settings.hostname).toBe("a.example");
  });

  it("caches a failure too, so a broken alias is not the slowest one", async () => {
    // An alias ssh cannot name will not start working within the minute, and re-asking per
    // click would make every listing wait on it.
    expect(await resolveTarget("unknown-host")).toBeNull();
    expect(await resolveTarget("unknown-host")).toBeNull();
    expect(calls()).toBe(1);
  });

  it("asks again once told the config changed", async () => {
    await resolveTarget("build-box");
    forgetResolvedTargets();
    await resolveTarget("build-box");
    expect(calls()).toBe(2);
  });
});
