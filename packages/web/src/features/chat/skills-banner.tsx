/**
 * Source notice for a skill invocation: the `[use_skills]` block at the start of a message isn't
 * shown verbatim, it's collapsed into a single line reading "Using skills: <names>" (book icon +
 * static text, no navigation — skill management lives on the skill library page); the body text
 * after the block is rendered as usual by the caller.
 */
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { BOOK_ICON } from "./skill-use";

export function SkillsBanner({ names }: { names: string[] }) {
  return (
    <p className="anim-msg my-2 flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      <GlyphIcon d={BOOK_ICON} className="text-gray-400 dark:text-gray-500" />
      {S.chat.skillsBanner(names)}
    </p>
  );
}
