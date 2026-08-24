/**
 * The download page's half of the shared auto-mode rule. The measurement itself needs a browser
 * (see lib/download-source.ts on why throughput is read from a Resource Timing entry), so what is
 * pinned here is the decision the measurements feed and the manifest parsing that names the probe.
 * The installers run the same table against their own implementations in scripts/test-installer.sh.
 */
import { describe, expect, it } from "vitest";
import { OSS_ORIGIN } from "../src/lib/links";
import type { Measurement } from "../src/lib/download-source";
import {
  MIRROR_POINTER_MS,
  SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND,
  createDeadline,
  decideDownloadSource,
  parseMirror,
  parseProbes,
  selectDownloadSource,
  toMirror,
  worthRefining,
} from "../src/lib/download-source";

const MIN = SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND;

describe("selectDownloadSource", () => {
  it("keeps GitHub at the minimum however fast the mirror is", () => {
    expect(selectDownloadSource(MIN, 100 * MIN)).toBe("github");
    expect(selectDownloadSource(MIN + 1, 100 * MIN)).toBe("github");
  });

  it("switches to the mirror only when it beats a below-minimum GitHub by more than 1.5x", () => {
    const github = MIN / 2;
    expect(selectDownloadSource(github, github * 1.51)).toBe("oss");
    expect(selectDownloadSource(github, github * 1.5)).toBe("github");
    expect(selectDownloadSource(github, github * 1.4)).toBe("github");
    expect(selectDownloadSource(github, github)).toBe("github");
    expect(selectDownloadSource(github, github / 2)).toBe("github");
  });

  it("treats an unmeasurable source as the slowest one, and a dead heat as free bandwidth", () => {
    expect(selectDownloadSource(0, 1)).toBe("oss");
    expect(selectDownloadSource(MIN / 2, 0)).toBe("github");
    expect(selectDownloadSource(0, 0)).toBe("github");
  });
});

const TAG = "v1.2.3";
const MANIFEST = [
  `penguin-release-download-manifest\t1\t${TAG}`,
  "probe\tsmall\tprobe-64k.bin\t65536\t" + "a".repeat(64),
  "probe\tlarge\tprobe-1m.bin\t1048576\t" + "b".repeat(64),
  "asset\tpenguin-desktop-win32-x64.exe\t104857600\t" + "c".repeat(64),
  "",
].join("\n");

describe("parseProbes", () => {
  it("reads both probe rows of a manifest for this exact tag", () => {
    expect(parseProbes(MANIFEST, TAG)).toEqual({
      small: { file: "probe-64k.bin", size: 65536 },
      large: { file: "probe-1m.bin", size: 1048576 },
    });
  });

  it("refuses a manifest published for another tag", () => {
    expect(parseProbes(MANIFEST, "v9.9.9")).toBeNull();
  });

  it("refuses a probe name that is not a plain asset name", () => {
    const escaped = MANIFEST.replace("probe-1m.bin", "../../etc/passwd");
    expect(parseProbes(escaped, TAG)).toBeNull();
  });

  it("refuses a size that is not a positive integer", () => {
    expect(parseProbes(MANIFEST.replace("\t1048576\t", "\t0\t"), TAG)).toBeNull();
    expect(parseProbes(MANIFEST.replace("\t1048576\t", "\tlots\t"), TAG)).toBeNull();
  });

  it("returns null unless the release carries both probes", () => {
    for (const dropped of ["probe\tlarge", "probe\tsmall"]) {
      const rows = MANIFEST.split("\n").filter((line) => !line.startsWith(dropped));
      expect(parseProbes(rows.join("\n"), TAG)).toBeNull();
    }
  });
});

describe("createDeadline", () => {
  it("hands each phase its cap while the budget is wide open", () => {
    const deadline = createDeadline(MIRROR_POINTER_MS);
    expect(deadline.slice(500)).toBe(500);
  });

  it("clamps a phase to what is left rather than letting it overrun the budget", () => {
    const deadline = createDeadline(1200);
    expect(deadline.slice(5000)).toBeLessThanOrEqual(1200);
    expect(deadline.slice(5000)).toBeGreaterThan(0);
  });

  it("hands out zero once the budget is spent, so the phase fails instead of waiting", () => {
    expect(createDeadline(0).slice(5000)).toBe(0);
    expect(createDeadline(-1).slice(5000)).toBe(0);
  });
});

const MIRROR = { tag: TAG, base: `${OSS_ORIGIN}/releases/${TAG}` };

