import { useContext, type ComponentType } from "react";
import {
  PagesContext,
  MachinesProvider,
  ProjectProvider,
  useProjectIfAny,
  SessionsProvider,
} from "@prismshadow/penguin-web/internal";

function ProjectPage({ projectId, Page }: { projectId: string; Page: ComponentType }) {
  return useProjectIfAny()?.currentProject?.projectId === projectId ? <Page /> : null;
}

/** A window shares its shell's Project. A standalone page uses the Project in its address. */
export function NativeWorkbenchPage({ name, projectId }: { name: string; projectId: string }) {
  const shell = useProjectIfAny();
  const host = useContext(PagesContext)?.workbenchHost;
  const Page = host?.pageRenderers.get(name);
  if (!host || !Page) return null;
  const content = <ProjectPage projectId={projectId} Page={Page} />;
  if (shell !== null) return content;
  return (
    <ProjectProvider key={projectId} initialProjectId={projectId}>
      <MachinesProvider>
        <SessionsProvider userEvents={host.userEvents}>{content}</SessionsProvider>
      </MachinesProvider>
    </ProjectProvider>
  );
}
