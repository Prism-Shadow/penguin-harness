import { useState } from "react";
import { MachinesProvider } from "../../state/machines";
import { ProjectProvider, useProjectIfAny } from "../../state/project";
import { SessionsProvider } from "../../state/sessions";
import { webAppDeps } from "../../web-app/deps";
import { BenchmarkDetailPage } from "./benchmark-detail-page";
import { BenchmarkPage } from "./benchmark-page";

function EvaluationPages({ projectId }: { projectId: string }) {
  const project = useProjectIfAny();
  const [selected, setSelected] = useState<string | null>(null);
  if (project?.currentProject?.projectId !== projectId) return null;
  return (
    <div className="h-full overflow-auto">
      {selected === null ? (
        <BenchmarkPage onOpen={setSelected} />
      ) : (
        <BenchmarkDetailPage selectedId={selected} onBack={() => setSelected(null)} />
      )}
    </div>
  );
}

/** A bare full-page workbench owns its Project scope. A window shares the surrounding shell. */
export function SelfEvolutionWorkbench({ projectId }: { projectId: string }) {
  const shell = useProjectIfAny();
  const { userEvents } = webAppDeps.useDeps();
  if (shell !== null) return <EvaluationPages projectId={projectId} />;
  return (
    <ProjectProvider key={projectId} initialProjectId={projectId}>
      <MachinesProvider>
        <SessionsProvider userEvents={userEvents}>
          <EvaluationPages projectId={projectId} />
        </SessionsProvider>
      </MachinesProvider>
    </ProjectProvider>
  );
}
