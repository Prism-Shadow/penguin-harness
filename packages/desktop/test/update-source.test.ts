/**
 * Tests for the desktop update-source selection (no Electron runtime). A fake fetch stands
 * in for the release endpoints so the whole probe contract — latest.json validation,
 * manifest parsing, probe verification, the 256 KiB/s minimum-speed gate, the 1.5x OSS
 * switch threshold and the inconclusive fallbacks — runs against controlled responses,
 * mirroring the decision vectors the release installers test.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GITHUB_RELEASE_ROOT,
  OSS_LATEST_JSON_URL,
  OSS_RELEASE_ROOT,
  desktopUpdateAssetName,
  feedLabel,
  githubFeedUrl,
  loadReleaseDownloadManifest,
  ossFeedUrl,
  probeSource,
  resolveOssLatestTag,
  selectAutoUpdateFeed,
  selectMeasuredSource,
  type FetchFn,
  type ProbeResponse,
} from "../src/update-source.js";

const TAG = "v0.2.2";
const OSS_BASE = `${OSS_RELEASE_ROOT}/${TAG}`;
const GH_BASE = `${GITHUB_RELEASE_ROOT}/${TAG}`;
const WIN_ASSET = "penguin-desktop-win32-x64.exe";
const MAC_ASSET = "penguin-desktop-darwin-arm64.zip";

function probeBody(size: number): Uint8Array {
  return new Uint8Array(size).fill(0x2a);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const SMALL = {
  name: "probe-64k.bin",
  size: 64 * 1024,
  sha256: sha256Hex(probeBody(64 * 1024)),
};
const LARGE = {
  name: "probe-1m.bin",
  size: 1024 * 1024,
  sha256: sha256Hex(probeBody(1024 * 1024)),
};
const LARGE_BYTES = probeBody(1024 * 1024);

function manifestText(assetName: string, assetSize: number): string {
  return [
    `penguin-release-download-manifest\t1\t${TAG}`,
    `probe\tsmall\t${SMALL.name}\t${SMALL.size}\t${SMALL.sha256}`,
    `probe\tlarge\t${LARGE.name}\t${LARGE.size}\t${LARGE.sha256}`,
    `desktop_asset\t${assetName}\t${assetSize}\t${"0".repeat(64)}`,
    "",
  ].join("\n");
}

interface FakeRoute {
  status?: number;
  body?: Uint8Array | string;
  /** Advances the mocked clock without slowing the test process. */
  advanceMs?: number;
  networkError?: boolean;
  encoding?: string | null;
}

interface FakeCall {
  url: string;
  acceptEncoding: string | undefined;
}

interface FakeClock {
  now: number;
}

function fakeResponse(status: number, body: Uint8Array, encoding: string | null): ProbeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === "content-encoding" ? encoding : null) },
    arrayBuffer: async () => body.slice().buffer,
  };
}

function fakeFetch(
  routes: Record<string, FakeRoute>,
  calls: FakeCall[] = [],
  clock?: FakeClock,
): FetchFn {
  return async (url, init) => {
    calls.push({ url, acceptEncoding: init.headers["accept-encoding"] });
    const route = routes[url];
    if (route === undefined) return fakeResponse(404, new Uint8Array(0), null);
    if (route.advanceMs !== undefined && route.advanceMs > 0 && clock) clock.now += route.advanceMs;
    if (route.networkError) throw new Error("simulated network failure");
    const body =
      typeof route.body === "string"
        ? new TextEncoder().encode(route.body)
        : (route.body ?? new Uint8Array(0));
    return fakeResponse(route.status ?? 200, body, route.encoding ?? null);
  };
}

/** latest.json + both manifests + both small probes + GitHub large probe all healthy. */
function happyRoutes(
  opts: {
    assetName?: string;
    assetSize?: number;
    githubLargeMs?: number;
    ossLargeMs?: number;
    largeFail?: boolean;
  } = {},
): Record<string, FakeRoute> {
  const assetName = opts.assetName ?? WIN_ASSET;
  return {
    [OSS_LATEST_JSON_URL]: {
      body: JSON.stringify({
        schemaVersion: 1,
        tag: TAG,
        releaseBaseUrl: `${OSS_RELEASE_ROOT}/${TAG}`,
      }),
    },
    [`${OSS_BASE}/release-download-manifest.tsv`]: {
      body: manifestText(assetName, opts.assetSize ?? 120 * 1024 * 1024),
    },
    [`${OSS_BASE}/${SMALL.name}`]: { body: probeBody(SMALL.size) },
    [`${GH_BASE}/${SMALL.name}`]: { body: probeBody(SMALL.size) },
    [`${OSS_BASE}/${LARGE.name}`]: {
      body: LARGE_BYTES,
      advanceMs: opts.ossLargeMs ?? 1000,
    },
    [`${GH_BASE}/${LARGE.name}`]: opts.largeFail
      ? { status: 500 }
      : { body: LARGE_BYTES, advanceMs: opts.githubLargeMs ?? 1000 },
  };
}

