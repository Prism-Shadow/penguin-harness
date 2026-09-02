/**
 * A harness-injected user message (`sender: "harness"` — a stop hook's continue, the goal
 * plugin's round protocol, a user_prompt hook's expansion context): rendered as a compact
 * collapsed card in the background notice's form rather than as a user bubble — the text is
 * machine-composed protocol, worth a glance, not a read. Expanded, the full text shows in
 * the tool cards' output styling; the Trace page shows the raw message as-is.
 */
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { HOOK_ICON } from "../../components/ui/icons";
import {
  DISCLOSURE_CARD_CLASS,
  DISCLOSURE_OUTPUT_PRE_CLASS,
  DisclosureRow,
} from "./disclosure-row";

export function HarnessInjectedBanner({ text }: { text: string }) {
  return (
    <div className={DISCLOSURE_CARD_CLASS}>
      <DisclosureRow
        variant="header"
        icon={<GlyphIcon d={HOOK_ICON} size={14} className="text-gray-400 dark:text-gray-500" />}
        label={S.chat.harnessInjected}
      >
        <pre className={DISCLOSURE_OUTPUT_PRE_CLASS}>{text}</pre>
      </DisclosureRow>
    </div>
  );
}
