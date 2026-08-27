/**
 * The install-records file: what this server remembers having installed where. Damage of
 * every shape has to read as "nothing remembered" rather than throw, because this file is a
 * convenience over the ssh config — refusing to serve the machines list because a cache got
 * corrupted would be the worse failure.
 */
import { describe, expect, it } from "vitest";
import { parseInstallRecords, withInstallRecord } from "../src/machines/installs.js";

const record = { version: "9.9.9", at: "2026-08-24T12:00:00.000Z" };

describe("parseInstallRecords", () => {
  it("reads back what withInstallRecord wrote", () => {
    const raw = withInstallRecord(null, "ssh:nas", record);
    expect(parseInstallRecords(raw)).toEqual({ "ssh:nas": record });
  });

  it("treats absence, emptiness and damage alike: nothing remembered", () => {
    for (const raw of [null, "", "   ", "{ not json", "[]", "null", '"a string"']) {
      expect(parseInstallRecords(raw)).toEqual({});
    }
  });

  it("drops entries that are not a usable record, keeping the ones that are", () => {
    const raw = JSON.stringify({
      "ssh:good": record,
      "ssh:no-version": { at: record.at },
      "ssh:empty-version": { version: "", at: record.at },
      "ssh:no-date": { version: "9.9.9" },
      "ssh:not-an-object": 7,
      "ssh:an-array": [record],
    });
    expect(parseInstallRecords(raw)).toEqual({ "ssh:good": record });
  });
});

describe("withInstallRecord", () => {
  it("adds without disturbing the others — the whole point of a per-machine file", () => {
    let raw = withInstallRecord(null, "ssh:nas", record);
    raw = withInstallRecord(raw, "ssh:build-box", { version: "8.8.8", at: record.at });
    expect(parseInstallRecords(raw)).toEqual({
      "ssh:nas": record,
      "ssh:build-box": { version: "8.8.8", at: record.at },
    });
  });

  it("replaces one machine's record in place", () => {
    const raw = withInstallRecord(withInstallRecord(null, "ssh:nas", record), "ssh:nas", {
      version: "10.0.0",
      at: "2026-08-25T00:00:00.000Z",
    });
    expect(parseInstallRecords(raw)["ssh:nas"]?.version).toBe("10.0.0");
  });

  it("null forgets one machine and leaves the rest", () => {
    let raw = withInstallRecord(null, "ssh:nas", record);
    raw = withInstallRecord(raw, "ssh:build-box", record);
    expect(parseInstallRecords(withInstallRecord(raw, "ssh:nas", null))).toEqual({
      "ssh:build-box": record,
    });
  });

  it("writes over damage rather than propagating it", () => {
    expect(parseInstallRecords(withInstallRecord("{ not json", "ssh:nas", record))).toEqual({
      "ssh:nas": record,
    });
  });
});
