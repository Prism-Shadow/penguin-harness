/**
 * Where the full-page workbench's exit ball rests and whether it is tucked away: one browser
 * preference, shared by every full-page workbench and never carried to the account
 * (lib/install-scope.ts registers the key as this browser's). The value is one JSON object,
 * `{"side":"right","ratio":1,"tucked":false}`; what a placement means and how the ball moves is
 * the UI package's `FloatingBall`. Reading falls back to the corner on anything unusable, and
 * neither reading nor writing ever throws: blocked or full storage only costs persistence.
 */
import { coerceFloatingBallPlacement, type FloatingBallPlacement } from "@prismshadow/penguin-ui";

export const EXIT_BALL_KEY = "penguin.workbench.exitBall";

/** The bottom-right corner, where the text button used to be. */
export const DEFAULT_EXIT_BALL: FloatingBallPlacement = { side: "right", ratio: 1, tucked: false };

/** The storage the ball reads and writes — localStorage, or a stub in tests. */
export type ExitBallStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): ExitBallStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // the accessor itself throws where site data is blocked
  }
}

/** Stored text read back as a placement; null for anything that is not one. */
export function parseExitBall(raw: string | null | undefined): FloatingBallPlacement | null {
  if (raw === null || raw === undefined) return null;
  try {
    return coerceFloatingBallPlacement(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The stored placement, or the corner when nothing usable is stored. */
export function readExitBall(
  storage: ExitBallStorage | null = defaultStorage(),
): FloatingBallPlacement {
  try {
    return parseExitBall(storage?.getItem(EXIT_BALL_KEY)) ?? DEFAULT_EXIT_BALL;
  } catch {
    return DEFAULT_EXIT_BALL;
  }
}

export function writeExitBall(
  placement: FloatingBallPlacement,
  storage: ExitBallStorage | null = defaultStorage(),
): void {
  const { side, ratio, tucked } = placement;
  try {
    storage?.setItem(EXIT_BALL_KEY, JSON.stringify({ side, ratio, tucked }));
  } catch {
    // Private-mode or full storage only costs persistence; this page still follows the ball.
  }
}
