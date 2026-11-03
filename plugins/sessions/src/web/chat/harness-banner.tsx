/**
 * A harness-injected user message (`sender: "harness"` — a stop hook's continue, the goal
 * plugin's round protocol, a user_prompt hook's expansion context): rendered as an activity
 * card of the event kind (ActivityGroup) collapsed, in the background notice's form, rather than
 * as a user bubble — the text is machine-composed protocol, worth a glance, not a read. The hook glyph stands in
 * the status icon's place: the message is an event, not a step with an outcome. Expanded, the
 * full text shows in the tool cards' output styling; the Trace page shows the raw message as-is.
 */
import {
  ActivityGroup,
  DISCLOSURE_OUTPUT_PRE_CLASS,
  GlyphIcon,
  ICONS,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

export function HarnessInjectedBanner({ text }: { text: string }) {
  return (
    <ActivityGroup
      kind="event"
      state="done"
      mark={<GlyphIcon d={ICONS.fishHook} size={14} className="text-fg-subtle" />}
      title={S.chat.harnessInjected}
    >
      <pre className={DISCLOSURE_OUTPUT_PRE_CLASS}>{text}</pre>
    </ActivityGroup>
  );
}
