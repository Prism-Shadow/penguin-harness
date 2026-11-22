/**
 * Text cut to a length for display. The length counts UTF-16 units, as `String#slice` does, but
 * a cut never falls between the two halves of a surrogate pair: a character outside the BMP (an
 * emoji, a rare CJK ideograph) is two units, and a lone half prints as `�`. Such a cut steps
 * back one unit and drops the whole character, the way core's `truncateTitle` does.
 */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}
