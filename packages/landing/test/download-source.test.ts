/**
 * The download page's half of the shared auto-mode rule. The measurement itself needs a browser
 * (see lib/download-source.ts on why throughput is read from a Resource Timing entry), so what is
 * pinned here is the decision the measurements feed and the manifest parsing that names the probe.
 * The installers run the same table against their own implementations in scripts/test-installer.sh.
 */
import { describe, expect, it } from "vitest";
import {
  SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND,
  parseLargeProbe,
  selectDownloadSource,
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

describe("parseLargeProbe", () => {
  it("reads the large probe row of a manifest for this exact tag", () => {
    expect(parseLargeProbe(MANIFEST, TAG)).toEqual({ file: "probe-1m.bin", size: 1048576 });
  });

  it("refuses a manifest published for another tag", () => {
    expect(parseLargeProbe(MANIFEST, "v9.9.9")).toBeNull();
  });

  it("refuses a probe name that is not a plain asset name", () => {
    const escaped = MANIFEST.replace("probe-1m.bin", "../../etc/passwd");
    expect(parseLargeProbe(escaped, TAG)).toBeNull();
  });

  it("refuses a size that is not a positive integer", () => {
    expect(parseLargeProbe(MANIFEST.replace("\t1048576\t", "\t0\t"), TAG)).toBeNull();
    expect(parseLargeProbe(MANIFEST.replace("\t1048576\t", "\tlots\t"), TAG)).toBeNull();
  });

  it("returns null when the release carries no large probe at all", () => {
    const rows = MANIFEST.split("\n").filter((line) => !line.startsWith("probe\tlarge"));
    expect(parseLargeProbe(rows.join("\n"), TAG)).toBeNull();
  });
});
