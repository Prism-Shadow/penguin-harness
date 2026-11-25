/**
 * The body of the composer's notice after a refusal hand-off: why first, then what to do.
 *
 * Line one is the fixed lead and the provider's own words — the sentence a JSON body holds for a
 * person, plain text as it came — clamped at two lines (Expand appears only when they really run
 * past them), then 「[详情]」, which opens the request's failure details: the whole message, the
 * raw body included, Copy, and the GitHub path. The transcript's request lines
 * keep those words out of the line; this notice shows them on purpose, since it asks the person
 * to change a setting and the words are what tell them whether the setting is the cause. A
 * provider that sent no words leaves the lead standing alone, ended with a full stop.
 *
 * Line two is what was done, then the likely cause and the two numbers to correct.
 */
import type { ReactElement } from "react";
import { ClampedText, TextAction } from "@prismshadow/penguin-ui";
import { S } from "@prismshadow/penguin-web/internal";
import { providerWordsOf } from "./provider-error";

export function RefusedHandoffNotice({
  message,
  onDetails,
}: {
  /** The provider's own words; undefined when it sent none. */
  message: string | undefined;
  /** Opens the failure details; undefined where the host cannot show them. */
  onDetails?: (() => void) | undefined;
}): ReactElement {
  const t = S.chat.contextRefusedHandoff;
  // Blank words are no words: the lead then stands alone rather than before an empty clamp. A
  // JSON body shows only the sentence it holds for a person; 「[详情]」 keeps the whole body.
  const words =
    message !== undefined && message.trim() !== "" ? providerWordsOf(message) : undefined;
  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span>{t.reason(words !== undefined)}</span>
        {words !== undefined && <ClampedText lines={2}>{words}</ClampedText>}
        {onDetails !== undefined && (
          <TextAction data-failure-details="" onClick={onDetails}>
            {S.chat.failureReport.open}
          </TextAction>
        )}
      </p>
      <p>{t.advice}</p>
    </>
  );
}
