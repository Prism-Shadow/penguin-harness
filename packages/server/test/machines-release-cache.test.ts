/**
 * The release packages this server fetches for machines that cannot download them themselves
 * (machines/release-cache.ts). The network is a scripted fetch answering by URL.
 *
 * Scenarios:
 * - Given a package the mirror serves, it is fetched once, checked against the checksum
 *   published beside it, and every later ask is answered from the cache without the network.
 * - Given two jobs asking at once, they share one fetch.
 * - Given a package that does not match its published checksum, it is refused and nothing is
 *   kept.
 * - Given a mirror out of reach, GitHub serves the package.
 * - Given another version fetched, the older one is let go.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RELEASE_SOURCES } from "../src/machines/diagnose.js";
import { releaseCache } from "../src/machines/release-cache.js";
import { makeTempRoot } from "./helpers.js";

const PACKAGE = Buffer.from("the linux-x64 package");
const SUM = crypto.createHash("sha256").update(PACKAGE).digest("hex");

let dir: string;
beforeEach(async () => {
  dir = await makeTempRoot();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A network that answers `routes` by URL and fails everything else; every URL asked is recorded. */
function network(routes: Record<string, Buffer | string | Error>) {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const answer = routes[url];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) return new Response("not found", { status: 404 });
    return new Response(answer);
  }) as typeof fetch;
  return { fetchImpl, asked };
}

const at = (base: string, version: string, file: string) => `${base}/v${version}/${file}`;

describe("release packages fetched for a machine", () => {
  it("fetches from the mirror once, checks the checksum, and serves later asks from the cache", async () => {
    const net = network({
      [at(RELEASE_SOURCES.oss, "0.2.13", "penguin-linux-x64.tar.gz.sha256")]: `${SUM}  penguin-linux-x64.tar.gz\n`,
      [at(RELEASE_SOURCES.oss, "0.2.13", "penguin-linux-x64.tar.gz")]: PACKAGE,
    });
    const carry = releaseCache(dir, net.fetchImpl);
    const first = await carry("0.2.13", "linux-x64");
    expect(first.ok).toBe(true);
    if (first.ok) expect(fs.readFileSync(first.file).equals(PACKAGE)).toBe(true);
    const asked = net.asked.length;
    expect(await carry("0.2.13", "linux-x64")).toEqual(first);
    expect(net.asked).toHaveLength(asked);
  });

  it("shares one fetch between two jobs asking at once", async () => {
    const net = network({
      [at(RELEASE_SOURCES.oss, "0.2.13", "penguin-linux-arm64.tar.gz.sha256")]: SUM,
      [at(RELEASE_SOURCES.oss, "0.2.13", "penguin-linux-arm64.tar.gz")]: PACKAGE,
    });
    const carry = releaseCache(dir, net.fetchImpl);
    const [a, b] = await Promise.all([carry("0.2.13", "linux-arm64"), carry("0.2.13", "linux-arm64")]);
    expect(a).toEqual(b);
    expect(net.asked.filter((url) => url.endsWith(".tar.gz"))).toHaveLength(1);
  });

  it("refuses a package that does not match its published checksum, keeping nothing", async () => {
    const net = network({
      [at(RELEASE_SOURCES.oss, "0.2.13", "penguin-linux-x64.tar.gz.sha256")]: SUM,
      [at(RELEASE_SOURCES.oss, "0.2.13", "penguin-linux-x64.tar.gz")]: Buffer.from("tampered"),
      [at(RELEASE_SOURCES.github, "0.2.13", "penguin-linux-x64.tar.gz.sha256")]: SUM,
      [at(RELEASE_SOURCES.github, "0.2.13", "penguin-linux-x64.tar.gz")]: Buffer.from("tampered"),
    });
    const result = await releaseCache(dir, net.fetchImpl)("0.2.13", "linux-x64");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("does not match its published checksum");
    expect(fs.existsSync(path.join(dir, "v0.2.13", "penguin-linux-x64.tar.gz"))).toBe(false);
  });

  it("gets the package from GitHub when the mirror is out of reach", async () => {
    const net = network({
      [at(RELEASE_SOURCES.oss, "0.2.13", "penguin-darwin-arm64.tar.gz.sha256")]: new TypeError(
        "fetch failed",
      ),
      [at(RELEASE_SOURCES.github, "0.2.13", "penguin-darwin-arm64.tar.gz.sha256")]: SUM,
      [at(RELEASE_SOURCES.github, "0.2.13", "penguin-darwin-arm64.tar.gz")]: PACKAGE,
    });
    expect((await releaseCache(dir, net.fetchImpl)("0.2.13", "darwin-arm64")).ok).toBe(true);
  });

  it("lets the older version go once another is fetched", async () => {
    const routes: Record<string, Buffer | string> = {};
    for (const version of ["0.2.13", "0.2.14"]) {
      routes[at(RELEASE_SOURCES.oss, version, "penguin-linux-x64.tar.gz.sha256")] = SUM;
      routes[at(RELEASE_SOURCES.oss, version, "penguin-linux-x64.tar.gz")] = PACKAGE;
    }
    const carry = releaseCache(dir, network(routes).fetchImpl);
    await carry("0.2.13", "linux-x64");
    await carry("0.2.14", "linux-x64");
    expect(fs.readdirSync(dir)).toEqual(["v0.2.14"]);
  });
});
