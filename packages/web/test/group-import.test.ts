/**
 * Add-group bulk import: the endpoint's base URL, protocol and key become the GROUP's
 * connection, written once; the imported rows keep the listing's order, skip and count the
 * entries that produce no row (duplicates, and ids the config could not hold), and store
 * nothing of the connection — each persists as a bare model that follows its group.
 */
import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@prismshadow/penguin-server/api";
import { applyProviderUpdate } from "../src/features/models/connection";
import { buildImportedRows, groupImportConnection } from "../src/features/models/group-import";
import { rowToEntry, toRow } from "../src/features/models/models-page";

const config = { baseUrl: "https://gw.example/v1", clientType: "openai-chat", apiKey: "sk-g1" };

/** A saved model as GET /models sends it. */
const saved = (provider: string, modelId: string): ModelInfo => ({
  provider,
  modelId,
  isDefault: false,
  effective: { baseUrlSource: "none", clientTypeSource: "none", apiKeySource: "none" },
});

describe("the group's connection", () => {
  it("carries the endpoint, the protocol and the typed key, once", () => {
    expect(groupImportConnection(config)).toEqual({
      baseUrl: "https://gw.example/v1",
      clientType: "openai-chat",
      apiKey: "sk-g1",
    });
  });

  it("leaves the key out when none was typed", () => {
    expect(groupImportConnection({ ...config, apiKey: "  " })).toEqual({
      baseUrl: "https://gw.example/v1",
      clientType: "openai-chat",
    });
  });
});

describe("buildImportedRows", () => {
  it("keeps the endpoint's order, in the new group, with nothing of the connection on a row", () => {
    const { rows, added, skipped } = buildImportedRows([], "mygw", ["m-b", "m-a"]);
    expect(added).toBe(2);
    expect(skipped).toBe(0);
    expect(rows.map((r) => r.modelId)).toEqual(["m-b", "m-a"]);
    for (const row of rows) {
      expect(row.provider).toBe("mygw");
      expect(row.original).toBeNull();
      expect(row.clientType).toBe("");
      expect(row.baseUrl).toBe("");
      expect(row.apiKeyInput).toBe("");
      // The same start a hand-added model in a user-defined group gets: no vision claim.
      expect(row.vision).toBe(false);
    }
  });

  it("skips duplicates within the listing and against existing pairs, counting them", () => {
    const existing = [
      toRow(saved("mygw", "m-a")),
      // Same id under another group is a different (provider, modelId) pair — not a duplicate.
      toRow(saved("other", "m-b")),
    ];
    const { rows, added, skipped } = buildImportedRows(existing, "mygw", [
      "m-a",
      "m-b",
      "m-b",
      "m-c",
    ]);
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
    const { rows, added, skipped } = buildImportedRows([], "mygw", listing);
    // Trimmed, and the 200-character id (exactly the server's bound) still lands.
    expect(rows.map((r) => r.modelId)).toEqual(["m-trim", "x".repeat(200)]);
    expect(added).toBe(2);
    expect(skipped).toBe(5);
  });

  it("counts a listing entry that only duplicates another after trimming", () => {
    const { added, skipped } = buildImportedRows([], "mygw", ["m-a", " m-a "]);
    expect(added).toBe(1);
    expect(skipped).toBe(1);
  });

  it("produces rows that persist bare once the group holds the protocol", () => {
    const { rows } = buildImportedRows([], "mygw", ["m-x"]);
    // The page judges each row against its group as the import's own request leaves it.
    const group = applyProviderUpdate(undefined, groupImportConnection(config));
    expect(rowToEntry(rows[0]!, group)).toEqual({
      provider: "mygw",
      modelId: "m-x",
      vision: false,
    });
  });

  it("would carry the compatible protocol if the group had none, so no model is left unstartable", () => {
    const { rows } = buildImportedRows([], "mygw", ["m-x"]);
    expect(rowToEntry(rows[0]!, undefined).clientType).toBe("openai-chat");
  });
});
