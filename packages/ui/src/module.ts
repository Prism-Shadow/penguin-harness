/**
 * The module contract: one section of the gallery, and what a `modules/<id>.module.tsx` exports.
 *
 *   // modules/conversation.module.tsx
 *   export const module = defineModule({
 *     id: "conversation",
 *     title: "Conversation",
 *     description: "The transcript of a Task: bubbles, prose, work groups, a diff and an approval.",
 *     width: "wide",
 *     variants: [{ key: "streaming", title: "Streaming" }, { key: "approval", title: "Approval" }],
 *     parts: ["chat-work-group", "chat-tool-call-card"],
 *     render: (variant, { lang }) => <Transcript variant={variant} f={fixturesFor(lang)} />,
 *   });
 *
 * A module is one realistic composition built from the fixtures, not a list of atoms: the gallery
 * renders exactly fifteen of them, in {@link MODULE_IDS} order, each on its own card with a pill per
 * variant. The atoms still exist — a component's `*.demo.tsx` (demo.ts) — and live in the module's
 * Parts drawer, listed by `parts`.
 *
 * Before a component exists, a module composes static stand-ins (the screens' parts and
 * `modules/parts.tsx`); each wave swaps a stand-in for the component it imitates. The module file
 * is that seam, so its id, variant keys and the addresses built from them stay put while its
 * insides change.
 *
 * Ids and variant keys are addresses: `#conversation`, `?v.conversation=approval`,
 * `/embed?module=conversation&variant=approval`, screenshot file names and quoted feedback all use
 * them. A key is lowercase words joined by `-`, never a `.`.
 */
import type { ReactNode } from "react";
import type { DemoContext } from "./demo";

/** The gallery's sections, in page order: the vocabulary first, the whole screens last. */
export const MODULE_IDS = [
  "foundations",
  "conversation",
  "composer",
  "navigation",
  "actions",
  "status",
  "forms",
  "overlays",
  "tables",
  "stats",
  "content",
  "files",
  "pages",
  "company",
  "screens",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export interface ModuleVariant {
  /** The pick's address: lowercase words joined by `-`. */
  key: string;
  /** English. The gallery's Chinese dictionary translates it. */
  title: string;
  description?: string;
}

export interface Module {
  id: ModuleId;
  /** English. The gallery's Chinese dictionary translates it. */
  title: string;
  /** One sentence on what the composition shows. */
  description: string;
  /**
   * How three themes compare: a `narrow` composition sits in three frames side by side, a `wide`
   * one in three stacked full-width frames (three transcripts at a third of the column are unreadable).
   */
  width: "narrow" | "wide";
  /** At least one; the first is the default pick. */
  variants: readonly ModuleVariant[];
  /** The catalog section ids (catalog.ts) listed in the Parts drawer, in catalog order. */
  parts: readonly string[];
  /** Method syntax on purpose, like `Demo.render`. Unknown variant keys never reach it. */
  render(variant: string, context: DemoContext): ReactNode;
}

/** Identity: a typed home for a module literal. */
export function defineModule(module: Module): Module {
  return module;
}

/**
 * What a variant key names, out of the map a module dispatches on. Every key that reaches
 * `render` comes from the module's own `variants` list — the gallery, `/embed` and `shots.mjs`
 * all pick from it — so a miss is drift between that list and this map. It throws instead of
 * falling back to the first variant, which would draw one composition under another's name, in
 * the card, in the compare frames and in the screenshot named after the key.
 */
export function viewFor<T>(views: Readonly<Record<string, T>>, variant: string): T {
  const view = views[variant];
  if (view === undefined) {
    throw new Error(
      `no view for variant "${variant}" (the map has ${Object.keys(views).join(", ")})`,
    );
  }
  return view;
}
