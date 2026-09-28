import { describe, expect, it } from "vitest";
import type { LibraryFile } from "@prismshadow/penguin-server/api";
import { activityEndpointParts } from "../src/features/activities/media-library";
import {
  bundleItems,
  filterLibrary,
  otherActivitiesFiles,
  productCodes,
  selectAll,
  selectedFiles,
  selectionKey,
  sortLibrary,
  toggleOne,
} from "../src/features/activities/project-media";

function file(name: string, overrides: Partial<LibraryFile> = {}): LibraryFile {
  return {
    path: `media/uploads/${name}`,
    name,
    kind: "image",
    mimeType: "image/png",
    byteLength: 100,
    updatedAt: "2026-09-20T10:00:00.000Z",
    activityId: "act_one",
    activityTitle: "Sight words",
    productCode: "words",
    refNum: 1,
    ...overrides,
  };
}

const cat = file("cat-1111.png", { byteLength: 300, updatedAt: "2026-09-22T10:00:00.000Z" });
const bell = file("bell-2222.wav", {
  kind: "audio",
  mimeType: "audio/wav",
  byteLength: 50,
  activityId: "act_two",
  activityTitle: "Letter hunt",
  productCode: "letters",
  refNum: 3,
});
const clip = file("clip-3333.mp4", {
  kind: "video",
  mimeType: "video/mp4",
  byteLength: 900,
  updatedAt: "2026-09-21T10:00:00.000Z",
  activityId: "act_three",
  activityTitle: "Counting",
  productCode: "count",
  refNum: 2,
});
// The same stored name in another activity: a different file to the library.
const catAgain = file("cat-1111.png", {
  activityId: "act_two",
  activityTitle: "Letter hunt",
  productCode: "letters",
  refNum: 3,
});
const all = [cat, bell, clip, catAgain];

describe("filterLibrary", () => {
  it("narrows by kind, product and a search over name, title and ref", () => {
    const none = { kind: "all" as const, productCode: "", query: "" };
    expect(filterLibrary(all, none)).toEqual(all);
    expect(filterLibrary(all, { ...none, kind: "audio" })).toEqual([bell]);
    expect(filterLibrary(all, { ...none, productCode: "letters" })).toEqual([bell, catAgain]);
    expect(filterLibrary(all, { ...none, query: " CAT " })).toEqual([cat, catAgain]);
    expect(filterLibrary(all, { ...none, query: "counting" })).toEqual([clip]);
    expect(filterLibrary(all, { ...none, query: "letters / 3" })).toEqual([bell, catAgain]);
    expect(filterLibrary(all, { kind: "image", productCode: "words", query: "cat" })).toEqual([
      cat,
    ]);
    expect(filterLibrary(all, { ...none, query: "zebra" })).toEqual([]);
  });
});

describe("sortLibrary", () => {
  it("orders by name, newest, size or activity without changing the input", () => {
    const input = [...all];
    expect(sortLibrary(input, "name").map((entry) => [entry.name, entry.activityId])).toEqual([
      ["bell-2222.wav", "act_two"],
      ["cat-1111.png", "act_two"],
      ["cat-1111.png", "act_one"],
      ["clip-3333.mp4", "act_three"],
    ]);
    expect(sortLibrary(input, "newest")[0]).toBe(cat);
    expect(sortLibrary(input, "size").map((entry) => entry.byteLength)).toEqual([
      900, 300, 100, 50,
    ]);
    expect(sortLibrary(input, "activity").map((entry) => entry.productCode)).toEqual([
      "count",
      "letters",
      "letters",
      "words",
    ]);
    expect(input).toEqual(all);
  });
});

describe("selection", () => {
  it("keys a file by activity and path, so the same name in two activities is two files", () => {
    expect(selectionKey(cat)).not.toBe(selectionKey(catAgain));
    let selection = toggleOne(new Set(), cat);
    expect(selectedFiles(all, selection)).toEqual([cat]);
    selection = toggleOne(selection, catAgain);
    expect(selectedFiles(all, selection)).toEqual([cat, catAgain]);
    selection = toggleOne(selection, cat);
    expect(selectedFiles(all, selection)).toEqual([catAgain]);
  });

  it("adds every shown file and keeps earlier choices", () => {
    const selection = selectAll(new Set([selectionKey(clip)]), [cat, bell]);
    expect(selectedFiles(all, selection)).toEqual([cat, bell, clip]);
  });

  it("names each chosen file by activity and path for the bundle", () => {
    expect(bundleItems([cat, catAgain])).toEqual([
      { activityId: "act_one", path: "media/uploads/cat-1111.png" },
      { activityId: "act_two", path: "media/uploads/cat-1111.png" },
    ]);
  });
});

describe("products and the picker's pool", () => {
  it("lists each product once, in order", () => {
    expect(productCodes(all)).toEqual(["count", "letters", "words"]);
    expect(productCodes([])).toEqual([]);
  });

  it("offers other activities' files of the asset's kind, never this activity's own", () => {
    expect(otherActivitiesFiles(all, "act_one", "image")).toEqual([catAgain]);
    expect(otherActivitiesFiles(all, "act_two", "audio")).toEqual([]);
    expect(otherActivitiesFiles(all, "act_one", "video")).toEqual([clip]);
  });

  it("splits an activity endpoint into the project's activities endpoint and the id", () => {
    expect(activityEndpointParts("/api/projects/p-1/activities/act_one")).toEqual({
      projectBase: "/api/projects/p-1/activities",
      activityId: "act_one",
    });
    expect(activityEndpointParts("/api/projects/p/activities/a%20b").activityId).toBe("a b");
  });
});
