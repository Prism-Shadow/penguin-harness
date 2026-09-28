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
 * renders exactly the ids in {@link MODULE_IDS}, each on its own page (`/c/<id>`) with a section
 * per variant. The atoms still exist — a component's `*.demo.tsx` (demo.ts) — and live in the
 * page's Parts section, listed by `parts`.
 *
 * Before a component exists, a module composes static stand-ins (the screens' parts and
 * `modules/parts.tsx`); each wave swaps a stand-in for the component it imitates. The module file
 * is that seam, so its id, variant keys and the addresses built from them stay put while its
 * insides change.
 *
 * Ids and variant keys are addresses: `/c/conversation#approval`,
 * `/embed?module=conversation&variant=approval`, screenshot file names and quoted feedback all use
 * them. A key is lowercase words joined by `-`, never a `.`.
 *
 * A variant is one moment of the interface, and is one of three kinds ({@link VariantKind}):
 *
 * - `animated` — a running process worth watching (a reply streaming, a run finishing, numbers
 *   counting up). It carries a `scene`: the ordered frames that lead up to that moment, played
 *   once on the gallery's clock when the reader presses play. A scene's last frame renders exactly
 *   what the variant renders without a clock: the page shows that settled state until play is
 *   pressed, and after the scene has run. A frame is a state of the composition, not a keyframe:
 *   `render` reads the clock (`useScene()` and friends, scene.tsx) and draws the state the current
 *   frame names, and the theme's CSS animates the change from one frame to the next through the
 *   motion hooks the markup carries (`data-presence`, `data-reveal`, `data-layout-motion`). So a
 *   scene never writes a duration or an easing — the same frames move differently in each theme,
 *   and not at all under reduced motion. Frame keys are addresses too (`/embed?…&frame=rail`,
 *   `<module>--<variant>@<frame>.png`) and stay put while the frames' insides change; every frame
 *   must also read well as a still, since screenshots are taken paused on each one.
 * - `interactive` — the reader drives it: the composition holds its own state and answers real
 *   clicks and typing (a sidebar that collapses, a composer that takes a prompt, a menu that
 *   opens). It carries no scene; the page offers one "Reset", which remounts it. Its first render
 *   is its settled picture, which is what `/embed` and the screenshots take.
 * - `static` — a still.
 *
 * `kind` may be left out: a variant with a scene reads as `animated`, one without as `static`.
 * A module's first (default) variant is never static.
 */
import type { ReactNode } from "react";
import type { DemoContext } from "./demo";

/** The gallery's modules, in index order: the hero, then the vocabulary, then whole screens. */
export const MODULE_IDS = [
  "hero",
  "foundations",
  "conversation",
  "composer",
  "navigation",
  "actions",
  "status",
  "forms",
  "overlays",
  "dialogs",
  "tables",
  "stats",
  "content",
  "files",
  "create-with-ai",
  "empty-states",
  "pages",
  "company",
  "screens",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

/** One state of a scene. */
export interface SceneFrame {
  /** Address: lowercase words joined by `-`, unique within the scene. */
  key: string;
  /** English. The gallery's Chinese dictionary translates it. */
  title: string;
  /** How long the frame holds at 1× before the next one, in ms. */
  hold: number;
}

export interface SceneSpec {
  /**
   * At least two, in play order. The last frame is the settled state — what the variant renders
   * without a clock — and the scene stops there; nothing loops.
   */
  frames: readonly SceneFrame[];
}

/** How a variant behaves on its page; see the file comment. */
export const VARIANT_KINDS = ["static", "animated", "interactive"] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];

export interface ModuleVariant {
  /** The pick's address: lowercase words joined by `-`. */
  key: string;
  /** English. The gallery's Chinese dictionary translates it. */
  title: string;
  description?: string;
  /**
   * `animated`, `interactive` or `static`. Left out, a variant with a scene is `animated` and one
   * without is `static`. An `interactive` variant carries no scene; an `animated` one must.
   */
  kind?: VariantKind;
  /**
   * The frames that lead up to this variant's state, played once when the reader asks. Required on
   * an `animated` variant, absent on the other kinds.
   */
  scene?: SceneSpec;
}

/**
 * The app window the window compositions are laid out at: a common laptop viewport, and the
 * narrowest one where the app shows its full sidebar (`lg:w-72`) beside a roomy chat column.
 */
export const APP_WINDOW_WIDTH = 1280;

/**
 * The main column of that window: the window less the 18rem sidebar at the default 18 px root.
 * Pages, the transcript and the composer live in this column in the app, so they lay out at it.
 */
export const APP_COLUMN_WIDTH = APP_WINDOW_WIDTH - 18 * 18;

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
  /**
   * The width in CSS px the composition is designed at, when it imitates a region of the app at
   * the app's own size: {@link APP_WINDOW_WIDTH} for a whole window (sidebar and main column),
   * {@link APP_COLUMN_WIDTH} for what fills the main column (a page, the transcript, the
   * composer). The gallery lays such a composition out at exactly this width and scales the
   * result down to its card — never up — so it wraps, truncates and breaks at its container
   * queries as it does in the app, however narrow the card. `/embed` and the screenshots render
   * it at this width unscaled; the phone view ignores it, since there the composition answers to
   * the 390 px frame.
   *
   * Omitted, the composition reflows to whatever width it is given, which is right for the
   * vocabulary modules (buttons, fields, a dialog on its stage, a table) and for every `narrow`
   * one, which keeps its own width.
   */
  viewport?: number;
  /** At least one; the first is the default pick. */
  variants: readonly ModuleVariant[];
  /** The catalog section ids (catalog.ts) listed in the page's Parts section, in catalog order. */
  parts: readonly string[];
  /** Method syntax on purpose, like `Demo.render`. Unknown variant keys never reach it. */
  render(variant: string, context: DemoContext): ReactNode;
}

/** Identity: a typed home for a module literal. */
export function defineModule(module: Module): Module {
  return module;
}
