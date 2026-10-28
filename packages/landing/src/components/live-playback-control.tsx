/** The window bar controls only its own walkthrough and keeps a pause made before it loads. */
import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { SitePlaybackButton } from "@prismshadow/penguin-ui/site";
import { EVOLUTION_CONTROL, EVOLUTION_STATE } from "../../../ui-gallery/src/app/evolution-messages";
import { S } from "../lib/strings";

export function LivePlaybackControl({
  frame,
  src,
}: {
  frame: RefObject<HTMLIFrameElement | null>;
  src: string;
}) {
  const [paused, setPaused] = useState(false);
  const [confirmedPaused, setConfirmedPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const origin = new URL(src, window.location.href).origin;

  useEffect(() => {
    const send = () =>
      frame.current?.contentWindow?.postMessage({ type: EVOLUTION_CONTROL, paused }, origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      if (event.data?.type !== EVOLUTION_STATE) return;
      if (event.data.state === "ready") {
        setFinished(false);
        send();
      }
      if (event.data.state === "finished") setFinished(true);
      if (event.data.state === "paused") setConfirmedPaused(true);
      if (event.data.state === "playing") setConfirmedPaused(false);
    };
    window.addEventListener("message", receive);
    send();
    return () => window.removeEventListener("message", receive);
  }, [frame, origin, paused]);

  if (finished) return null;
  return (
    <SitePlaybackButton
      paused={confirmedPaused}
      onPausedChange={setPaused}
      labels={S.amsp.player}
    />
  );
}
