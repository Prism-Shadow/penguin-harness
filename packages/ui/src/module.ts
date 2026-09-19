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
 *
 * A variant is static (one moment of the interface) or live: a live variant carries a `scene`, an
 * ordered list of frames the gallery plays on a clock, looping, and a live variant comes after the
 * module's static ones. A frame is a state of the composition, not a keyframe: `render` reads the
 * clock (`useScene()` and friends, scene.tsx) and draws the state the current frame names, and the
 * theme's CSS animates the change from one frame to the next through the motion hooks the markup
 * carries (`data-presence`, `data-reveal`, `data-layout-motion`). So a scene never writes a
 * duration or an easing — the same frames move differently in each theme, and not at all under
 * reduced motion. Frame keys are addresses too (`/embed?…&frame=rail`,
 * `<module>--<variant>@<frame>.png`) and stay put while the frames' insides change; every frame
 * must also read well as a still, since screenshots are taken paused on each one.
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

/** One state of a live variant. */
export interface SceneFrame {
  /** Address: lowercase words joined by `-`, unique within the scene. */
  key: string;
  /** English. The gallery's Chinese dictionary translates it. */
  title: string;
  /** How long the frame holds at 1× before the next one, in ms. */
  hold: number;
}

export interface SceneSpec {
  /** At least two, in play order; the last one loops back to the first. */
  frames: readonly SceneFrame[];
}

export interface ModuleVariant {
  /** The pick's address: lowercase words joined by `-`. */
  key: string;
  /** English. The gallery's Chinese dictionary translates it. */
  title: string;
  description?: string;
  /** Present: a live variant, played frame by frame on the gallery's clock. */
  scene?: SceneSpec;
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
