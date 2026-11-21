/**
 * The shapes of the model-tool routes the Web App calls (their wrappers are in endpoints.ts):
 *
 * - the platform's tool-model bindings, `GET|PATCH /api/projects/:p/models/tool-bindings` —
 *   any plugin may declare one, so a binding is read by its key and its declaring package;
 * - the `@penguinharness/multimodal-tools` plugin's own routes under
 *   `/api/projects/:p/multimodal-tools` — dictation, transcript editing and read-aloud.
 *
 * The plugin is not a dependency of the Web App, so its answers are described here, field for
 * field as the plugin sends them.
 */
import type { ModelRefDto } from "@prismshadow/penguin-server/api";

/** The plugin package whose routes and bindings dictation and read-aloud use. */
export const MULTIMODAL_TOOLS_PACKAGE = "@penguinharness/multimodal-tools";

/** One binding: a plugin's declaration joined with the Project's `[tools]` entry. */
export interface ToolBinding {
  /** The `[tools]` key the plugin declared. */
  key: string;
  /** Its name, per language. */
  title: { en: string; zh: string };
  /** The plugin package that declares it. */
  package: string;
  /** The bound model; absent when none is, or the one bound is no longer configured. */
  model?: ModelRefDto;
  /** The configured models the binding accepts, in the models table's order. */
  candidates: ModelRefDto[];
}

export interface ToolBindingsResponse {
  bindings: ToolBinding[];
}

/** Binds one key, or with `model: null` unbinds it. */
export interface ToolBindingUpdate {
  key: string;
  model: ModelRefDto | null;
}

/** A file handed to a tool: base64 bytes and their type. */
export interface ToolFile {
  data: string;
  mimeType: string;
}

/** `POST …/multimodal-tools/:operation/run`. */
export interface ToolRunRequest {
  text?: string;
  audio?: ToolFile;
  image?: ToolFile;
  /** The Session the run belongs to (and is billed to). */
  sessionId?: string;
}

/** One run as the plugin answers it. */
export interface ToolRun {
  id: string;
  operation: string;
  model: ModelRefDto;
  sessionId?: string;
  createdAt: string;
  status: "running" | "completed" | "failed" | "cancelled";
  /** The model's text: the transcript, for speech recognition. */
  text?: string;
  files: { name: string; mimeType: string; bytes: number; url?: string }[];
  error?: string;
}

/** Transcript editing ("voice polish") in a Project. */
export interface VoicePolishSettings {
  enabled: boolean;
  prompt: string;
  defaultPrompt: string;
  /** The text-generation model editing runs on; absent when none is bound. */
  model?: ModelRefDto;
}

/** `PATCH …/voice-polish/settings` (owner): `prompt: null` restores the default. */
export interface VoicePolishUpdate {
  enabled?: boolean;
  prompt?: string | null;
}

/** A reply's audio, read aloud and kept in its Session. */
export interface SpokenReply {
  name: string;
  mimeType: string;
  bytes: number;
  /** Where a signed-in member plays it (an `/api/…` path of the server that answered). */
  url: string;
  model: ModelRefDto;
}
