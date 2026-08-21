/**
 * Add-group bulk import row building: listing order preserved, entries that produce no row
 * skipped and counted (duplicates, and ids the config could not hold), and every imported
 * row carrying the endpoint config inline in the shape rowToEntry persists.
 */
import { describe, expect, it } from "vitest";
import { buildImportedRows } from "../src/features/models/group-import";
import { rowToEntry, toRow } from "../src/features/models/models-page";

const config = { baseUrl: "https://gw.example/v1", clientType: "openai-chat", apiKey: "sk-g1" };

describe("buildImportedRows", () => {
  it("keeps the endpoint's order and carries base URL / protocol / key on every row", () => {
    const { rows, added, skipped } = buildImportedRows([], "mygw", ["m-b", "m-a"], config);
    expect(added).toBe(2);
    expect(skipped).toBe(0);
    expect(rows.map((r) => r.modelId)).toEqual(["m-b", "m-a"]);
    for (const row of rows) {
      expect(row.provider).toBe("mygw");
      expect(row.original).toBeNull();
      expect(row.clientType).toBe("openai-chat");
      expect(row.baseUrl).toBe("https://gw.example/v1");
      expect(row.apiKeyInput).toBe("sk-g1");
      // The same start a hand-added model in a user-defined group gets: no vision claim.
      expect(row.vision).toBe(false);
    }
  });

  it("skips duplicates within the listing and against existing pairs, counting them", () => {
    const existing = [
      toRow({ provider: "mygw", modelId: "m-a", isDefault: false }),
      // Same id under another group is a different (provider, modelId) pair — not a duplicate.
      toRow({ provider: "other", modelId: "m-b", isDefault: false }),
    ];
    const { rows, added, skipped } = buildImportedRows(
      existing,
      "mygw",
      ["m-a", "m-b", "m-b", "m-c"],
      config,
    );
    expect(added).toBe(2);
    expect(skipped).toBe(2);
    expect(rows.map((r) => r.modelId)).toEqual(["m-b", "m-c"]);
  });

  it("drops ids the config could not hold instead of letting one entry 400 the whole PUT", () => {
    const listing = [
      "  m-trim  ",
      "",
      "   ",
      "x".repeat(201),
      "m-\u0000nul",
      "m-\nnewline",
      "x".repeat(200),
    ];
    const { rows, added, skipped } = buildImportedRows([], "mygw", listing, config);
    // Trimmed, and the 200-character id (exactly the server's bound) still lands.
    expect(rows.map((r) => r.modelId)).toEqual(["m-trim", "x".repeat(200)]);
    expect(added).toBe(2);
    expect(skipped).toBe(5);
  });

  it("counts a listing entry that only duplicates another after trimming", () => {
    const { added, skipped } = buildImportedRows([], "mygw", ["m-a", " m-a "], config);
    expect(added).toBe(1);
    expect(skipped).toBe(1);
  });

  it("produces rows that persist as full entries (protocol, base URL, key; vision unset)", () => {
    const { rows } = buildImportedRows([], "mygw", ["m-x"], config);
    expect(rowToEntry(rows[0]!)).toEqual({
      provider: "mygw",
      modelId: "m-x",
      clientType: "openai-chat",
      vision: false,
      baseUrl: "https://gw.example/v1",
      apiKey: "sk-g1",
    });
  });

  it("leaves the key off entries when none was typed (environment fallback)", () => {
    const { rows } = buildImportedRows([], "mygw", ["m-x"], { ...config, apiKey: "" });
    expect(rowToEntry(rows[0]!)).toEqual({
      provider: "mygw",
      modelId: "m-x",
      clientType: "openai-chat",
      vision: false,
      baseUrl: "https://gw.example/v1",
    });
  });
});
