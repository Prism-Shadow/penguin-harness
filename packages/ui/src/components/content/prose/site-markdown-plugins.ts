/**
 * The plugin lists of the public sites' articles (`SiteMarkdown`), apart from the chat pipeline
 * in markdown-plugins.ts. The site entry (`@prismshadow/penguin-ui/site`) loads this module and
 * not that one, so the landing page and the docs never load the chat dialect, which they do not
 * use.
 */
import remarkGfm from "remark-gfm";
import type { Options } from "react-markdown";
import { rehypeMarkdownTables } from "./markdown-table";

/**
 * The remark stage: GitHub-flavoured Markdown and nothing else. The sites' posts and pages are
 * first-party Markdown written for GitHub's renderer — strikethrough means strikethrough, a `$` is
 * a shell prompt, a bare URL ends where GitHub ends it, and their links are written as links — so
 * the chat dialect, which answers model output, would change how they read.
 */
export const SITE_REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [remarkGfm];

/**
 * The rehype stage: the table pass, so a table on the docs site or the blog is boxed and
 * classified the way a chat reply's is. A host that brings its own rehype stage (the blog's raw
 * HTML) gets the pass appended after it, so a table written as raw HTML is shaped too.
 */
export const SITE_REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [rehypeMarkdownTables];