describe("toMirror", () => {
  it("accepts a safe tag paired with the bucket path that tag implies", () => {
    expect(toMirror(MIRROR.tag, MIRROR.base)).toEqual(MIRROR);
  });

  it("refuses a base that does not belong to the tag, or to the bucket at all", () => {
    expect(toMirror(TAG, `${OSS_ORIGIN}/releases/v9.9.9`)).toBeNull();
    expect(toMirror(TAG, `https://example.invalid/releases/${TAG}`)).toBeNull();
    expect(toMirror(TAG, `${OSS_ORIGIN}/releases/${TAG}/..`)).toBeNull();
  });

  it("refuses a tag that is not a plain release tag", () => {
    expect(toMirror("../invalid", `${OSS_ORIGIN}/releases/../invalid`)).toBeNull();
    expect(toMirror(1, MIRROR.base)).toBeNull();
  });
});

describe("parseMirror", () => {
  it("reads a schema-1 pointer", () => {
    const pointer = { schemaVersion: 1, tag: TAG, releaseBaseUrl: MIRROR.base };
    expect(parseMirror(pointer)).toEqual(MIRROR);
  });

  it("refuses anything that is not a schema-1 object", () => {
    expect(parseMirror({ schemaVersion: 2, tag: TAG, releaseBaseUrl: MIRROR.base })).toBeNull();
    expect(parseMirror(null)).toBeNull();
    expect(parseMirror("v1.2.3")).toBeNull();
  });
});

const SOURCES = {
  githubBase: "https://github.test/latest",
  ossBase: `${OSS_ORIGIN}/releases/${TAG}`,
};
const PROBES = {
  small: { file: "probe-64k.bin", size: 65536 },
  large: { file: "probe-1m.bin", size: 1048576 },
};

/** Records which questions were asked of which source, so "never touched" is testable. */
function fakeProbes(github: Measurement, oss: Measurement) {
  const asked: string[] = [];
  return {
    asked,
    io: {
      measure: async (base: string) => {
        asked.push(`measure:${base === SOURCES.githubBase ? "github" : "oss"}`);
        return base === SOURCES.githubBase ? github : oss;
      },
    },
  };
}

const reachable = (bytesPerSecond: number): Measurement => ({ reachable: true, bytesPerSecond });
const unreachable: Measurement = { reachable: false, bytesPerSecond: 0 };

describe("decideDownloadSource", () => {
  it("keeps GitHub at the minimum without spending a byte of the mirror's bandwidth", async () => {
    const { asked, io } = fakeProbes(reachable(MIN), reachable(MIN * 10));
    await expect(decideDownloadSource(SOURCES, PROBES, io)).resolves.toBe("github");
    expect(asked).toEqual(["measure:github"]);
  });

  it("hands a GitHub that stopped answering to the mirror without a second probe", async () => {
    // The reachability pass already proved the mirror replies, so nothing more need be asked.
    const { asked, io } = fakeProbes(unreachable, reachable(1));
    await expect(decideDownloadSource(SOURCES, PROBES, io)).resolves.toBe("oss");
    expect(asked).toEqual(["measure:github"]);
  });

  // The divergence this branch split exists to prevent: a GitHub that answered but came in under
  // the minimum is a throughput question, and the mirror has to win it by the switch ratio. Reading
  // it as "unreachable" would hand the download to a mirror only 1.2x faster.
  it("makes a slow-but-reachable GitHub a throughput question, ratio and all", async () => {
    const slow = reachable(MIN / 2);
    for (const [ossSpeed, expected] of [
      [MIN / 2 + 1, "github"],
      [(MIN / 2) * 1.5, "github"],
      [(MIN / 2) * 1.51, "oss"],
    ] as const) {
      const { asked, io } = fakeProbes(slow, reachable(ossSpeed));
      await expect(decideDownloadSource(SOURCES, PROBES, io)).resolves.toBe(expected);
      expect(asked).toEqual(["measure:github", "measure:oss"]);
    }
  });

  it("lets any measured mirror beat a GitHub that answered but finished nothing", async () => {
    const { asked, io } = fakeProbes(reachable(0), reachable(1));
    await expect(decideDownloadSource(SOURCES, PROBES, io)).resolves.toBe("oss");
    expect(asked).toEqual(["measure:github", "measure:oss"]);
  });
});

describe("worthRefining", () => {
  it("measures throughput whenever there is a mirror to compare against", () => {
    expect(worthRefining(MIRROR)).toBe(true);
  });

  it("skips the megabyte when there is no mirror to compare against", () => {
    expect(worthRefining(null)).toBe(false);
  });
});
