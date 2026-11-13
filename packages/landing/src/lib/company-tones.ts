/**
 * The two colours of the /company page, in one place so the player, the lifecycle chart and their
 * legends read alike: amber where a ticket waits on the person (the Web App's attention tone, the
 * one /amsp gives `event_msg`), the site's blue where an agent has it. What is settled is neutral
 * gray. The classes are lib/amsp-tones.ts's, so the two pages keep one set of tints.
 */
import { TONES } from "./amsp-tones";
import type { FamilyTone } from "./amsp-tones";

export const COMPANY_TONES: Record<"waiting" | "working" | "settled", FamilyTone> = {
  waiting: TONES.event,
  working: TONES.model,
  settled: TONES.session,
};
