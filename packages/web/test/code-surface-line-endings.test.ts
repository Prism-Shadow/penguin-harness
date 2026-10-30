// @vitest-environment jsdom
/**
 * A numbered code surface (the UI package's CodeSurface, as the Files panel draws it) coloured by
 * the app's own highlighter — the real Shiki engine, which jsdom runs on the main thread.
 *
 * - Given a file with LF or with CRLF line endings, every line with code on it is coloured. Shiki
 *   drops the carriage return the surface keeps, so a CRLF line has to be matched without it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { CodeSurface } from "@prismshadow/penguin-ui";
import { highlightCode } from "../src/features/chat/code-highlight";
import { mount, unmountAll, waitFor } from "./helpers/dom";

const LINES = [
  "// A small module.",
  "",
  "export function double(x: number): number {",
  "  return x * 2;",
  "}",
  "",
  "export const LIMIT = 42;",
];

const lineElements = () => [...document.querySelectorAll<HTMLElement>(".code-surface .line")];
const coloured = (line: HTMLElement) => line.querySelector("span[style]") !== null;

afterEach(async () => {
  await unmountAll();
});

describe("a numbered surface's colours", () => {
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("colour every line of a %s file", async (_, eol) => {
    const code = LINES.join(eol);
    // The engine and the grammar load on the first call; this waits for them, not for time.
    await highlightCode(code, "ts", { blockLines: true });

    await mount(
      h(CodeSurface, { language: "ts", code, lineNumbers: true, highlight: highlightCode }),
    );
    await waitFor(() => lineElements().some(coloured), 50);

    expect(lineElements().map(coloured)).toEqual(LINES.map((line) => line !== ""));
  });
});
