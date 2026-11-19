import type { ModelRefDto } from "./types.js";

import type { ModelOperation, ToolModelKey } from "@prismshadow/penguin-core";
export type { ModelOperation };
export type Capability = Exclude<ModelOperation, "t2t" | "i2t">;
export type { ToolModelKey };
export interface ToolModelSettings {
  available: (Omit<AvailableCapability, "key"> & { key: ToolModelKey })[];
  bindings: Partial<Record<ToolModelKey, ModelRefDto>>;
  candidates: Record<ToolModelKey, ModelRefDto[]>;
  dictationFormat?: "audio/wav";
  voicePolish: { enabled: boolean; prompt: string; defaultPrompt: string };
}
export interface ToolModelSettingsPatch {
  bindings?: Partial<Record<ToolModelKey, ModelRefDto | null>>;
  voicePolish?: { enabled?: boolean; prompt?: string | null };
}

/** An active server plugin contributing one operation to this Project. */
export interface AvailableCapability<Op extends ModelOperation = Capability> {
  key: Op;
  title: { en: string; zh: string };
  package: string;
}
export interface CapabilitySettings<Op extends ModelOperation = Capability> {
  available: AvailableCapability<Op>[];
  bindings: Partial<Record<Op, ModelRefDto>>;
  candidates: Record<Op | "chat", ModelRefDto[]>;
  /** Absent when the selected transcription model accepts the browser's native recording. */
  dictationFormat?: "audio/wav";
  voicePolish: { enabled: boolean; model: ModelRefDto | null; prompt?: string };
}
export type { CapabilitySettingsPatch } from "@prismshadow/penguin-library-project";
export interface CapabilityRunRequest {
  text?: string;
  url?: string;
  image?: { data: string; mimeType: string };
  audio?: { data: string; mimeType: string };
  sessionId?: string;
  count?: number;
  voice?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  async?: boolean;
}
export interface CapabilityArtifact {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  bytes: number;
  sessionId?: string;
}
/** How the adapter measured the request input. MMSP also represents non-token units in prompt_tokens. */
export interface CapabilityInputMeter {
  unit: "token" | "billable_request" | "billed_audio_second" | "billed_character" | "utf8_byte";
  quantity: number;
}
export interface CapabilityUsage {
  cached_tokens: number | null;
  prompt_tokens: number | null;
  thoughts_tokens: number | null;
  response_tokens: number | null;
}
export interface CapabilityResult {
  id: string;
  capability: ModelOperation | "voice-polish";
  status: "running" | "completed" | "failed" | "cancelled";
  model: ModelRefDto;
  sessionId?: string;
  createdAt: string;
  text?: string;
  sources?: { title: string; url: string; content: string }[];
  artifacts: CapabilityArtifact[];
  /** The original MMSP stop or error buckets, including nulls for unreported counts. */
  usage: CapabilityUsage | null;
  /** Absent for historical runs and when the adapter does not identify its input unit. */
  inputMeter?: CapabilityInputMeter;
  measurements: { unit: string; quantity: number }[];
  /** Whether this run reached the provider transport. Older runs may have no observation. */
  providerAttempted?: boolean;
  error?: string;
}

/** Only the invoking terminal handles local file paths. The server parses and runs the argv. */
export type CapabilityCliReply =
  | { kind: "message"; stdout: string; stderr: string; exitCode: number }
  | { kind: "audio"; mimeType?: string }
  | { kind: "image"; mimeType?: string }
  | { kind: "data"; data: unknown; json: boolean }
  | { kind: "status"; result: CapabilityResult; save: boolean; json: boolean }
  | { kind: "run"; result: CapabilityResult; detached: boolean; save: boolean; json: boolean };
