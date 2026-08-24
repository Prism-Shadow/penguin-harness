/**
 * A machine's own id: minted once by the server that runs there, stable ever after.
 *
 * The property everything else leans on is that it does NOT change — sessions, install
 * records and workspaces all point at it — so the cases here are about it surviving
 * re-reads, about refusing anything malformed, and about an id minted under the older
 * (longer) shape still being that machine's id.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  machineIdPath,
  parseMachineId,
  readOrCreateMachineId,
} from "../src/machines/machine-id.js";

/** 12 random bytes as base64url: 16 characters, no padding. */
const SHORT_ID = /^[A-Za-z0-9_-]{16}$/;

describe("parseMachineId", () => {
  it("accepts a UUID, trimming and lower-casing it", () => {
    expect(parseMachineId("  1B4E28BA-2FA1-11D2-883F-0016D3CCA427\n")).toBe(
      "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
    );
  });

  it("refuses anything that is not one, so a damaged file is no identity at all", () => {
    for (const raw of [
      null,
      "",
      "   ",
      "not-a-uuid",
      "1b4e28ba",
      "{}",
      "1b4e28ba-2fa1-11d2-883f",
    ]) {
      expect(parseMachineId(raw)).toBeNull();
    }
  });
});

describe("readOrCreateMachineId", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-machine-id-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("mints one on first call and writes it where a probe can read it", () => {
    const id = readOrCreateMachineId(root);
    expect(id).toMatch(SHORT_ID);
    expect(id).toHaveLength(16);
    expect(fs.readFileSync(machineIdPath(root), "utf8").trim()).toBe(id);
  });

  it("returns the same id ever after — this is an identity, not a token", () => {
    const first = readOrCreateMachineId(root);
    expect(readOrCreateMachineId(root)).toBe(first);
    expect(readOrCreateMachineId(root)).toBe(first);
  });

  it("adopts an id already on disk rather than minting over it", () => {
    fs.writeFileSync(machineIdPath(root), "LNrJdHAZJ91G58i0\n");
    expect(readOrCreateMachineId(root)).toBe("LNrJdHAZJ91G58i0");
  });

  it("leaves an older, longer id exactly as it found it", () => {
    // The whole point of an identity: shortening the format must not renumber machines
    // that already have one.
    fs.writeFileSync(machineIdPath(root), "1b4e28ba-2fa1-11d2-883f-0016d3cca427\n");
    expect(readOrCreateMachineId(root)).toBe("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
    expect(fs.readFileSync(machineIdPath(root), "utf8").trim()).toBe(
      "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
    );
  });

  it("replaces a damaged file instead of honouring it", () => {
    fs.writeFileSync(machineIdPath(root), "not-an-id");
    const id = readOrCreateMachineId(root);
    expect(id).toMatch(SHORT_ID);
    expect(readOrCreateMachineId(root)).toBe(id);
  });

  it("creates the data root when it does not exist yet", () => {
    const fresh = path.join(root, "nested", "data");
    expect(readOrCreateMachineId(fresh)).toMatch(SHORT_ID);
  });

  it("leaves no temp file behind", () => {
    readOrCreateMachineId(root);
    expect(fs.readdirSync(root).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});
