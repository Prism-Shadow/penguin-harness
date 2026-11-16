/**
 * The pet's conversation partner: a Penguin Platform Agent of its own, not the Project's
 * General Agent.
 *
 * The Agent is created on first use and then kept — its AGENTS.md is the platform assistant's
 * brief (how to read the screen, what it must never touch) and is written once, when the
 * Agent is created, so a later edit a person makes on the Agent page is not overwritten by
 * opening the chat again. The Session is one per Project, remembered in localStorage and
 * recreated when it is gone; the chat window therefore always has a conversation to open,
 * even the very first time.
 */
import { ApiError } from "../../api/client";
import * as api from "../../api/endpoints";

/** The Agent's id: fixed, so every Project has at most one platform assistant. */
export const PLATFORM_AGENT_ID = "penguin_platform";

const AGENT_NAME = "Penguin Platform Agent";

const AGENT_DESCRIPTION =
  "The in-app assistant behind the pet's chat: reads the screen the person is using and answers how to use it.";

/**
 * What the platform assistant is told about its one special surface. The commands are the
 * pet plugin's (`penguin pet ui …`), which the Agent's own shell reaches through the
 * server's CLI shim — no extra tool installation, no credentials in the prompt.
 */
const AGENTS_MD = `# Penguin Platform Agent

你是 Penguin 平台助手：住在 PenguinHarness 网页应用里、宠物旁边聊天窗里的那只助手，专门帮用户使用这个软件。

## 语气
- 用用户的语言回答（默认中文），简短、具体；先看一眼界面再回答，不要凭记忆猜。

## 你能看到的界面
你的 shell 里有一条通往用户当前页面的通道：

- \`penguin pet ui state\` — 打印当前页面状态：路由、标题、对话框、可点的控件（带 xpath）、可见文字。
- \`penguin pet ui shot\` — 截一张当前页面的 PNG，存到工作区并打印路径；可以用文件工具读那张图。
- \`penguin pet ui element <xpath>\` — 读某个元素的详情。
- \`penguin pet ui pick\` — 请用户点一个元素，返回 xpath 与 link。
- \`penguin pet ui pages\` — 列出已连接的页面。

用户会在聊天里发来 \`[ui-pick]\` 消息：那是他刚选中的元素，消息里有 xpath 和 link；需要更多细节时用 \`penguin pet ui element\`。

## 边界
- 密码框永远读不到：不要尝试读密码，也不要让用户把密码贴进聊天。
- 你只能读界面：不要执行会改变用户数据的操作（不要点按钮、不要提交表单）。
- 命令报 \`no_page\` 时，说明页面没连上，请用户把应用窗口开着再问。
`;

export interface PlatformChat {
  agentId: string;
  sessionId: string;
}

const sessionKey = (projectId: string): string => `penguin.petChat.session.${projectId}`;

/** One ensure per Project at a time: a double click opens one Agent and one Session. */
const inflight = new Map<string, Promise<PlatformChat>>();

/** The Project's platform assistant and the conversation the chat window shows. */
export function ensurePlatformChat(projectId: string): Promise<PlatformChat> {
  const running = inflight.get(projectId);
  if (running !== undefined) return running;
  const promise = createOrLoad(projectId).finally(() => {
    inflight.delete(projectId);
  });
  inflight.set(projectId, promise);
  return promise;
}

async function createOrLoad(projectId: string): Promise<PlatformChat> {
  const agents = await api.listAgents(projectId, null);
  const present = agents.agents.some((agent) => agent.agentId === PLATFORM_AGENT_ID);
  if (!present) {
    let created = false;
    try {
      await api.createAgent(
        projectId,
        {
          agentId: PLATFORM_AGENT_ID,
          name: AGENT_NAME,
          description: AGENT_DESCRIPTION,
        },
        null,
      );
      created = true;
    } catch (err) {
      // Another tab got there first: the Agent exists, which is all this needs.
      if (!(err instanceof ApiError && err.status === 409)) throw err;
    }
    if (created) {
      await api.putAgentConfig(projectId, PLATFORM_AGENT_ID, { agentsMd: AGENTS_MD }, null);
    }
  }
  const stored = readStored(projectId);
  if (stored !== null) {
    try {
      const { session } = await api.getSession(stored, null);
      if (session.projectId === projectId && session.agentId === PLATFORM_AGENT_ID) {
        return { agentId: PLATFORM_AGENT_ID, sessionId: stored };
      }
    } catch {
      // The Session was deleted or belongs to another server now: make a fresh one below.
    }
  }
  const created = await api.createSession(projectId, PLATFORM_AGENT_ID, {}, null);
  const sessionId = created.session.sessionId;
  rememberPlatformSession(projectId, sessionId);
  return { agentId: PLATFORM_AGENT_ID, sessionId };
}

/**
 * Remembers which of the assistant's conversations the window shows, so the next open resumes
 * it — the one the chat window switched to included, not only the one this module just made.
 */
export function rememberPlatformSession(projectId: string, sessionId: string): void {
  try {
    localStorage.setItem(sessionKey(projectId), sessionId);
  } catch {
    // A private-mode storage refusal costs only the memory of this conversation.
  }
}

function readStored(projectId: string): string | null {
  try {
    const value = localStorage.getItem(sessionKey(projectId));
    return value === null || value === "" ? null : value;
  } catch {
    return null;
  }
}

/** What a picked element looks like as the user message the session receives. */
export function pickMessage(picked: {
  xpath: string;
  link: string;
  tag: string;
  role: string;
  name: string;
  text?: string;
}): string {
  const lines = [
    "[ui-pick] 用户选中了一个界面元素",
    `xpath: ${picked.xpath}`,
    `link: ${picked.link}`,
    `tag: ${picked.tag}${picked.role === "" ? "" : ` role: ${picked.role}`}${
      picked.name === "" ? "" : ` name: ${JSON.stringify(picked.name)}`
    }`,
  ];
  if (picked.text !== undefined && picked.text !== "") lines.push(`text: ${picked.text}`);
  return lines.join("\n");
}
