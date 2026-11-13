/**
 * The cleanliness budget (the theme rules R2–R4), measured: on five app surfaces, no built-in
 * pack draws more than Frost, the base, draws on the same surface — no box around an element Frost
 * does not box (a control's edge and a floating layer aside), no text on a texture where Frost has
 * none, and at most one line colour more. Frost is read in the same run as each pack, never
 * stored, so the budget moves with Frost.
 *
 * The packs are the registry's (`BUILTIN_PACKS`), so a pack is held the day it is registered. Each
 * surface opens in the app frame at 1280 × 800, light, English, under a fixed clock and reduced
 * motion; what is counted, and what is exempt, is scripts/cleanliness.mjs.
 *
 * - Given a surface, each pack's reading stays within Frost's on that surface, plus what the pack
 *   holds below.
 */
import { expect, test } from "@playwright/test";
import { BUILTIN_PACKS } from "../../ui/src/themes/index.ts";
import {
  BASE_PACK,
  BUDGET_SURFACES,
  budgetBreaches,
  prepareContext,
  readSurface,
} from "../scripts/cleanliness.mjs";

/**
 * What Primer drew past Frost when the guard came in (2026-11-10): a box around the work group,
 * finished or running, which Frost leaves lineless, and a box around a notice, which Frost leaves
 * unboxed — Primer's own look, kept so far. The product owner has yet to decide whether
 * Primer keeps them; until then it holds exactly these and no more, and every other pack, Doodle
 * included, holds none.
 */
const HELD = {
  github: {
    chat: { nonControl: 1 },
    "chat-running": { nonControl: 1 },
    usage: { nonControl: 1 },
  },
};

const PACKS = BUILTIN_PACKS.filter((pack) => pack.id !== BASE_PACK.id);

test.describe.configure({ mode: "parallel" });

for (const surface of BUDGET_SURFACES) {
  test(`${surface}: no pack draws more than Frost`, async ({ browser, baseURL }) => {
    // One app load per pack on a cold dev server: room for the first compile.
    test.setTimeout(60_000 + PACKS.length * 30_000);
    const { context, page } = await prepareContext(browser);
    try {
      const base = await readSurface(page, baseURL, surface, BASE_PACK.id);
      const over = [];
      for (const pack of PACKS) {
        const reading = await readSurface(page, baseURL, surface, pack.id);
        for (const b of budgetBreaches(reading, base, HELD[pack.id]?.[surface])) {
          over.push(`${pack.id} ${b.metric} ${b.measured} > ${b.budget}: ${b.what.join("; ")}`);
        }
      }
      expect(over, `${surface} over Frost's budget:\n  ${over.join("\n  ")}`).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
