/**
 * Whether a click is a plain left-click with no modifier held — the one case that opens in
 * place. A modified or auxiliary-button click is the browser's own gesture (open in a new
 * tab, save a link): nothing a user could rebind. It reads the modifiers here because this
 * module is where the platform's modifier mapping is allowed to be read.
 */
export function isPlainClick(
  event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "button">,
): boolean {
  return (
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    (event.button === undefined || event.button === 0)
  );
}
