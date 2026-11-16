/**
 * `@prismshadow/chat-markdown`: the Markdown dialect a reply is read in, wherever it is read —
 * the Web App's transcript (packages/ui's REMARK_PLUGINS) and the chat channels a reply is
 * relayed to (packages/server's messaging parser). One plugin, so the two cannot disagree about
 * what the model wrote: which characters are a link and which are bold.
 *
 * The dialect is CommonMark plus GFM's tables, task lists, footnotes and strikethrough, with two
 * changes, both made while parsing:
 *
 * - **Bare URLs** follow bare-url.ts instead of GFM's autolink literal: a URL is ASCII URL
 *   characters only, so it ends where Chinese text or full-width punctuation begins, and a `**`
 *   right after it can still close the bold it belongs to.
 * - **Emphasis** follows the CJK-friendly flanking rule (`micromark-extension-cjk-friendly`):
 *   under CommonMark's own rule a `**` between punctuation and a CJK character cannot close,
 *   which leaves `**粗体（注）**后面` and `请**打开 http://…/**查看` unbolded.
 *
 * Strikethrough is still parsed: each host shows its tildes as written, in a pass of its own.
 *
 * Browser-safe: the server imports it as a dependency, and packages/ui bundles it into its
 * published modules. remark-parse is the host's; this only registers extensions on it.
 */
import { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { bareUrlFromMarkdown, bareUrlSyntax } from "./bare-url.js";

/**
 * The `this.data()` bag unified plugins share to register parser extensions. `settings` is
 * unified's own field: naming it lets unified's `Data` match this shape in a program that does
 * not load remark-parse's types, which is where the two lists are declared.
 */
interface ProcessorData {
  settings?: unknown;
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
}

/**
 * remark plugin: the chat dialect, registered on remark-parse. Takes the place of `remark-gfm`
 * in a chat pipeline; a host adds its own passes after it.
 */
export function remarkChatMarkdown(this: { data(): ProcessorData }): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(
    gfmFootnote(),
    gfmStrikethrough(),
    gfmTable(),
    gfmTaskListItem(),
    // Before the URL constructs, so that at `_` an email address is tried before emphasis, as
    // under GFM: micromark tries a later extension's constructs first.
    cjkFriendlyExtension(),
    bareUrlSyntax,
  );
  (data.fromMarkdownExtensions ??= []).push(
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
    bareUrlFromMarkdown,
  );
}
