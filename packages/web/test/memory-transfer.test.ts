/**
 * The Memory tab's whole-scope transfer helpers: what a picked file uploads as, and what a refused
 * import says is at stake.
 *
 * - A picked zip goes up whole, as the export produced it; a JSON file an earlier version exported
 *   goes up as its version 1 document. Anything else is refused before anything is sent, in the
 *   active language, and a document with neither memories nor an index is called empty.
 * - A refusal that asks for confirmation hands the confirmation the memories it names; any other
 *   error is not mistaken for one.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  MemoryDocumentError,
  importConfirmPlan,
  memoryUploadOf,
} from "../src/features/agents/memory-transfer";

afterEach(() => setActiveStrings(zh));

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

const v1 = (names: string[], index: string | null = "# Memories\n") => ({
  format: "penguin-memory-scope",
  version: 1,
  scopeKey: "my-app-a81f32c4",
  kind: "workspace",
  exportedAt: "2026-08-20T00:00:00.000Z",
  index,
  files: names.map((name) => ({ name, content: `---\nname: ${name}\n---\nbody\n` })),
});

describe("memoryUploadOf", () => {
  it("sends a picked zip up whole, byte for byte", () => {
    // `PK` and then bytes no text decoder would keep: the zip must not pass through one.
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80, 0x41]);
    const upload = memoryUploadOf(zip);
    expect(upload.payload).toBeUndefined();
    expect([...Uint8Array.from(atob(upload.dataBase64!), (c) => c.charCodeAt(0))]).toEqual([
      ...zip,
    ]);
  });

  it("sends a JSON file an earlier version exported as its version 1 document", () => {
    const upload = memoryUploadOf(bytesOf(JSON.stringify(v1(["a.md", "b.md"]))));
    expect(upload.dataBase64).toBeUndefined();
    expect(upload.payload?.files.map((f) => f.name)).toEqual(["a.md", "b.md"]);
  });

  it("refuses anything else, in the active language", () => {
    const refusals = [
      "not json at all",
      JSON.stringify([1, 2]),
      JSON.stringify({ ...v1(["a.md"]), format: "some-other-tool" }),
      JSON.stringify({ ...v1(["a.md"]), version: 2 }),
      JSON.stringify({ ...v1(["a.md"]), files: "nope" }),
      JSON.stringify({ ...v1([]), files: [{ name: "a.md" }] }),
    ];
    for (const text of refusals) {
      expect(() => memoryUploadOf(bytesOf(text))).toThrow(MemoryDocumentError);
    }
    setActiveStrings(en);
    expect(() => memoryUploadOf(bytesOf("{}"))).toThrow(S.memory.importInvalidFile);
    setActiveStrings(zh);
    expect(() => memoryUploadOf(bytesOf("{}"))).toThrow(S.memory.importInvalidFile);
  });

  it("calls a document with neither memories nor an index empty", () => {
    expect(() => memoryUploadOf(bytesOf(JSON.stringify(v1([], null))))).toThrow(
      S.memory.importEmptyFile,
    );
    // An index alone is still worth importing: it is the only part the model reads.
    expect(memoryUploadOf(bytesOf(JSON.stringify(v1([])))).payload?.files).toEqual([]);
  });
});

describe("importConfirmPlan", () => {
  it("names what a refused import would overwrite and delete, and whether it takes the index", () => {
    const refused = new ApiError(409, "memory_import_confirm_required", "confirm", undefined, {
      overwritten: JSON.stringify(["keep.md"]),
      removed: JSON.stringify(["gone.md", "leftover/"]),
      replacesIndex: "true",
    });
    expect(importConfirmPlan(refused)).toEqual({
      overwritten: ["keep.md"],
      removed: ["gone.md", "leftover/"],
      replacesIndex: true,
    });
  });

  it("takes no other error for a request to confirm", () => {
    expect(importConfirmPlan(new ApiError(409, "memory_folder_not_a_directory", "no"))).toBeNull();
    expect(importConfirmPlan(new Error("network"))).toBeNull();
  });
});
