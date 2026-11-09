/** One active main controller: consecutive original hook slices, never a second state owner. */
import { useMainChatInputs } from "./main-chat-inputs";
import { useMainChatRouting } from "./main-chat-routing";
import { useMainChatTranscript } from "./main-chat-transcript";
import { useMainChatLifecycle } from "./main-chat-lifecycle";
import { useMainChatSends } from "./main-chat-sends";
import { useMainChatComposer } from "./main-chat-composer";
import { useMainChatControls } from "./main-chat-controls";
import { useMainChatActions } from "./main-chat-actions";
import { useMainChatDock } from "./main-chat-dock";

export function useChatSession() {
  const scope0 = useMainChatInputs();
  const scope1 = useMainChatRouting(scope0);
  const scope2 = useMainChatTranscript(scope1);
  const scope3 = useMainChatLifecycle(scope2);
  const scope4 = useMainChatSends(scope3);
  const scope5 = useMainChatComposer(scope4);
  const scope6 = useMainChatControls(scope5);
  const scope7 = useMainChatActions(scope6);
  const scope8 = useMainChatDock(scope7);
  return scope8;
}
export type ChatSessionController = ReturnType<typeof useChatSession>;
