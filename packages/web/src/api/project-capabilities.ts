import type {
  Capability,
  CapabilitySettings,
  CapabilityResult,
  CapabilityRunRequest,
  CapabilitySettingsPatch,
} from "@prismshadow/penguin-server/api";
import { apiFetch, apiFetchStream } from "./client";

export const capabilities = [
  "image",
  "video",
  "tts",
  "stt",
  "search",
  "fetch",
] as const satisfies readonly Capability[];

export type CapabilityPatch = CapabilitySettingsPatch;

async function read<T>(path: string, options: Parameters<typeof apiFetchStream>[1]): Promise<T> {
  const response = await apiFetchStream(path, options);
  return (await response.json()) as T;
}

const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
export function getCapabilities(projectId: string, server: string | null, signal: AbortSignal) {
  return read<CapabilitySettings>(`${projectPath(projectId)}/capabilities`, { server, signal });
}
export function updateCapabilities(
  projectId: string,
  body: CapabilityPatch,
  server: string | null = null,
) {
  return apiFetch<CapabilitySettings>(`${projectPath(projectId)}/capabilities`, {
    method: "PATCH",
    body,
    server,
  });
}
export async function runVoice(
  projectId: string,
  server: string | null,
  capability: "tts" | "stt",
  body: CapabilityRunRequest,
  signal: AbortSignal,
) {
  const result = await read<CapabilityResult>(
    `${projectPath(projectId)}/capabilities/${capability}/run`,
    {
      method: "POST",
      body,
      signal,
      server,
    },
  );
  if (result.error) throw new Error(result.error);
  return result;
}
export function polishVoice(
  projectId: string,
  server: string | null,
  text: string,
  sessionId: string | undefined,
  signal: AbortSignal,
) {
  return read<{ text: string }>(`${projectPath(projectId)}/voice-polish`, {
    method: "POST",
    body: { text, sessionId },
    signal,
    server,
  });
}
