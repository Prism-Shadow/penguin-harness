/**
 * Which machine the Plugins page views: the one picked in its header while the picker still
 * offers it, this server otherwise. A picked machine can leave the choices (the last session
 * on it ends, its table entry is removed) — and with a single choice left the picker is
 * hidden, so a pick that outlived its machine would hold the page on it with no way back.
 * Derived on every render rather than reset in an effect, so it never renders the stale pick.
 */
export function viewedMachine(
  picked: string | null,
  choices: readonly string[],
  selfId: string | undefined,
): string | undefined {
  return picked !== null && choices.includes(picked) ? picked : selfId;
}
