/**
 * The app's code highlighter, handed to the shared UI package's code surfaces once, around the app
 * (`CodeHighlighterProvider` in app.tsx). The package never runs Shiki itself; this is where the
 * Web App decides that it runs on a worker (highlighter.ts).
 *
 * The worker client is imported on the first call, not up front, so it stays in a chunk of its own
 * that a session with no code block never fetches — as it did when the code block imported it.
 */
import type { CodeHighlighter } from "@prismshadow/penguin-ui";

export const highlightCode: CodeHighlighter = (code, language, options) =>
  import("./highlighter").then((mod) => mod.highlightToHtml(code, language, options));
