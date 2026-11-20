/**
 * A page drawn by a server-contributed document: the `iframe` renderer of a page in
 * `WebModule.pages` (web-app/contributions.tsx) that opens as a page rather than in the App
 * Center's window. The page fills WebApp's content area in the frame every contributed page uses
 * (lib/page-frame.tsx): the app's appearance, language and Project copied in, its keys forwarded.
 */
import { PageFrame } from "../lib/page-frame";
import { useProjectIfAny } from "../state/project";

export function FramePage({ src, title }: { src: string; title: string }) {
  const projectId = useProjectIfAny()?.currentProject?.projectId ?? null;
  return <PageFrame src={src} title={title} projectId={projectId} />;
}
