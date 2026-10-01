/**
 * Source notice for a skill invocation: the `[use_skills]` block at the start of a message isn't
 * shown verbatim, it's collapsed into one harness note (TranscriptNote): the fixed phrase "Using
 * skills" and the skills' names (book icon + static text, no navigation — skill management lives
 * on the skill library page); the body text after the block is rendered as usual by the caller.
 */
import { TranscriptNote } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { BOOK_ICON } from "./skill-use";

export function SkillsBanner({ names }: { names: string[] }) {
  return (
    <TranscriptNote
      className="anim-msg my-2"
      mark={BOOK_ICON}
      label={S.chat.skillsLabel(names.length)}
      subject={S.chat.nameList(names)}
    />
  );
}
