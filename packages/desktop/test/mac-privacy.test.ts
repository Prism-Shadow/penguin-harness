import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const config = readFileSync(
  fileURLToPath(new URL("../electron-builder.yml", import.meta.url)),
  "utf8",
);

/** The keys under `mac.extendInfo`, read line by line (the block keeps them plain). */
function macExtendInfoKeys(): string[] {
  const lines = config.split("\n");
  const start = lines.findIndex((line) => line === "  extendInfo:");
  if (start === -1) return [];
  const keys: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^ {4}([A-Za-z]+):\s*\S/.exec(line);
    if (m === null) break;
    keys.push(m[1]!);
  }
  return keys;
}

describe("macOS privacy purpose strings", () => {
  it("declares one for every protected location a Workspace can live in", () => {
    // Without a purpose string macOS refuses the read silently instead of asking, so a
    // Workspace under ~/Downloads would look empty to every agent with nothing to explain it.
    expect(macExtendInfoKeys()).toEqual(
      expect.arrayContaining([
        "NSDesktopFolderUsageDescription",
        "NSDocumentsFolderUsageDescription",
        "NSDownloadsFolderUsageDescription",
        "NSRemovableVolumesUsageDescription",
        "NSNetworkVolumesUsageDescription",
      ]),
    );
  });
});
