/**
 * The colours of AMSP's families on the /amsp page, in one place so the player, the message chart
 * and the record reference read alike: `event_msg` in the amber the Web App's Trace view gives it
 * (its attention tone), `model_msg` in the site's blue, `session_meta` and the control frames in
 * neutral gray. A record the Trace stores sits on a light tint of its family; a `partial_*`
 * fragment, live only, carries the family's ink with no ground. Each surface that uses colour
 * shows the legend that says so.
 */
import type { StepLine } from "./amsp-replay";

export type Family = "model" | "event" | "session" | "frame";

export interface FamilyTone {
  /** The kind name of a stored record. */
  ink: string;
  /** The envelope label, and a fragment's kind name: the same hue, lighter. */
  soft: string;
  /** A stored record's row ground, and the lightest bar tint. */
  ground: string;
  /** A deeper tint, for bars nested inside a lighter one. */
  fill: string;
}

export const TONES: Record<Family, FamilyTone> = {
  model: {
    ink: "text-brand-700 dark:text-brand-300",
    soft: "text-brand-500 dark:text-brand-400",
    ground: "bg-brand-50 dark:bg-brand-400/10",
    fill: "bg-brand-100 dark:bg-brand-400/25",
  },
  event: {
    ink: "text-amber-700 dark:text-amber-300",
    soft: "text-amber-600 dark:text-amber-400",
    ground: "bg-amber-50 dark:bg-amber-400/[0.07]",
    fill: "bg-amber-100 dark:bg-amber-400/15",
  },
  session: {
    ink: "text-gray-900 dark:text-gray-100",
    soft: "text-gray-600 dark:text-gray-300",
    ground: "bg-gray-100 dark:bg-gray-800",
    fill: "bg-gray-200 dark:bg-gray-700",
  },
  frame: {
    ink: "text-gray-600 dark:text-gray-300",
    soft: "text-gray-400 dark:text-gray-500",
    ground: "",
    fill: "",
  },
};

/** The family of an envelope `type` (anything else on the wire is a frame, a request or `data`). */
export function familyOf(envelope: string): Family {
  if (envelope === "model_msg") return "model";
  if (envelope === "event_msg") return "event";
  if (envelope === "session_meta") return "session";
  return "frame";
}

/** A stream row's family. */
export const lineFamily = (line: StepLine): Family =>
  line.kind === "record" ? familyOf(line.head) : "frame";
