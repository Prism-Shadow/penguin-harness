/**
 * The "Create with AI" kit: the bridge into a new conversation with the Project's default agent,
 * the prompt panel with its examples and full-prompt preview, the dialog around it, and the
 * split create button that offers the AI path next to the manual form.
 */
export { aiChatRouteState, buildAiDraft, useAiBridge } from "./ai-bridge";
export type { AiChatRequest, AiChatRouteState } from "./ai-bridge";
export { DEFAULT_AGENT_ID, pickDefaultAgent } from "./default-agent";
export { composeAiPrompt } from "./ai-create-prompt";
export { AiCreatePanel } from "./ai-create-panel";
export type { AiCreatePanelProps, AiExample } from "./ai-create-panel";
export { AiCreateModal } from "./ai-create-modal";
export type { AiCreateModalProps, PrimaryExit } from "./ai-create-modal";
export { AiCreateButton, AiWandButton, CreateMenuButton } from "./create-menu-button";
export type { CreateAction, CreateMenuButtonProps } from "./create-menu-button";
