/**
 * The Project and Agent the user last had open, as this browser remembers them. Read by the
 * Project store to restore the selection, and by the boot prefetch (boot-prefetch.ts) to ask for
 * that Agent's list before the store even exists — which is why the keys live here and not in the
 * store module: the store consumes the prefetch, so the prefetch cannot import the store.
 *
 * Every read is guarded: touching `localStorage` throws when site data is blocked, and a boot
 * that cannot remember is still a boot.
 */
const PROJECT_KEY = "penguin.lastProjectId";
const agentKey = (projectId: string) => `penguin.lastAgentId.${projectId}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function rememberedProjectId(): string | null {
  return read(PROJECT_KEY);
}

export function rememberProjectId(projectId: string): void {
  localStorage.setItem(PROJECT_KEY, projectId);
}

export function rememberedAgentId(projectId: string): string | null {
  return read(agentKey(projectId));
}

export function rememberAgentId(projectId: string, agentId: string): void {
  localStorage.setItem(agentKey(projectId), agentId);
}