function runSelection(
  routes: Record<string, FakeRoute>,
  calls: FakeCall[] = [],
  platform: NodeJS.Platform = "win32",
  arch = "x64",
  budgetMs = 60_000,
): { decision: ReturnType<typeof selectAutoUpdateFeed>; logs: string[] } {
  const logs: string[] = [];
  const clock = { now: 1_000_000 };
  const now = vi.spyOn(Date, "now").mockImplementation(() => clock.now);
  const decision = selectAutoUpdateFeed({
    fetchFn: fakeFetch(routes, calls, clock),
    platform,
    arch,
    log: (line) => logs.push(line),
    budgetMs,
  }).finally(() => {
    now.mockRestore();
  });
  return {
    decision,
    logs,
  };
}

describe("desktopUpdateAssetName", () => {
  it("maps the update asset per platform and arch (zip for macOS, never the dmg)", () => {
    expect(desktopUpdateAssetName("darwin", "arm64")).toBe("penguin-desktop-darwin-arm64.zip");
    expect(desktopUpdateAssetName("darwin", "x64")).toBe("penguin-desktop-darwin-x64.zip");
    expect(desktopUpdateAssetName("win32", "x64")).toBe(WIN_ASSET);
    expect(desktopUpdateAssetName("linux", "x64")).toBe("penguin-desktop-linux-x86_64.AppImage");
  });

  it("yields nothing for forms the updater never downloads", () => {
    expect(desktopUpdateAssetName("win32", "arm64")).toBeNull();
    expect(desktopUpdateAssetName("linux", "arm64")).toBeNull();
    expect(desktopUpdateAssetName("darwin", "ia32")).toBeNull();
  });
});

describe("feedLabel", () => {
  it("names the known sources and stays neutral for anything else", () => {
    expect(feedLabel("https://x.oss-cn-beijing.aliyuncs.com/releases/v1/")).toBe("OSS mirror");
    expect(feedLabel("https://github.com/Prism-Shadow/penguin-harness/releases/download/v1/")).toBe(
      "GitHub",
    );
    expect(feedLabel("https://mirror.example.com/updates/")).toBe("configured mirror");
    expect(feedLabel("not a url")).toBe("configured mirror");
  });
});

