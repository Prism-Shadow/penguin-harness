/**
 * Whether agent-desktop can run on this machine, as the service tells it before anything is
 * downloaded.
 *
 * - Given Linux without glibc (musl) or with a glibc older than 2.35, Computer Use is unsupported
 *   here and says why, and nothing is installed; a glibc of 2.35 or later is supported.
 */
import { describe, expect, it } from "vitest";
import { ComputerUseService, libcProblem } from "../src/service.js";
import { settingsReader, tempDir } from "./helpers.js";

describe("a Linux machine's C library", () => {
  it.each([
    [null, /no glibc \(musl/],
    ["2.31", /glibc is 2\.31/],
  ])("glibc %s is unsupported here, saying why", async (glibc, why) => {
    const service = new ComputerUseService({
      root: await tempDir(),
      platform: "linux",
      arch: "x64",
      glibc,
      fetch: (() => {
        throw new Error("nothing is downloaded");
      }) as unknown as typeof fetch,
      log: () => {},
    });
    service.bind(settingsReader());
    await service.start();
    const state = service.state();
    expect(state.kind).toBe("unsupported");
    const choice = await service.program();
    expect(choice).toMatchObject({ ok: false, code: "unsupported" });
    expect((choice as { message: string }).message).toMatch(why);
  });

  it.each(["2.35", "2.41", "3.0"])("glibc %s is supported", (glibc) => {
    expect(libcProblem(glibc)).toBeNull();
  });
});
