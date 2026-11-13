/**
 * The tarball name an uploaded plugin's `npm pack --json` reports, whichever npm the machine has.
 *
 * - npm 11 reports an array holding the packed package; its `filename` is the tarball.
 * - npm 12 reports an object keyed by package name; the one value's `filename` is the tarball.
 *   Its `files` array must not be taken for the report.
 * - A notice line before either report is skipped.
 * - A report that names no tarball, or a tarball with a directory part, is refused.
 *
 * Both reports are what `npm pack --ignore-scripts --json --pack-destination <dir>` printed
 * for the same package, npm 11.19.1 and npm 12.2.1 on Node 24.22.1.
 */
import { describe, expect, it } from "vitest";
import { packedFileName, PluginInstallError } from "../src/plugin/install.js";

const packed = {
  id: "@demo/penguin-probe@1.0.0",
  name: "@demo/penguin-probe",
  version: "1.0.0",
  size: 200,
  unpackedSize: 77,
  shasum: "cb3def23a76b26989515c99e519030e98f935cc1",
  integrity:
    "sha512-+mdcu1brClzvOCMyifTQTH8ViucmHp8wR7LlAEgQpshSRxJNdqohcALIiHHhrjZqATO8Qav4SdS/iXTEo0rHIg==",
  filename: "demo-penguin-probe-1.0.0.tgz",
  files: [
    { path: "index.js", size: 24, mode: 420 },
    { path: "package.json", size: 53, mode: 420 },
  ],
  entryCount: 2,
  bundled: [],
};

/** npm prints the report indented by two spaces, with a trailing newline. */
const npm11 = `${JSON.stringify([packed], null, 2)}\n`;
const npm12 = `${JSON.stringify({ [packed.name]: packed }, null, 2)}\n`;

describe("packedFileName", () => {
  it("reads the tarball from npm 11's array report", () => {
    expect(packedFileName(npm11)).toBe("demo-penguin-probe-1.0.0.tgz");
  });

  it("reads the tarball from npm 12's report keyed by package name", () => {
    expect(packedFileName(npm12)).toBe("demo-penguin-probe-1.0.0.tgz");
  });

  it("skips a notice printed before either report", () => {
    const notice = "a line printed before the report\n";
    expect(packedFileName(notice + npm11)).toBe("demo-penguin-probe-1.0.0.tgz");
    expect(packedFileName(notice + npm12)).toBe("demo-penguin-probe-1.0.0.tgz");
  });

  it("refuses a report that names no tarball, or names one with a directory part", () => {
    for (const stdout of [
      "",
      "[]\n",
      "{}\n",
      `${JSON.stringify({ [packed.name]: { ...packed, filename: undefined } })}\n`,
      `${JSON.stringify({ [packed.name]: { ...packed, filename: "../demo.tgz" } })}\n`,
      `${JSON.stringify([{ ...packed, filename: "sub/demo.tgz" }])}\n`,
    ]) {
      expect(() => packedFileName(stdout)).toThrow(PluginInstallError);
    }
  });
});
