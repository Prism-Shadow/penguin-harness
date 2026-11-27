/**
 * The pieces the channels' credential sections are built from, and the editor's shell borrows
 * the link of: the corner-linked field, the external link, the stored-secret row, and the
 * text for a field's validation code.
 */
import type { ReactNode } from "react";
import { Checkbox, FieldLabel } from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import type { MessagingFormErrors } from "./channel-form";

export function errorText(
  code: MessagingFormErrors[keyof MessagingFormErrors],
): string | undefined {
  if (code === undefined) return undefined;
  if (code === "required") return S.common.requiredField;
  if (code === "token_invalid") return S.telegram.invalidToken;
  return S.feishu.invalidDomain;
}

/** External link styled like the models dialog's "get API key" corner action. */
export function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="shrink-0 text-xs text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
    >
      {label} ↗
    </a>
  );
}

/**
 * A field with an action link at the label's top-right corner — the models dialog's
 * "get API key" idiom. The control inside carries `aria-label` itself: this wrapper's
 * label row is layout, not a <label> element.
 */
export function CornerLinkedField({
  label,
  required,
  link,
  children,
}: {
  label: string;
  required?: boolean;
  link: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <FieldLabel block={false} {...(required ? { required: true } : {})}>
          {label}
        </FieldLabel>
        {link}
      </span>
      {children}
    </div>
  );
}

/**
 * The stored secret's status row, under the secret field — the models-page configured-key
 * idiom: the site-wide mask in mono, and a "clear stored …" checkbox applied on Save
 * (typing into the field unchecks it). Clearing requires the channel's connection to be
 * disabled first, so the checkbox is gated with that hint while enabled.
 */
export function StoredSecretRow({
  masked,
  clearLabel,
  checked,
  enabled,
  readOnly,
  onChange,
}: {
  masked: string;
  clearLabel: string;
  /** The clear checkbox's state (lives in the form, applied on Save). */
  checked: boolean;
  /** The channel's connection is enabled: clearing is gated until it is turned off. */
  enabled: boolean;
  /** The binding's machine is out of reach: nothing can be saved, so nothing can be cleared. */
  readOnly: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
      <span className="font-mono">{masked}</span>
      <Checkbox
        checked={checked}
        disabled={enabled || readOnly}
        onChange={onChange}
        label={clearLabel}
      />
      {/* A disabled checkbox does not reliably fire hover, so the reason is on screen rather
          than in a title: a gated control that never says why is the bug this avoids. */}
      {enabled && (
        <span className="text-gray-400 dark:text-gray-500">
          {S.messaging.disableBeforeClearHint}
        </span>
      )}
    </div>
  );
}
