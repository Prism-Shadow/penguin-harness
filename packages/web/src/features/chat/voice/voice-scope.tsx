import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { GlyphIcon, ICONS, Spinner, toastError } from "@prismshadow/penguin-ui";
import type { CapabilitySettings } from "@prismshadow/penguin-server/api";
import { apiUrl } from "../../../lib/server-context";
import { apiErrorText } from "../../../lib/api-error";
import { S } from "../../../lib/strings";
import { useProjectCapabilities } from "../../../state/use-project-capabilities";
import { hasBoundCapability, runVoice } from "../../../api/project-capabilities";

type Playback = { id: string; phase: "loading" | "playing" | "ready" };
interface VoiceState {
  projectId: string;
  server: string | null;
  sessionId: string | undefined;
  active: boolean;
  settings: CapabilitySettings | null;
  readCurrent: (signal: AbortSignal) => Promise<CapabilitySettings | null>;
  playback: Playback | null;
  speak: (id: string, text: string) => void;
  stop: (replyId?: string) => void;
}
const VoiceContext = createContext<VoiceState | null>(null);
export function useVoice() {
  return useContext(VoiceContext);
}

export function VoiceScope({
  projectId,
  server,
  sessionId,
  active,
  children,
}: {
  projectId: string;
  server: string | null;
  sessionId: string | undefined;
  active: boolean;
  children: ReactNode;
}) {
  const { settings, readCurrent } = useProjectCapabilities(active ? projectId : null, server);
  const canSpeak = hasBoundCapability(settings, "tts");
  const [playback, setPlayback] = useState<Playback | null>(null);
  const current = useRef<{ request: AbortController; audio: HTMLAudioElement; id: string } | null>(
    null,
  );
  const stop = useCallback((replyId?: string) => {
    const item = current.current;
    if (replyId !== undefined && item?.id !== replyId) return;
    current.current = null;
    if (item) {
      item.request.abort();
      item.audio.onended = null;
      item.audio.onerror = null;
      item.audio.pause();
      item.audio.removeAttribute("src");
      item.audio.load();
    }
    setPlayback(null);
  }, []);
  useLayoutEffect(() => stop, [projectId, server, sessionId, active, canSpeak, stop]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) stop();
    };
    const pageHide = () => stop();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", pageHide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", pageHide);
    };
  }, [stop]);
  const speak = async (id: string, text: string) => {
    const previous = current.current;
    if (previous?.id === id && playback?.phase !== "ready") {
      stop();
      return;
    }
    if (!active || !canSpeak) return;
    let item = previous?.id === id ? previous : null;
    try {
      if (!item) {
        stop();
        const request = new AbortController(),
          audio = new Audio();
        item = { request, audio, id };
        current.current = item;
        setPlayback({ id, phase: "loading" });
        const latest = await readCurrent(request.signal);
        if (current.current !== item) return;
        if (!hasBoundCapability(latest, "tts")) {
          stop(id);
          return;
        }
        const result = await runVoice(
          projectId,
          server,
          "tts",
          { text, ...(sessionId ? { sessionId } : {}) },
          request.signal,
        );
        if (current.current !== item) return;
        const artifact = result.artifacts.find((a) => a.mimeType.startsWith("audio/"));
        if (!artifact || !artifact.url.startsWith("/api/")) throw new Error(S.voice.audioError);
        audio.onended = () => stop(id);
        audio.onerror = () => {
          if (current.current === item) {
            stop();
            toastError(S.voice.audioError);
          }
        };
        audio.src = apiUrl(artifact.url, server);
      }
      await item.audio.play();
      if (current.current === item) setPlayback({ id, phase: "playing" });
    } catch (e) {
      if (!item || current.current !== item) return;
      if (e instanceof DOMException && e.name === "NotAllowedError" && item.audio.src) {
        setPlayback({ id, phase: "ready" });
        return;
      }
      stop();
      toastError(apiErrorText(e));
    }
  };
  return (
    <VoiceContext.Provider
      value={{
        projectId,
        server,
        sessionId,
        active,
        settings,
        readCurrent,
        playback,
        speak: (id, text) => void speak(id, text),
        stop,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}

export function ReadReply({ text }: { text: string }) {
  const scope = useVoice(),
    id = useId();
  const stop = scope?.stop;
  useEffect(() => () => stop?.(id), [stop, id]);
  if (!scope || !hasBoundCapability(scope.settings, "tts") || !text.trim()) return null;
  const own = scope.playback?.id === id ? scope.playback.phase : null;
  const label = own === "ready" ? S.voice.play : own ? S.voice.stop : S.voice.listen;
  return (
    <button
      type="button"
      data-tooltip={label}
      aria-label={label}
      aria-pressed={own === "playing" || own === "loading"}
      onClick={() => scope.speak(id, text)}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-surface-muted hover:text-fg"
    >
      {own === "loading" ? (
        <Spinner size="sm" label={S.voice.preparing} />
      ) : (
        <GlyphIcon d={own === "playing" ? ICONS.square : ICONS.speaker} size={15} />
      )}
    </button>
  );
}
