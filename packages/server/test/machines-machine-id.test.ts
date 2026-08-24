/**
 * A machine's own id: minted once by the server that runs there, stable ever after.
 *
 * The property everything else leans on is that it does NOT change — sessions, install
 * records and workspaces all point at it — so the cases here are about it surviving
 * re-reads and about refusing to hand out anything that is not a real UUID.
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
    expect(id).toMatch(UUID);
    expect(fs.readFileSync(machineIdPath(root), "utf8").trim()).toBe(id);
  });

  it("returns the same id ever after — this is an identity, not a token", () => {
    const first = readOrCreateMachineId(root);
    expect(readOrCreateMachineId(root)).toBe(first);
    expect(readOrCreateMachineId(root)).toBe(first);
  });

  it("adopts an id already on disk rather than minting over it", () => {
    fs.writeFileSync(machineIdPath(root), "1b4e28ba-2fa1-11d2-883f-0016d3cca427\n");
    expect(readOrCreateMachineId(root)).toBe("1b4e28ba-2fa1-11d2-883f-0016d3cca427");
  });

  it("replaces a damaged file instead of honouring it", () => {
    fs.writeFileSync(machineIdPath(root), "not-a-uuid");
    const id = readOrCreateMachineId(root);
    expect(id).toMatch(UUID);
    expect(readOrCreateMachineId(root)).toBe(id);
  });

  it("creates the data root when it does not exist yet", () => {
    const fresh = path.join(root, "nested", "data");
    expect(readOrCreateMachineId(fresh)).toMatch(UUID);
  });

  it("leaves no temp file behind", () => {
    readOrCreateMachineId(root);
    expect(fs.readdirSync(root).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});
