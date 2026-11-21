/**
 * - A Chinese or English chapter heading starts a chapter, preserving wrapped words and paragraphs.
 * - A malformed archive or an empty or oversized text file fails before a book reaches the shelf.
 */
import { expect, it } from "vitest";
// @ts-expect-error The same browser module handles file imports in the workbench.
import { importBook } from "../workbenches/reading/ui/import.js";

it("recognizes bilingual chapter headings and preserves English word boundaries", async () => {
  const book = await importBook(
    new File(["# 清晨\n\n山还在。\n\nChapter II\n\nA boat\ncame back.\n\nThe end."], "two.md"),
  );
  expect(book.chapters).toEqual([
    { title: "清晨", paragraphs: ["山还在。"] },
    { title: "Chapter II", paragraphs: ["A boat came back.", "The end."] },
  ]);
});

it("rejects malformed archives, empty books and oversized files", async () => {
  await expect(importBook(new File(["not a zip"], "bad.epub"))).rejects.toThrow();
  await expect(importBook(new File(["\n"], "empty.txt"))).rejects.toThrow("noText");
  await expect(importBook({ name: "huge.txt", size: 33 * 1024 * 1024 })).rejects.toThrow(
    "tooLarge",
  );
});