describe("resolveOssLatestTag", () => {
  it("returns the tag of a valid latest.json", async () => {
    const fetchFn = fakeFetch({
      [OSS_LATEST_JSON_URL]: {
        body: JSON.stringify({
          schemaVersion: 1,
          tag: TAG,
          releaseBaseUrl: `${OSS_RELEASE_ROOT}/${TAG}`,
        }),
      },
    });
    await expect(resolveOssLatestTag(fetchFn)).resolves.toBe(TAG);
  });

  it("rejects non-200, network failures and invalid JSON", async () => {
    await expect(
      resolveOssLatestTag(fakeFetch({ [OSS_LATEST_JSON_URL]: { status: 503 } })),
    ).resolves.toBeNull();
    await expect(
      resolveOssLatestTag(fakeFetch({ [OSS_LATEST_JSON_URL]: { networkError: true } })),
    ).resolves.toBeNull();
    await expect(
      resolveOssLatestTag(fakeFetch({ [OSS_LATEST_JSON_URL]: { body: "{not json" } })),
    ).resolves.toBeNull();
  });

  it("rejects wrong schema, unsafe tags and mismatched base URLs", async () => {
    await expect(
      resolveOssLatestTag(
        fakeFetch({
          [OSS_LATEST_JSON_URL]: {
            body: JSON.stringify({ schemaVersion: 2, tag: TAG, releaseBaseUrl: `${OSS_BASE}` }),
          },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      resolveOssLatestTag(
        fakeFetch({
          [OSS_LATEST_JSON_URL]: {
            body: JSON.stringify({
              schemaVersion: 1,
              tag: "../v0.2.2",
              releaseBaseUrl: `${OSS_BASE}`,
            }),
          },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      resolveOssLatestTag(
        fakeFetch({
          [OSS_LATEST_JSON_URL]: {
            body: JSON.stringify({
              schemaVersion: 1,
              tag: TAG,
              releaseBaseUrl: "https://evil.example/releases/v0.2.2",
            }),
          },
        }),
      ),
    ).resolves.toBeNull();
  });
});

describe("loadReleaseDownloadManifest", () => {
  const deadlineMs = Date.now() + 60_000;

  it("parses a valid manifest and falls back to GitHub when the OSS copy is missing", async () => {
    const parsed = await loadReleaseDownloadManifest({
      fetchFn: fakeFetch({
        [`${GH_BASE}/release-download-manifest.tsv`]: {
          body: manifestText(WIN_ASSET, 120 * 1024 * 1024),
        },
      }),
      tag: TAG,
      assetName: WIN_ASSET,
      deadlineMs,
    });
    expect(parsed).toEqual({ smallProbe: SMALL, largeProbe: LARGE, assetSize: 120 * 1024 * 1024 });
  });

  it("rejects a missing manifest, a wrong header and an exhausted budget", async () => {
    await expect(
      loadReleaseDownloadManifest({
        fetchFn: fakeFetch({}),
        tag: TAG,
        assetName: WIN_ASSET,
        deadlineMs,
      }),
    ).resolves.toBeNull();
    await expect(
      loadReleaseDownloadManifest({
        fetchFn: fakeFetch({
          [`${OSS_BASE}/release-download-manifest.tsv`]: {
            body: manifestText(WIN_ASSET, 120 * 1024 * 1024).replace(TAG, "v9.9.9"),
          },
        }),
        tag: TAG,
        assetName: WIN_ASSET,
        deadlineMs,
      }),
    ).resolves.toBeNull();
    await expect(
      loadReleaseDownloadManifest({
        fetchFn: fakeFetch({
          [`${OSS_BASE}/release-download-manifest.tsv`]: {
            body: manifestText(WIN_ASSET, 120 * 1024 * 1024),
          },
        }),
        tag: TAG,
        assetName: WIN_ASSET,
        deadlineMs: Date.now() - 1,
      }),
    ).resolves.toBeNull();
  });

  it("rejects manifests missing probes or the platform asset row", async () => {
    const withoutLarge = manifestText(WIN_ASSET, 120 * 1024 * 1024)
      .split("\n")
      .filter((line) => !line.startsWith("probe\tlarge"))
      .join("\n");
    await expect(
      loadReleaseDownloadManifest({
        fetchFn: fakeFetch({
          [`${OSS_BASE}/release-download-manifest.tsv`]: { body: withoutLarge },
        }),
        tag: TAG,
        assetName: WIN_ASSET,
        deadlineMs,
      }),
    ).resolves.toBeNull();
    await expect(
      loadReleaseDownloadManifest({
        fetchFn: fakeFetch({
          [`${OSS_BASE}/release-download-manifest.tsv`]: {
            body: manifestText(MAC_ASSET, 120 * 1024 * 1024),
          },
        }),
        tag: TAG,
        assetName: WIN_ASSET,
        deadlineMs,
      }),
    ).resolves.toBeNull();
  });
});

describe("probeSource", () => {
  const deadlineMs = Date.now() + 60_000;

  it("accepts an exact verified probe and reports throughput", async () => {
    const result = await probeSource({
      fetchFn: fakeFetch({ [`${OSS_BASE}/${LARGE.name}`]: { body: LARGE_BYTES } }),
      base: OSS_BASE,
      probe: LARGE,
      deadlineMs,
      maxTimeoutSeconds: 5,
      wantSpeed: true,
    });
    expect(result.ok).toBe(true);
    expect(result.speedBps).toBeGreaterThan(0);
  });

  it("rejects wrong sizes, wrong hashes, non-2xx, compression and network failures", async () => {
    const routes = (route: FakeRoute) => ({
      [`${OSS_BASE}/${SMALL.name}`]: route,
    });
    expect(
      (
        await probeSource({
          fetchFn: fakeFetch(routes({ body: new Uint8Array(100) })),
          base: OSS_BASE,
          probe: SMALL,
          deadlineMs,
          maxTimeoutSeconds: 2,
          wantSpeed: false,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await probeSource({
          fetchFn: fakeFetch(routes({ body: probeBody(SMALL.size).fill(0x01) })),
          base: OSS_BASE,
          probe: SMALL,
          deadlineMs,
          maxTimeoutSeconds: 2,
          wantSpeed: false,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await probeSource({
          fetchFn: fakeFetch(routes({ status: 500 })),
          base: OSS_BASE,
          probe: SMALL,
          deadlineMs,
          maxTimeoutSeconds: 2,
          wantSpeed: false,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await probeSource({
          fetchFn: fakeFetch(routes({ body: probeBody(SMALL.size), encoding: "gzip" })),
          base: OSS_BASE,
          probe: SMALL,
          deadlineMs,
          maxTimeoutSeconds: 2,
          wantSpeed: false,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await probeSource({
          fetchFn: fakeFetch(routes({ networkError: true })),
          base: OSS_BASE,
          probe: SMALL,
          deadlineMs,
          maxTimeoutSeconds: 2,
          wantSpeed: false,
        })
      ).ok,
    ).toBe(false);
  });

  it("requests identity encoding and refuses to start past the budget", async () => {
    const calls: FakeCall[] = [];
    await probeSource({
      fetchFn: fakeFetch({ [`${OSS_BASE}/${SMALL.name}`]: { body: probeBody(SMALL.size) } }, calls),
      base: OSS_BASE,
      probe: SMALL,
      deadlineMs,
      maxTimeoutSeconds: 2,
      wantSpeed: false,
    });
    expect(calls[0]?.acceptEncoding).toBe("identity");
    expect(
      (
        await probeSource({
          fetchFn: fakeFetch({}),
          base: OSS_BASE,
          probe: SMALL,
          deadlineMs: Date.now() - 1,
          maxTimeoutSeconds: 2,
          wantSpeed: false,
        })
      ).ok,
    ).toBe(false);
  });
});

describe("selectMeasuredSource", () => {
  it("keeps GitHub above the minimum speed and on ties below it", () => {
    expect(selectMeasuredSource(262144, 10_000_000)).toBe("github");
    expect(selectMeasuredSource(200_000, 299_999)).toBe("github");
  });

  it("switches to OSS only when GitHub missed the minimum and OSS is more than 1.5x faster", () => {
    expect(selectMeasuredSource(200_000, 300_001)).toBe("oss");
  });
});

describe("selectAutoUpdateFeed", () => {
  it("keeps GitHub when the GitHub large probe meets the 256 KiB/s gate", async () => {
    const { decision, logs } = await runSelection(happyRoutes());
    expect(await decision).toEqual({
      kind: "pinned",
      primaryUrl: githubFeedUrl(TAG),
      fallbackUrl: ossFeedUrl(TAG),
    });
    expect(logs).toContain("Selected GitHub (meets minimum download speed).");
  });

  it("promotes the OSS mirror when GitHub misses the minimum and OSS is clearly faster", async () => {
    const { decision, logs } = await runSelection(
      happyRoutes({ githubLargeMs: 5_000, ossLargeMs: 1_000 }),
    );
    expect(await decision).toEqual({
      kind: "pinned",
      primaryUrl: ossFeedUrl(TAG),
      fallbackUrl: githubFeedUrl(TAG),
    });
    expect(logs).toContain("Selected OSS mirror (clearly faster than GitHub here).");
  });

  it("keeps GitHub when both sources miss the minimum and OSS is not enough faster", async () => {
    const { decision, logs } = await runSelection(
      happyRoutes({ githubLargeMs: 5_000, ossLargeMs: 4_500 }),
    );
    expect(await decision).toEqual({
      kind: "pinned",
      primaryUrl: githubFeedUrl(TAG),
      fallbackUrl: ossFeedUrl(TAG),
    });
    expect(logs).toContain(
      "Selected GitHub (the OSS mirror was not enough faster to be worth switching).",
    );
  });

  it("uses the OSS mirror when the GitHub large probe fails and OSS can be measured", async () => {
    const { decision, logs } = await runSelection(
      happyRoutes({ largeFail: true, ossLargeMs: 1_000 }),
    );
    expect(await decision).toEqual({
      kind: "pinned",
      primaryUrl: ossFeedUrl(TAG),
      fallbackUrl: githubFeedUrl(TAG),
    });
    expect(logs).toContain("Selected OSS mirror (clearly faster than GitHub here).");
  });

  it("keeps GitHub when only the OSS small probe fails, without measuring throughput", async () => {
    const routes = happyRoutes();
    delete routes[`${OSS_BASE}/${SMALL.name}`];
    const calls: FakeCall[] = [];
    const { decision, logs } = await runSelection(routes, calls);
    expect(await decision).toEqual({
      kind: "pinned",
      primaryUrl: githubFeedUrl(TAG),
      fallbackUrl: ossFeedUrl(TAG),
    });
    expect(logs).toContain("Selected GitHub (OSS mirror probe unavailable).");
    expect(calls.some((c) => c.url.endsWith(LARGE.name))).toBe(false);
  });

  it("selects the OSS mirror when only the GitHub small probe fails", async () => {
    const routes = happyRoutes();
    delete routes[`${GH_BASE}/${SMALL.name}`];
    const calls: FakeCall[] = [];
    const { decision, logs } = await runSelection(routes, calls);
    expect(await decision).toEqual({
      kind: "pinned",
      primaryUrl: ossFeedUrl(TAG),
      fallbackUrl: githubFeedUrl(TAG),
    });
    expect(logs).toContain("Selected OSS mirror (GitHub probe unavailable).");
    expect(calls.some((c) => c.url.endsWith(LARGE.name))).toBe(false);
  });

  it("keeps GitHub when both small probes fail", async () => {
    const routes = happyRoutes();
    delete routes[`${OSS_BASE}/${SMALL.name}`];
    delete routes[`${GH_BASE}/${SMALL.name}`];
    const calls: FakeCall[] = [];
    const { decision, logs } = await runSelection(routes, calls);
    expect(await decision).toEqual({ kind: "keep-github", reason: "inconclusive" });
    expect(logs).toContain("Download source test was inconclusive; keeping GitHub update feed.");
    expect(calls.some((c) => c.url.endsWith(LARGE.name))).toBe(false);
  });

  it("keeps GitHub without any probes when latest.json is invalid or the manifest is unusable", async () => {
    const noLatest = await runSelection({ [OSS_LATEST_JSON_URL]: { status: 503 } });
    expect(await noLatest.decision).toEqual({ kind: "keep-github", reason: "inconclusive" });

    const routes = happyRoutes();
    delete routes[`${OSS_BASE}/release-download-manifest.tsv`];
    const noManifest = await runSelection(routes);
    expect(await noManifest.decision).toEqual({ kind: "keep-github", reason: "inconclusive" });

    const badHeader = happyRoutes();
    badHeader[`${OSS_BASE}/release-download-manifest.tsv`] = {
      body: manifestText(WIN_ASSET, 120 * 1024 * 1024).replace(TAG, "v9.9.9"),
    };
    const mismatched = await runSelection(badHeader);
    expect(await mismatched.decision).toEqual({ kind: "keep-github", reason: "inconclusive" });
  });

  it("selects the OSS mirror when the GitHub small probe is corrupted (wrong bytes or compressed)", async () => {
    const wrongBytes = happyRoutes();
    wrongBytes[`${GH_BASE}/${SMALL.name}`] = { body: new Uint8Array(100) };
    const corrupted = await runSelection(wrongBytes);
    expect(await corrupted.decision).toEqual({
      kind: "pinned",
      primaryUrl: ossFeedUrl(TAG),
      fallbackUrl: githubFeedUrl(TAG),
    });

    const compressed = happyRoutes();
    compressed[`${GH_BASE}/${SMALL.name}`] = {
      body: probeBody(SMALL.size),
      encoding: "gzip",
    };
    const gzipped = await runSelection(compressed);
    expect(await gzipped.decision).toEqual({
      kind: "pinned",
      primaryUrl: ossFeedUrl(TAG),
      fallbackUrl: githubFeedUrl(TAG),
    });
  });

  it("keeps GitHub when the probe budget is already exhausted", async () => {
    const routes = happyRoutes();
    const calls: FakeCall[] = [];
    const { decision, logs } = await runSelection(routes, calls, "win32", "x64", 0);
    expect(await decision).toEqual({ kind: "keep-github", reason: "inconclusive" });
    expect(logs).toContain("Download source test was inconclusive; keeping GitHub update feed.");
  });

  it("keeps GitHub for forms without a desktop update asset, without any network access", async () => {
    const calls: FakeCall[] = [];
    const { decision } = await runSelection(happyRoutes(), calls, "win32", "arm64");
    expect(await decision).toEqual({ kind: "keep-github", reason: "inconclusive" });
    expect(calls).toEqual([]);
  });

  it("uses the platform-specific desktop asset row (macOS zip)", async () => {
    const routes = happyRoutes({ assetName: MAC_ASSET });
    const { decision } = await runSelection(routes, [], "darwin", "arm64");
    expect(await decision).toEqual({
      kind: "pinned",
      primaryUrl: githubFeedUrl(TAG),
      fallbackUrl: ossFeedUrl(TAG),
    });
  });
});
