/**
 * The bare page the pet's chat window frames: the app's own chat page, without the shell.
 *
 * A bare route gets only the signed-in check (see router.tsx), so this page puts back the
 * providers the shell would have supplied — Project, machines, the session list, and every
 * contributed session provider — and then renders the chat module's own page component. That
 * component is the wrapped one from the page table, not the raw `ChatPage`, because the chat
 * module binds its dependencies around it (its contributed tabs and file renderers); rendering
 * the raw component would fail its first `useDeps()`.
 *
 * The page exists so the window can frame a conversation without framing the entire app: the
 * frame keeps the chat page's own navigation inside the small window.
 */
import type { ComponentType, ReactNode } from "react";
import { MachinesProvider } from "../../state/machines";
import { ProjectProvider } from "../../state/project";
import { SessionsProvider } from "../../state/sessions";
import { webAppDeps } from "../../web-app/deps";
import { useWebAppPages } from "../../web-app/contributions";

/** The chat page's contribution id (features/chat/module.ts). */
const CHAT_PAGE_ID = "chat.page";

/** The chat page as this page renders it: the same component, told it has no toolbar to draw. */
function useChatPage(): ComponentType<{ embed?: boolean }> | null {
  const pages = useWebAppPages();
  const page = pages.find((candidate) => candidate.id === CHAT_PAGE_ID);
  return page === undefined
    ? null
    : (page.Component as unknown as ComponentType<{ embed?: boolean }>);
}

export function PetChatPage() {
  const { sessionProviders, userEvents } = webAppDeps.useDeps();
  const Chat = useChatPage();
  if (Chat === null) return null;
  const tree = sessionProviders.reduceRight<ReactNode>(
    (inner, { id, Component }) => <Component key={id}>{inner}</Component>,
    <Chat embed />,
  );
  return (
    <ProjectProvider>
      <MachinesProvider>
        <SessionsProvider userEvents={userEvents}>{tree}</SessionsProvider>
      </MachinesProvider>
    </ProjectProvider>
  );
}
