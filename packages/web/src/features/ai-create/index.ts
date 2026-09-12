/**
 * The "Create with AI" kit: the bridge into a new conversation with the Project's default agent,
 * the prompt panel with its examples and full-prompt preview, the dialog around it, and the pair
 * of buttons — "Create with AI" beside "Create manually" — that opens either path.
 */
export { aiChatRouteState, buildAiDraft, useAiBridge } from "./ai-bridge";
export type { AiChatRequest, AiChatRouteState } from "./ai-bridge";
export { DEFAULT_AGENT_ID, pickDefaultAgent } from "./default-agent";
export { composeAiPrompt } from "./ai-create-prompt";
export { AiCreatePanel, PromptFold } from "./ai-create-panel";
export type { AiCreatePanelProps, AiExample } from "./ai-create-panel";
export { AiCreateModal } from "./ai-create-modal";
export type { AiCreateModalProps } from "./ai-create-modal";
export { CreateButtons } from "./create-buttons";
export type { CreateButtonsProps } from "./create-buttons";
