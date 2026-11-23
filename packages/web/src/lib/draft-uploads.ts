/** Files and pasted images stay in this window. Only the text/options of a parked draft go to disk. */
export interface DraftUploads {
  images: string[];
  files: { name: string; size: number; dataUrl: string }[];
}

const uploads = new Map<string, DraftUploads>();
const uploadKey = (user: string, project: string, id?: string) =>
  JSON.stringify([user, project, id ?? "new"]);

export function draftUploads(user: string, project: string, id?: string): DraftUploads {
  const key = uploadKey(user, project, id);
  let value = uploads.get(key);
  if (!value) {
    value = { images: [], files: [] };
    uploads.set(key, value);
  }
  return value;
}

export function hasDraftUploads(user: string, project: string): boolean {
  const value = uploads.get(uploadKey(user, project));
  return !!value && (value.files.length > 0 || value.images.length > 0);
}

export function forgetDraftUploads(user: string, project: string, id?: string): void {
  uploads.delete(uploadKey(user, project, id));
}

export function parkDraftUploads(user: string, project: string, id: string): void {
  const key = uploadKey(user, project);
  const value = uploads.get(key);
  if (value) {
    uploads.set(uploadKey(user, project, id), value);
    uploads.delete(key);
  }
}

export function clearDraftUploads(): void {
  uploads.clear();
}
