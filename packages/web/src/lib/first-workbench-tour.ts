/** The native tour and the original installed workbench use the same user-and-URL progress key. */
import type { MessagesResponse, ModelRefDto } from "@prismshadow/penguin-server/api";
import { ApiError, apiFetch } from "../api/client";
import { getSession, getWorkbench } from "../api/endpoints";
import { workbenchesBase } from "./workbench-tabs";

import { GUIDE_ID } from "./first-workbench-entry";

export interface GuideProgress {
  key: string;
  model?: ModelRefDto;
  request?: string;
  feedback?: string;
  installed?: boolean;
  verified?: boolean;
  tourSession?: string;
  tourChat?: boolean;
  visitedSettings?: boolean;
}
export type Guide = {
  sessionId: string;
  boardId: string;
  request: string;
  answer?: string;
  error?: string;
  phase: "chatting" | "answered" | "generating" | "ready" | "chat-error" | "design-error";
  design?: { title: string; items: { task: string; group: string; doneWhen: string }[] };
};
export function guideStorage(user: string, pathname: string) {
  return "first-workbench-guide:" + JSON.stringify([user, pathname]);
}
function progressKey(storage: string, kind: "sessionStorage" | "localStorage") {
  return kind === "sessionStorage" ? storage : "penguin.firstWorkbench." + storage;
}
/** Keep identifiers and real milestones across restarts. Conversation text and provider credentials
 * belong to their original stores. The existing window's progress remains a source on upgrade. */
export function loadGuideProgress(storage: string): GuideProgress {
  for (const kind of ["sessionStorage", "localStorage"] as const) {
    try {
      const data = JSON.parse(window[kind].getItem(progressKey(storage, kind)) ?? "null");
      if (typeof data?.key === "string" && /^[0-9a-f]{32}$/.test(data.key)) return data;
    } catch {
      /* Progress can still be kept in memory. */
    }
  }
  return { key: freshGuideKey() };
}
export function persistGuideProgress(storage: string, saved: GuideProgress) {
  try {
    sessionStorage.setItem(storage, JSON.stringify(saved));
  } catch {
    /* Tab storage is optional. */
  }
  const { key, model, tourChat, tourSession, visitedSettings, installed, verified } = saved;
  const modelRef = model && { provider: model.provider, modelId: model.modelId };
  try {
    localStorage.setItem(
      progressKey(storage, "localStorage"),
      JSON.stringify({
        key,
        model: modelRef,
        tourChat,
        tourSession,
        visitedSettings,
        installed,
        verified,
      }),
    );
  } catch {
    /* Continue in this tab if durable storage is unavailable. */
  }
}
export function guideClosed(storage: string): boolean {
  return (["localStorage", "sessionStorage"] as const).some((kind) => {
    try {
      return (
        window[kind].getItem(progressKey(storage, kind) + ".closed") === "true" ||
        JSON.parse(window[kind].getItem(progressKey(storage, kind)) ?? "null")?.verified === true
      );
    } catch {
      return false;
    }
  });
}
export function closeGuide(storage: string) {
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    try {
      window[kind].setItem(progressKey(storage, kind) + ".closed", "true");
    } catch {
      /* Storage is optional. */
    }
  }
}
export function freshGuideKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export function guideLocation(project: string, agent: string, machine: string | null) {
  const base = workbenchesBase(project, agent);
  return {
    base,
    project,
    agent,
    machine,
    pathname:
      (machine === null ? "" : "/server/" + encodeURIComponent(machine)) +
      base +
      "/" +
      GUIDE_ID +
      "/ui/index.html",
  };
}
export type GuideLocation = ReturnType<typeof guideLocation>;
function call<T>(loc: GuideLocation, path: string, body?: unknown) {
  return apiFetch<T>(loc.base + "/" + path, {
    server: loc.machine,
    ...(body === undefined ? {} : { method: "POST", body }),
  });
}
/** Older installed copies can finish a guide they already started. */
export async function supportsConversation(loc: GuideLocation) {
  try {
    return (
      (await call<{ fromConversation: boolean }>(loc, GUIDE_ID + "/api/capabilities"))
        .fromConversation === true
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }
}
export function readGuide(loc: GuideLocation, key: string, body?: unknown) {
  return call<Guide | null>(loc, GUIDE_ID + "/api/guides/" + key, body);
}
/** Send only the visible user/assistant texts, on the correct Agent and client-selected machine. */
export async function conversationForGuide(
  project: string,
  agent: string,
  id: string,
  machine: string | null,
) {
  const { session } = await getSession(id, machine);
  if (
    session.projectId !== project ||
    session.agentId !== agent ||
    session.source !== "user" ||
    session.status !== "idle"
  )
    return null;
  const { messages } = await apiFetch<MessagesResponse>(
    "/api/sessions/" + encodeURIComponent(id) + "/messages?tailLimit=1",
    { server: machine },
  );
  let request = "",
    answer = "";
  for (const msg of messages) {
    if (msg.origin?.length || msg.type !== "model_msg") continue;
    const p = msg.payload;
    if (!("type" in p) || p.type !== "text") continue;
    if (p.role === "user" && !p.sender) {
      request = p.text;
      answer = "";
    }
    if (p.role === "assistant" && request) answer += p.text;
  }
  return request.trim() && answer.trim()
    ? { request, answer, model: { provider: session.provider, modelId: session.modelId } }
    : null;
}
type Board = { id: string; title: string; items: { id: string; task: string; done: boolean }[] };
export async function installGuideBoard(loc: GuideLocation, key: string, guide: Guide) {
  const artifact = await call<{ dataBase64: string }>(
    loc,
    GUIDE_ID + "/api/guides/" + key + "/installation",
  );
  let loaded;
  try {
    const result = await call<{
      workbench: { id: string; error: string | null; tabs: { key: string }[] };
    }>(loc, "archive", artifact);
    loaded = result.workbench;
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 409)) throw error;
    const installed = await getWorkbench(loc.project, loc.agent, guide.boardId, loc.machine);
    loaded =
      installed.enabled !== false &&
      installed.workbenches.find((w) => w.id === guide.boardId && w.enabled !== false);
  }
  if (
    !loaded ||
    loaded.id !== guide.boardId ||
    loaded.error ||
    !loaded.tabs.some((t) => t.key === "main")
  )
    throw Error((loaded && loaded.error) || "The workbench did not load.");
  await checkedBoard(loc, guide);
}
async function checkedBoard(loc: GuideLocation, guide: Guide) {
  const board = await call<Board>(loc, encodeURIComponent(guide.boardId) + "/api/board");
  if (board.id !== guide.boardId || board.title !== guide.design?.title)
    throw Error("The installed workbench does not match the preview.");
  return board;
}
export async function verifyGuideBoard(loc: GuideLocation, guide: Guide, label: string) {
  const id = "test-" + freshGuideKey();
  const send = (op: string, fields: Record<string, unknown> = {}) =>
    call(loc, encodeURIComponent(guide.boardId) + "/api/items", { op, id, ...fields });
  const read = async () => (await checkedBoard(loc, guide)).items.find((i) => i.id === id);
  if (await read()) throw Error("A test item already exists.");
  try {
    await send("add", { task: label, group: label });
    const item = await read();
    if (!item || item.task !== label || item.done)
      throw Error("The new checklist item could not be read.");
    await send("check", { done: true });
    if (!(await read())?.done) throw Error("The checklist item did not change.");
  } finally {
    await send("remove");
  }
  if (await read()) throw Error("The test item was not removed.");
}
