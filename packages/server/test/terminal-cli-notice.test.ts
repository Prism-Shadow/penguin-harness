/**
 * What a terminal says about its `penguin` on its first line, and whether its shell keeps the
 * server's data root (src/terminal/cli-notice.ts).
 *
 * - An installation's terminal says nothing.
 * - A development instance's terminal names the CLI — the checkout and whether it runs from
 *   source or a build, or the PENGUIN_CLI_ENTRY it was given — and the data root it targets,
 *   and carries the line its shell shows instead when the user's own files aim penguin
 *   elsewhere (the shells themselves are tried in terminal-path-first.test.ts).
 * - A checkout whose CLI cannot run is a warning that carries the reason; so is a shim that
 *   should be there and is not, on any instance.
 * - The shell keeps PENGUIN_HOME only where no shim names the data root: no shim, a missing
 *   one, or a runtime older than the shim's root default.
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../src/config.js";
import { cliShimDir } from "../src/services/cli-shim.js";
import { shimNamesDataRoot, terminalCliNotice } from "../src/terminal/cli-notice.js";
import { makeTempRoot } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length > 0) await fs.promises.rm(roots.pop()!, { recursive: true, force: true });
});

type Facts = Pick<ServerConfig, "root" | "cliEntry" | "cliLaunch">;

/** A data root whose shim directory holds a `penguin` (unless `shim` is false). */
async function rootWith(shim = true): Promise<{ root: string; dirs: string[] }> {
  const root = await makeTempRoot();
  roots.push(root);
  const dir = cliShimDir(root);
  if (shim) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "penguin"), "#!/bin/sh\n");
  }
  return { root, dirs: [dir] };
}

/** A home directory spelled the way this platform spells paths, as `os.homedir()` would. */
const HOME = path.join(path.sep, "home", "anne");

describe("a terminal's first line", () => {
  it("is nothing on an installation", async () => {
    const { root, dirs } = await rootWith();
    const config: Facts = {
      root,
      cliEntry: "/opt/penguin/dist/penguin.js",
      cliLaunch: { execArgs: [], checkout: null, origin: "env", unavailable: null },
    };
    expect(terminalCliNotice(config, dirs, HOME)).toBeNull();
  });

  it("names a dev instance's CLI and data root, for each origin", async () => {
    const { root, dirs } = await rootWith();
    const checkout = path.join(HOME, "work", "penguin-harness");
    const shown = path.join("~", "work", "penguin-harness");
    const notice = (origin: "source" | "build" | "env", cliEntry: string) =>
      terminalCliNotice(
        { root, cliEntry, cliLaunch: { execArgs: [], checkout, origin, unavailable: null } },
        dirs,
        HOME,
      );
    const source = notice("source", path.join(checkout, "packages", "cli", "src", "penguin.ts"));
    expect(source?.tone).toBe("info");
    expect(source?.text).toContain(`the CLI of ${shown} (source)`);
    expect(source?.text).toContain(`on data root ${root}`);
    // And what the shell says in its place when its own files aim penguin elsewhere.
    expect(source?.target).toEqual({
      root,
      elsewhere: [
        "Your shell sets ",
        `, so penguin here talks to that server, not this instance (data root ${root}).`,
      ],
    });
    expect(
      notice("build", path.join(checkout, "packages", "cli", "dist", "penguin.js"))?.text,
    ).toContain(`${shown} (built)`);
    expect(notice("env", "/opt/other/penguin.js")?.text).toContain(
      "/opt/other/penguin.js (PENGUIN_CLI_ENTRY)",
    );
  });

  it("warns, with the reason, when the checkout's CLI cannot run", async () => {
    const { root, dirs } = await rootWith();
    const unavailable = "packages/cli/dist/penguin.js is not built in /work/x.";
    const notice = terminalCliNotice(
      {
        root,
        cliEntry: null,
        cliLaunch: { execArgs: [], checkout: "/work/x", origin: null, unavailable },
      },
      dirs,
      HOME,
    );
    expect(notice?.tone).toBe("warning");
    expect(notice?.text).toContain(unavailable);
  });

  it("warns that PATH decides when a shim that should be there is not, on any instance", async () => {
    const { root, dirs } = await rootWith(false);
    const notice = terminalCliNotice(
      {
        root,
        cliEntry: "/opt/penguin/dist/penguin.js",
        cliLaunch: { execArgs: [], checkout: null, origin: "env", unavailable: null },
      },
      dirs,
      HOME,
    );
    expect(notice?.tone).toBe("warning");
    expect(notice?.text).toContain(path.join(dirs[0]!, "penguin"));
  });
});

describe("whether a shim names the data root (else the shell keeps PENGUIN_HOME)", () => {
  const launch: Facts["cliLaunch"] = {
    execArgs: [],
    checkout: null,
    origin: "env",
    unavailable: null,
  };

  it("does when this runtime wrote it and it is there", async () => {
    const { dirs } = await rootWith();
    expect(shimNamesDataRoot({ cliLaunch: launch }, dirs)).toBe(true);
  });

  it("does not without a shim, with a missing one, or under a runtime older than the default", async () => {
    const present = await rootWith();
    const missing = await rootWith(false);
    expect(shimNamesDataRoot({ cliLaunch: launch }, [])).toBe(false);
    expect(shimNamesDataRoot({ cliLaunch: launch }, missing.dirs)).toBe(false);
    // An older runtime publishes no cliLaunch, and its shim names no root.
    expect(shimNamesDataRoot({}, present.dirs)).toBe(false);
  });
});
