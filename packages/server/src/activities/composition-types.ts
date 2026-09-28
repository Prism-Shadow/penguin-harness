/**
 * What the App sees of a scene composition (see composition.ts): the run's record, its
 * candidate and the experiment's setup. Type-only, so the web type graph never pulls in the
 * server module.
 */

/** Why a composition was not kept; the App words each one. */
export type CompositionProblemCode =
  /** The page loads, or points at, something on the network. */
  | "composition_network"
  /** The page refers to a file that was not staged for it. */
  | "composition_reference"
  /** No paused GSAP timeline is exposed as `window.__composition.timeline`. */
  | "composition_timeline"
  /** The page dropped the template's content policy or its Penguin bridge script. */
  | "composition_template"
  /** The page uses randomness, so two recordings would differ. */
  | "composition_random"
  /** The page is larger than 512 KB. */
  | "composition_size"
  /** frames.json is missing, not JSON, or does not describe the frames. */
  | "composition_frames";

/** One storyboard frame, as the agent described it in frames.json. */
export interface CompositionFrame {
  id: string;
  description: string;
  seconds: number;
}

/** A scene image staged for the composition, and the hash it was staged with. */
export interface CompositionImage {
  key: string;
  /** Where the page finds it: `images/<file>`. */
  file: string;
  sha256: string;
}

/** A composition run's target, recorded when it started. */
export interface CompositionTarget {
  language: string;
  /** The video or animation asset the composition is for. */
  assetKey: string;
  sceneId: string;
  width: number;
  height: number;
  images: CompositionImage[];
  /** Set when the run failed a check of what the agent wrote. */
  problem?: CompositionProblemCode;
}

/** A kept composition: its frames, its length, and the page's hash and size. */
export interface CompositionCandidate {
  frames: CompositionFrame[];
  seconds: number;
  sha256: string;
  bytes: number;
}

/** `GET /video-setup`: whether the scene-video experiment is on for this server. */
export interface VideoSetup {
  enabled: boolean;
}
