/** TS assignability over data definitions — the rules arktype's intersection-based `extends` does not give. */
import { describe, expect, it } from "vitest";
import { dataExtends } from "../src/kernel/index.js";
import type { TypeTable } from "../src/kernel/index.js";

describe("dataExtends", () => {
  it("leaves go to arktype: literals fit their primitive, not the reverse", () => {
    expect(dataExtends("'a'", "string")).toBe(true);
    expect(dataExtends("string", "'a'")).toBe(false);
    expect(dataExtends("'a'|'b'", "string")).toBe(true);
    expect(dataExtends("'a'", "'a'|'b'")).toBe(true);
    expect(dataExtends("'c'", "'a'|'b'")).toBe(false);
  });

  it("objects: extra keys are fine, optional keys may be absent, required keys may not", () => {
    expect(dataExtends({ a: "string" }, { a: "string", "meta?": { "[string]": "unknown" } })).toBe(
      true,
    );
    expect(dataExtends({ a: "string", b: "number" }, { a: "string" })).toBe(true);
    expect(dataExtends({ a: "string" }, { a: "string", b: "number" })).toBe(false);
    expect(dataExtends({ "a?": "string" }, { a: "string" })).toBe(false);
    expect(dataExtends({ a: "'x'" }, { a: "string" })).toBe(true);
    expect(dataExtends({ a: "string" }, { a: "'x'" })).toBe(false);
  });

  it("index signatures bound the keys the other side does not name", () => {
    expect(dataExtends({ a: "number" }, { "[string]": "number" })).toBe(true);
    expect(dataExtends({ a: "string" }, { "[string]": "number" })).toBe(false);
    expect(dataExtends({ "[string]": "number" }, { a: "number" })).toBe(true);
  });

  it("arrays and tuples, in both spellings", () => {
    expect(dataExtends("string[]", "unknown[]")).toBe(true);
    expect(dataExtends([{ a: "'x'" }, "[]"], [{ a: "string" }, "[]"])).toBe(true);
    expect(dataExtends([{ a: "string" }, "[]"], [{ a: "'x'" }, "[]"])).toBe(false);
    expect(dataExtends(["string", "number"], ["string", "number"])).toBe(true);
    expect(dataExtends(["string"], ["string", "number"])).toBe(false);
    expect(dataExtends(["string", "'a'"], "string[]")).toBe(true);
  });

  it("unions: every member of the source, any member of the target", () => {
    expect(
      dataExtends({ type: "'text'", text: "string" }, [
        { type: "'text'", text: "string" },
        "|",
        { type: "'image'", url: "string" },
      ]),
    ).toBe(true);
    expect(
      dataExtends(
        [{ type: "'text'" }, "|", { type: "'audio'" }],
        [{ type: "'text'" }, "|", { type: "'image'" }],
      ),
    ).toBe(false);
    expect(dataExtends("undefined", [{ a: "string" }, "|", "undefined"])).toBe(true);
    expect(dataExtends("string|undefined", "string")).toBe(false);
  });

  it("unknown takes anything; never fits anything", () => {
    expect(dataExtends({ deep: [{ x: "string" }, "[]"] }, "unknown")).toBe(true);
    expect(dataExtends("never", { a: "string" })).toBe(true);
  });
});

describe("named types and $ref", () => {
  const types: TypeTable = {
    "core#OmniMessage": { role: "'user'|'assistant'", "parts?": [{ $ref: "core#Part" }, "[]"] },
    "core#Part": [{ type: "'text'", text: "string" }, "|", { type: "'image'", url: "string" }],
    "core#Json": [
      "string|number|boolean|null",
      "|",
      [[{ $ref: "core#Json" }, "[]"], "|", { "[string]": { $ref: "core#Json" } }],
    ],
  };

  it("resolves a reference on either side", () => {
    expect(dataExtends({ $ref: "core#Part" }, "unknown", types)).toBe(true);
    expect(dataExtends({ type: "'text'", text: "string" }, { $ref: "core#Part" }, types)).toBe(
      true,
    );
    expect(dataExtends({ $ref: "core#Part" }, { type: "'text'", text: "string" }, types)).toBe(
      false,
    );
    expect(dataExtends({ role: "'user'" }, { $ref: "core#OmniMessage" }, types)).toBe(true);
  });

  it("a recursive type compares finitely, by coinduction", () => {
    expect(dataExtends({ $ref: "core#Json" }, { $ref: "core#Json" }, types)).toBe(true);
    expect(dataExtends(["string", "[]"], { $ref: "core#Json" }, types)).toBe(true);
    expect(dataExtends({ a: { b: ["number", "[]"] } }, { $ref: "core#Json" }, types)).toBe(true);
    expect(dataExtends({ a: "Date" }, { $ref: "core#Json" }, types)).toBe(false);
  });

  it("a dangling reference fits nothing and takes nothing", () => {
    expect(dataExtends({ $ref: "nope" }, "unknown", {})).toBe(true); // unknown takes anything
    expect(dataExtends("string", { $ref: "nope" }, {})).toBe(false);
  });
});
