/**
 * The plugin import flows' DOM-free half: the client-side size guard, the name a failed import
 * is about, and the code → copy mapping for the failures the upload and download routes raise.
 *
 * Split out of plugin-import-dialog.tsx so each piece can be unit-tested on its own — the
 * dialog only wires them to state, and nothing here touches the DOM. The same split as
 * lib/upload-limits.ts, and for the same reason: a client that draws a line (a size ceiling, a
 * name, a message) must draw it exactly where the server does, and that agreement is only
 * checkable without a browser.
 */
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { MB_BYTES } from "../../lib/upload-limits";

/**
 * The decoded-zip ceiling both plugin routes enforce, in whole MB — the same 14MB cap the skill
 * and hook archive routes use (`MAX_ARCHIVE_BYTES`), which the server keeps in one place and
 * the web cannot import (it resolves the server's wire types only). Named here rather than
 * inlined so the copy that quotes it and the check that applies it cannot drift apart.
 */
export const PLUGIN_ZIP_LIMIT_MB = 14;

/**
 * Whether a picked zip is over the ceiling and must be refused BEFORE it is read.
 *
 * `>` and not `>=`, matching the server's `bytes.length > limit`: an off-by-one here would
 * reject exactly the file a user just resized to fit. Reading first would cost the wait and
 * then a base64 request a third larger than the file — to earn a 413 that this check can
 * answer instantly, in the file picker's own language.
 */
export function pluginZipTooLarge(bytes: number): boolean {
  return bytes > PLUGIN_ZIP_LIMIT_MB * MB_BYTES;
}

/**
 * The rule a plugin name has to satisfy, as a client copy of the server's own
 * (`PLUGIN_NAME_PATTERN` in core): the name IS the directory the plugin is installed under, so it
 * has to be one safe path segment. Copied rather than imported for the same reason as the ceiling
 * above — the web resolves the server's wire types, never its source — which is exactly why the
 * dialog checks with it before submitting: the server's 400 would be the first thing a user learns
 * about a typo otherwise.
 */
export const PLUGIN_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Whether the name field must hold the submit back. The field is OPTIONAL: empty means "let the
 * archive name the plugin" (see pluginNameBody), so only a non-empty value is held to the rule —
 * and the surrounding blanks of a value the user did type are not their problem.
 */
export function pluginNameInvalid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed !== "" && !PLUGIN_NAME_PATTERN.test(trimmed);
}

/**
 * The name field of an import request: the typed name trimmed, or NO field at all when the box is
 * empty — never `name: ""`.
 *
 * An absent name is what tells the server to name the plugin after the archive (the directory
 * inside it that carries plugin.json); an empty one is a name that fails the rule above and earns
 * a 400, which would turn the optional field into a trap. The blanks-only case goes out absent for
 * the same reason: nobody typed a name.
 */
export function pluginNameBody(name: string): { name?: string } {
  const trimmed = name.trim();
  return trimmed === "" ? {} : { name: trimmed };
}

/**
 * The plugin name a URL names, for the overwrite confirmation's copy — the name the server
 * would derive, read off the address the user pasted.
 *
 * - `https://github.com/<owner>/<repo>` names the repo (a trailing `.git` included: the address
 *   bar hands one back when it was copied from the clone button);
 * - `…/tree/<ref>/<subdir…>` names the plugin root, i.e. the LAST segment of the subdirectory —
 *   the subdirectory IS the plugin (see the route's shallowest-plugin.json rule), and the ref
 *   in front of it names a commit rather than anything the user will recognize;
 * - anything else names its last segment with a `.zip` suffix dropped: a direct link to the
 *   archive.
 *
 * Query and fragment are stripped first: neither names anything, and a pasted address usually
 * ends in a trailing slash, which would otherwise leave an empty last segment.
 */
export function pluginNameFromUrl(url: string): string {
  const segments = url
    .trim()
    .replace(/[?#].*$/, "")
    .split("/")
    .filter((segment) => segment.length > 0);
  const tree = segments.indexOf("tree");
  // `…/tree/<ref>` alone: the last segment is the ref, so the repo before it is the only name
  // the address carries.
  if (tree !== -1 && segments.length <= tree + 2) return segments[tree - 1] ?? "";
  const last = segments[segments.length - 1] ?? "";
  // A tree URL points at a directory, so its last segment is already the name; everywhere else
  // the last segment is a file (`plugin.zip`) or a repo (`plugin.git`).
  return tree === -1 ? last.replace(/\.(zip|git)$/i, "") : last;
}

/** The name inside the 409 the plugin routes answer with: "A user plugin named <name> is already installed." */
const NAMED_IN_MESSAGE = /\bnamed\s+([A-Za-z0-9_-]+)\b/;
/** The tail form ("…: <name>") the skill and hook imports already parse, read too in case the wording converges on that one. */
const TAILED_IN_MESSAGE = /:\s*([A-Za-z0-9_-]+)$/;

/**
 * The plugin name a 409 is about, for the overwrite confirmation's copy; `fallback` (the picked
 * file's stem, or the name the URL spells) covers a rewording on the server side.
 *
 * The message is not a contract — the CODE is, and that is what the caller branches on — so a
 * miss here only costs the confirmation a less exact name. What must never happen is a nameless
 * confirmation over a question ("overwrite which plugin?"), which the fallback rules out.
 */
export function pluginNameFromError(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  return (
    NAMED_IN_MESSAGE.exec(err.message)?.[1] ?? TAILED_IN_MESSAGE.exec(err.message)?.[1] ?? fallback
  );
}

/**
 * The text of a failed import or delete: the plugin codes the routes answer with get their own
 * copy (the server's message is English-only, the UI language may not be), everything else
 * goes through the shared error mapping.
 */
export function pluginImportErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    const byCode = S.plugins.importErrors as Record<string, string | undefined>;
    const text = byCode[err.code];
    if (text !== undefined) return text;
  }
  return apiErrorText(err);
}
