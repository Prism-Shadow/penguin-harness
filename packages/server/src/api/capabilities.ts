import type { ModelRefDto } from "./types.js";

export type Capability = "search" | "fetch" | "image" | "video" | "tts" | "stt";
/** An active server plugin contributing one operation to this Project. */
export interface AvailableCapability {
  key: Capability;
  title: { en: string; zh: string };
  package: string;
}
export interface CapabilitySettings {
  available: AvailableCapability[];
  bindings: Partial<Record<Capability, ModelRefDto>>;
  candidates: Record<Capability | "chat", ModelRefDto[]>;
  voicePolish: { enabled: boolean; model: ModelRefDto | null };
}
export interface CapabilitySettingsPatch {
  bindings?: Partial<Record<Capability, ModelRefDto | null>>;
  voicePolish?: { enabled?: boolean; model?: ModelRefDto | null };
}
export interface CapabilityRunRequest {
  text?: string;
  url?: string;
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
export interface CapabilityUsage {
  cached_tokens: number | null;
  prompt_tokens: number | null;
  thoughts_tokens: number | null;
  response_tokens: number | null;
}
export interface CapabilityResult {
  id: string;
  capability: Capability | "voice-polish";
  status: "running" | "completed" | "failed" | "cancelled";
  model: ModelRefDto;
  sessionId?: string;
  createdAt: string;
  text?: string;
  sources?: { title: string; url: string; content: string }[];
  artifacts: CapabilityArtifact[];
  usage: CapabilityUsage | null;
  measurements: { unit: string; quantity: number }[];
  error?: string;
}
