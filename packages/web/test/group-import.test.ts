/**
 * Add-group bulk import row building: listing order preserved, duplicates skipped and
 * counted (within the listing and against already-configured pairs), and every imported
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
      expect(row.vision).toBe(true);
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

  it("produces rows that persist as full entries (protocol, base URL, key; vision omitted as supported)", () => {
    const { rows } = buildImportedRows([], "mygw", ["m-x"], config);
    expect(rowToEntry(rows[0]!)).toEqual({
      provider: "mygw",
      modelId: "m-x",
      clientType: "openai-chat",
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
      baseUrl: "https://gw.example/v1",
    });
  });
});
