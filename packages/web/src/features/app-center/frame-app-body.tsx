/**
 * The body of the window of an app a server module draws in an iframe (a system app with a
 * `frame`): the page's document in the frame every contributed page uses (lib/page-frame.tsx),
 * and the window's address kept in step with where the page is inside itself, as every App
 * Center window that draws an iframe keeps it (lib/frame-address.ts).
 */
import { useWindowFrameAddress } from "../../lib/frame-address";
import { PageFrame } from "../../lib/page-frame";

export function FrameAppBody({
  appKey,
  projectId,
  src,
  title,
}: {
  /** The window's key in the address (`?app=`). */
  appKey: string;
  projectId: string;
  src: string;
  title: string;
}) {
  const { at, onLocation, onNavigate } = useWindowFrameAddress(appKey);
  return (
    <PageFrame
      src={src}
      title={title}
      projectId={projectId}
      at={at}
      onLocation={onLocation}
      onNavigate={onNavigate}
    />
  );
}
